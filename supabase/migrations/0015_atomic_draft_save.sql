create unique index customers_workspace_identity_idx
  on public.customers (workspace_id, lower(company_name), lower(name))
  where deleted_at is null;

create or replace function public.save_invoice_draft(
  p_invoice_id uuid,
  p_expected_version bigint,
  p_issue_date date,
  p_due_date date,
  p_payment_status public.payment_status,
  p_discount_type public.discount_type,
  p_discount_input_value integer,
  p_canonical jsonb,
  p_seller_snapshot jsonb,
  p_customer_snapshot jsonb,
  p_lines jsonb
)
returns table (
  result_invoice_id uuid,
  result_version bigint,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_invoice public.invoices%rowtype;
  v_line jsonb;
  v_position integer := 0;
  v_line_count integer;
  v_quantity bigint;
  v_unit_price bigint;
  v_subtotal numeric := 0;
  v_discount_input bigint;
  v_discount_amount numeric := 0;
  v_total numeric := 0;
  v_document jsonb;
  v_invoice_id uuid;
  v_version bigint;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  if p_issue_date is null or p_due_date is null or p_canonical is null
    or p_seller_snapshot is null or p_customer_snapshot is null then
    return query select p_invoice_id, null::bigint, 'INVALID_REQUEST'::text;
    return;
  end if;

  if p_expected_version is null and p_invoice_id is not null then
    return query select p_invoice_id, null::bigint, 'INVALID_REQUEST'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    return query select p_invoice_id, null::bigint, 'LINE_ITEMS_INVALID'::text;
    return;
  end if;

  v_line_count := jsonb_array_length(p_lines);
  if v_line_count < 1 or v_line_count > 200 then
    return query select p_invoice_id, null::bigint, 'LINE_ITEMS_INVALID'::text;
    return;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if nullif(trim(v_line->>'description'), '') is null
      or char_length(v_line->>'description') > 2000
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$'
      or coalesce(v_line->>'unitPrice', '') !~ '^[0-9]+$' then
      return query select p_invoice_id, null::bigint, 'LINE_ITEM_INVALID'::text;
      return;
    end if;

    begin
      v_quantity := (v_line->>'quantity')::bigint;
      v_unit_price := (v_line->>'unitPrice')::bigint;
    exception when others then
      return query select p_invoice_id, null::bigint, 'LINE_ITEM_INVALID'::text;
      return;
    end;

    if v_quantity < 1 or v_quantity > 1000000 or v_unit_price < 0 or v_unit_price > 1000000000000 then
      return query select p_invoice_id, null::bigint, 'LINE_ITEM_OUT_OF_RANGE'::text;
      return;
    end if;

    v_subtotal := v_subtotal + (v_quantity::numeric * v_unit_price::numeric);
    if v_subtotal > 9223372036854775807 then
      return query select p_invoice_id, null::bigint, 'TOTAL_OUT_OF_RANGE'::text;
      return;
    end if;
  end loop;

  if p_discount_type = 'none' then
    v_discount_input := 0;
  elsif p_discount_input_value is null or p_discount_input_value < 0 then
    return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
    return;
  else
    v_discount_input := p_discount_input_value;
  end if;

  if p_discount_type = 'percentage' then
    if v_discount_input > 100 then
      return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
      return;
    end if;
    v_discount_amount := round((v_subtotal * v_discount_input::numeric) / 100);
  elsif p_discount_type = 'fixed' then
    v_discount_amount := least(v_subtotal, v_discount_input::numeric);
  elsif p_discount_type <> 'none' then
    return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
    return;
  end if;

  v_total := greatest(0, v_subtotal - v_discount_amount);
  if v_total > 9223372036854775807 or v_discount_amount > 9223372036854775807 then
    return query select p_invoice_id, null::bigint, 'TOTAL_OUT_OF_RANGE'::text;
    return;
  end if;

  v_document := jsonb_set(
    p_canonical,
    '{totals}',
    jsonb_build_object(
      'subtotal', v_subtotal::bigint,
      'discountAmount', v_discount_amount::bigint,
      'total', v_total::bigint
    ),
    true
  );

  if p_invoice_id is null then
    insert into public.invoices (
      workspace_id,
      lifecycle_status,
      issue_date,
      due_date,
      payment_status,
      discount_type,
      discount_input_value,
      subtotal_amount,
      discount_amount,
      total_amount,
      canonical_document,
      seller_snapshot,
      customer_snapshot
    ) values (
      v_workspace_id,
      'draft',
      p_issue_date,
      p_due_date,
      p_payment_status,
      p_discount_type,
      v_discount_input::integer,
      v_subtotal::bigint,
      v_discount_amount::bigint,
      v_total::bigint,
      v_document,
      p_seller_snapshot,
      p_customer_snapshot
    ) returning id, version into v_invoice_id, v_version;
  else
    select * into v_invoice
    from public.invoices
    where id = p_invoice_id and workspace_id = v_workspace_id
    for update;

    if not found then
      return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
      return;
    end if;

    if v_invoice.lifecycle_status <> 'draft' then
      return query select p_invoice_id, v_invoice.version, 'NOT_DRAFT'::text;
      return;
    end if;

    if v_invoice.version <> p_expected_version then
      return query select p_invoice_id, v_invoice.version, 'VERSION_CONFLICT'::text;
      return;
    end if;

    update public.invoices
    set issue_date = p_issue_date,
        due_date = p_due_date,
        payment_status = p_payment_status,
        discount_type = p_discount_type,
        discount_input_value = v_discount_input::integer,
        subtotal_amount = v_subtotal::bigint,
        discount_amount = v_discount_amount::bigint,
        total_amount = v_total::bigint,
        canonical_document = v_document,
        seller_snapshot = p_seller_snapshot,
        customer_snapshot = p_customer_snapshot,
        version = version + 1,
        updated_at = now()
    where id = p_invoice_id and workspace_id = v_workspace_id
    returning id, version into v_invoice_id, v_version;
  end if;

  delete from public.invoice_lines where invoice_id = v_invoice_id;
  v_position := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, line_total)
    values (
      v_invoice_id,
      v_position,
      trim(v_line->>'description'),
      (v_line->>'quantity')::integer,
      (v_line->>'unitPrice')::bigint,
      ((v_line->>'quantity')::numeric * (v_line->>'unitPrice')::numeric)::bigint
    );
    v_position := v_position + 1;
  end loop;

  if nullif(trim(p_customer_snapshot->>'name'), '') is not null then
    insert into public.customers (
      workspace_id,
      company_name,
      name,
      address_text,
      email,
      phone,
      website,
      updated_at
    ) values (
      v_workspace_id,
      coalesce(p_customer_snapshot->>'companyName', ''),
      trim(p_customer_snapshot->>'name'),
      coalesce(p_customer_snapshot->>'address', ''),
      coalesce(p_customer_snapshot->>'email', ''),
      coalesce(p_customer_snapshot->>'phone', ''),
      coalesce(p_canonical->>'buyerWebsite', ''),
      now()
    )
    on conflict (workspace_id, lower(company_name), lower(name)) where deleted_at is null
    do update set
      company_name = excluded.company_name,
      name = excluded.name,
      address_text = excluded.address_text,
      email = excluded.email,
      phone = excluded.phone,
      website = excluded.website,
      updated_at = now(),
      deleted_at = null;
  end if;

  return query select v_invoice_id, v_version, null::text;
end;
$$;

revoke all on function public.save_invoice_draft(uuid, bigint, date, date, public.payment_status, public.discount_type, integer, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_invoice_draft(uuid, bigint, date, date, public.payment_status, public.discount_type, integer, jsonb, jsonb, jsonb, jsonb) to authenticated;
