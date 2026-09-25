begin;

create or replace function public.update_finalized_invoice(
  p_invoice_id uuid,
  p_expected_version bigint,
  p_canonical jsonb,
  p_issue_date date,
  p_due_date date,
  p_payment_status public.payment_status
)
returns table (result_invoice_id uuid, result_version bigint, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_invoice public.invoices%rowtype;
  v_canonical jsonb;
  v_line jsonb;
  v_position integer := 0;
  v_quantity bigint;
  v_unit_price bigint;
  v_subtotal numeric := 0;
  v_discount_input bigint := 0;
  v_discount_amount numeric := 0;
  v_total numeric := 0;
  v_legacy_discount_type public.discount_type;
  v_effective_discount_type public.discount_type;
  v_line_discount_type public.discount_type;
  v_line_discount_input bigint;
  v_line_original numeric;
  v_line_discount numeric;
  v_line_total numeric;
  v_has_line_discount boolean := false;
  v_version bigint;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  if p_invoice_id is null or p_expected_version is null or p_expected_version < 0 or p_canonical is null then
    return query select p_invoice_id, null::bigint, 'INVALID_REQUEST'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and workspace_id = v_workspace_id
  for update;

  if not found then
    return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  if v_invoice.lifecycle_status <> 'finalized' then
    return query select p_invoice_id, null::bigint, 'NOT_FINALIZED'::text;
    return;
  end if;

  if v_invoice.version <> p_expected_version then
    return query select p_invoice_id, v_invoice.version, 'VERSION_CONFLICT'::text;
    return;
  end if;

  v_canonical := jsonb_set(
    jsonb_set(coalesce(p_canonical, '{}'::jsonb), '{paymentStatus}', to_jsonb(p_payment_status::text), true),
    '{issueDate}',
    to_jsonb(p_issue_date::text),
    true
  );
  v_canonical := jsonb_set(v_canonical, '{dueDate}', to_jsonb(p_due_date::text), true);

  if nullif(trim(v_canonical->>'sellerCompanyName'), '') is null
    or nullif(trim(v_canonical->>'sellerName'), '') is null
    or nullif(trim(v_canonical->>'buyerCompanyName'), '') is null
    or nullif(trim(v_canonical->>'buyerName'), '') is null then
    return query select p_invoice_id, v_invoice.version, 'REQUIRED_FIELDS_MISSING'::text;
    return;
  end if;

  if jsonb_typeof(v_canonical->'lines') <> 'array' or jsonb_array_length(v_canonical->'lines') = 0 then
    return query select p_invoice_id, v_invoice.version, 'LINE_ITEMS_REQUIRED'::text;
    return;
  end if;

  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    if nullif(trim(v_line->>'description'), '') is null
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$'
      or coalesce(v_line->>'unitPrice', '') !~ '^[0-9]+$' then
      return query select p_invoice_id, v_invoice.version, 'LINE_ITEM_INVALID'::text;
      return;
    end if;

    begin
      v_quantity := (v_line->>'quantity')::bigint;
      v_unit_price := (v_line->>'unitPrice')::bigint;
    exception when others then
      return query select p_invoice_id, v_invoice.version, 'LINE_ITEM_INVALID'::text;
      return;
    end;

    if v_quantity < 1 or v_quantity > 1000000 or v_unit_price < 0 or v_unit_price > 1000000000000 then
      return query select p_invoice_id, v_invoice.version, 'LINE_ITEM_OUT_OF_RANGE'::text;
      return;
    end if;

    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    if v_line_original > 9223372036854775807 then
      return query select p_invoice_id, v_invoice.version, 'TOTAL_OUT_OF_RANGE'::text;
      return;
    end if;

    if coalesce(v_line->>'discountType', 'none') not in ('none', 'fixed', 'percentage') then
      return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
      return;
    end if;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;

    if v_line_discount_type = 'none' then
      v_line_discount_input := 0;
    elsif coalesce(v_line->>'discountValue', '') !~ '^[0-9]+$' then
      return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
      return;
    else
      v_line_discount_input := (v_line->>'discountValue')::bigint;
    end if;

    if v_line_discount_type = 'percentage' and v_line_discount_input > 100 then
      return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
      return;
    elsif v_line_discount_type = 'fixed' and v_line_discount_input::numeric > v_line_original then
      return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
      return;
    end if;

    if v_line_discount_type = 'fixed' then
      v_line_discount := v_line_discount_input::numeric;
    elsif v_line_discount_type = 'percentage' then
      v_line_discount := round((v_line_original * v_line_discount_input::numeric) / 100);
    else
      v_line_discount := 0;
    end if;

    v_has_line_discount := v_has_line_discount or v_line_discount_type <> 'none' or v_line_discount_input > 0;
    v_subtotal := v_subtotal + v_line_original;
    v_discount_amount := v_discount_amount + v_line_discount;
  end loop;

  if v_subtotal > 9223372036854775807 then
    return query select p_invoice_id, v_invoice.version, 'TOTAL_OUT_OF_RANGE'::text;
    return;
  end if;

  if v_has_line_discount then
    v_effective_discount_type := 'none';
    v_discount_input := 0;
  else
    if coalesce(v_canonical->>'discountType', 'none') not in ('none', 'fixed', 'percentage') then
      return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
      return;
    end if;
    v_legacy_discount_type := coalesce(v_canonical->>'discountType', 'none')::public.discount_type;
    v_effective_discount_type := v_legacy_discount_type;

    if v_legacy_discount_type = 'none' then
      v_discount_input := 0;
    elsif coalesce(v_canonical->>'discountValue', '') !~ '^[0-9]+$' then
      return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
      return;
    else
      v_discount_input := (v_canonical->>'discountValue')::bigint;
    end if;

    if v_legacy_discount_type = 'percentage' then
      if v_discount_input > 100 then
        return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text;
        return;
      end if;
      v_discount_amount := round((v_subtotal * v_discount_input::numeric) / 100);
    elsif v_legacy_discount_type = 'fixed' then
      v_discount_amount := least(v_subtotal, v_discount_input::numeric);
    end if;
  end if;

  v_total := greatest(0, v_subtotal - v_discount_amount);
  if v_total > 9223372036854775807 or v_discount_amount > 9223372036854775807 then
    return query select p_invoice_id, v_invoice.version, 'TOTAL_OUT_OF_RANGE'::text;
    return;
  end if;

  v_canonical := jsonb_set(
    v_canonical,
    '{totals}',
    jsonb_build_object(
      'subtotal', v_subtotal::bigint,
      'discountAmount', v_discount_amount::bigint,
      'total', v_total::bigint
    ),
    true
  );

  delete from public.invoice_lines where invoice_id = p_invoice_id;
  v_position := 0;
  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    v_quantity := (v_line->>'quantity')::bigint;
    v_unit_price := (v_line->>'unitPrice')::bigint;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;
    v_line_discount_input := case when v_line_discount_type = 'none' then 0 else (v_line->>'discountValue')::bigint end;
    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    v_line_discount := case
      when v_has_line_discount and v_line_discount_type = 'fixed' then v_line_discount_input::numeric
      when v_has_line_discount and v_line_discount_type = 'percentage' then round((v_line_original * v_line_discount_input::numeric) / 100)
      else 0
    end;
    v_line_total := v_line_original - v_line_discount;

    insert into public.invoice_lines (
      invoice_id, position, description, quantity, unit_price,
      discount_type, discount_input_value, original_amount, discount_amount, line_total
    ) values (
      p_invoice_id, v_position, trim(v_line->>'description'), v_quantity::integer, v_unit_price,
      case when v_has_line_discount then v_line_discount_type else 'none' end,
      case when v_has_line_discount then v_line_discount_input else 0 end,
      v_line_original::bigint, v_line_discount::bigint, v_line_total::bigint
    );
    v_position := v_position + 1;
  end loop;

  update public.invoices
  set issue_date = p_issue_date,
      due_date = p_due_date,
      payment_status = p_payment_status,
      discount_type = v_effective_discount_type,
      discount_input_value = v_discount_input::integer,
      subtotal_amount = v_subtotal::bigint,
      discount_amount = v_discount_amount::bigint,
      total_amount = v_total::bigint,
      canonical_document = v_canonical,
      seller_snapshot = jsonb_build_object(
        'companyName', v_canonical->>'sellerCompanyName',
        'name', v_canonical->>'sellerName',
        'email', coalesce(v_canonical->>'sellerEmail', ''),
        'phone', coalesce(v_canonical->>'sellerPhone', ''),
        'address', coalesce(v_canonical->>'sellerAddress', '')
      ),
      customer_snapshot = jsonb_build_object(
        'companyName', v_canonical->>'buyerCompanyName',
        'name', v_canonical->>'buyerName',
        'email', coalesce(v_canonical->>'buyerEmail', ''),
        'phone', coalesce(v_canonical->>'buyerPhone', ''),
        'address', coalesce(v_canonical->>'buyerAddress', '')
      ),
      version = version + 1,
      updated_at = now()
  where id = p_invoice_id and workspace_id = v_workspace_id
  returning version into v_version;

  return query select p_invoice_id, v_version, null::text;
end;
$$;

revoke all on function public.update_finalized_invoice(uuid, bigint, jsonb, date, date, public.payment_status) from public, anon;
grant execute on function public.update_finalized_invoice(uuid, bigint, jsonb, date, date, public.payment_status) to authenticated;

commit;
