begin;

alter table public.invoice_lines
  add column if not exists discount_type public.discount_type not null default 'none',
  add column if not exists discount_input_value bigint not null default 0,
  add column if not exists original_amount bigint not null default 0,
  add column if not exists discount_amount bigint not null default 0;

update public.invoice_lines
set original_amount = line_total,
    discount_amount = 0
where original_amount = 0 and line_total <> 0;

alter table public.invoice_lines
  add constraint invoice_lines_discount_input_value_check check (discount_input_value >= 0),
  add constraint invoice_lines_original_amount_check check (original_amount >= 0),
  add constraint invoice_lines_discount_amount_check check (discount_amount >= 0 and discount_amount <= original_amount);

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
  v_discount_input bigint := 0;
  v_discount_amount numeric := 0;
  v_total numeric := 0;
  v_line_discount_type public.discount_type;
  v_line_discount_input bigint;
  v_line_original numeric;
  v_line_discount numeric;
  v_line_total numeric;
  v_has_line_discount boolean := false;
  v_effective_discount_type public.discount_type;
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

    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    if v_line_original > 9223372036854775807 then
      return query select p_invoice_id, null::bigint, 'TOTAL_OUT_OF_RANGE'::text;
      return;
    end if;

    if coalesce(v_line->>'discountType', 'none') not in ('none', 'fixed', 'percentage') then
      return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
      return;
    end if;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;

    if v_line_discount_type = 'none' then
      v_line_discount_input := 0;
    elsif coalesce(v_line->>'discountValue', '') !~ '^[0-9]+$' then
      return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
      return;
    else
      v_line_discount_input := (v_line->>'discountValue')::bigint;
    end if;

    if v_line_discount_type = 'percentage' and v_line_discount_input > 100 then
      return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
      return;
    elsif v_line_discount_type = 'fixed' and v_line_discount_input::numeric > v_line_original then
      return query select p_invoice_id, null::bigint, 'DISCOUNT_INVALID'::text;
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

  if v_has_line_discount then
    v_effective_discount_type := 'none';
    v_discount_input := 0;
  else
    v_effective_discount_type := p_discount_type;
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
      workspace_id, lifecycle_status, issue_date, due_date, payment_status,
      discount_type, discount_input_value, subtotal_amount, discount_amount,
      total_amount, canonical_document, seller_snapshot, customer_snapshot
    ) values (
      v_workspace_id, 'draft', p_issue_date, p_due_date, p_payment_status,
      v_effective_discount_type, v_discount_input::integer, v_subtotal::bigint,
      v_discount_amount::bigint, v_total::bigint, v_document,
      p_seller_snapshot, p_customer_snapshot
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
    set issue_date = p_issue_date, due_date = p_due_date, payment_status = p_payment_status,
        discount_type = v_effective_discount_type, discount_input_value = v_discount_input::integer,
        subtotal_amount = v_subtotal::bigint, discount_amount = v_discount_amount::bigint,
        total_amount = v_total::bigint, canonical_document = v_document,
        seller_snapshot = p_seller_snapshot, customer_snapshot = p_customer_snapshot,
        version = version + 1, updated_at = now()
    where id = p_invoice_id and workspace_id = v_workspace_id
    returning id, version into v_invoice_id, v_version;
  end if;

  delete from public.invoice_lines where invoice_id = v_invoice_id;
  v_position := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_quantity := (v_line->>'quantity')::bigint;
    v_unit_price := (v_line->>'unitPrice')::bigint;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;
    v_line_discount_input := case when v_line_discount_type = 'none' then 0 else (v_line->>'discountValue')::bigint end;
    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    v_line_discount := case when v_has_line_discount and v_line_discount_type = 'fixed' then v_line_discount_input::numeric when v_has_line_discount and v_line_discount_type = 'percentage' then round((v_line_original * v_line_discount_input::numeric) / 100) else 0 end;
    v_line_total := v_line_original - v_line_discount;
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, discount_type, discount_input_value, original_amount, discount_amount, line_total)
    values (v_invoice_id, v_position, trim(v_line->>'description'), v_quantity::integer, v_unit_price, case when v_has_line_discount then v_line_discount_type else 'none' end, case when v_has_line_discount then v_line_discount_input else 0 end, v_line_original::bigint, v_line_discount::bigint, v_line_total::bigint);
    v_position := v_position + 1;
  end loop;

  if nullif(trim(p_customer_snapshot->>'name'), '') is not null then
    insert into public.customers (workspace_id, company_name, name, address_text, email, phone, website, updated_at)
    values (v_workspace_id, coalesce(p_customer_snapshot->>'companyName', ''), trim(p_customer_snapshot->>'name'), coalesce(p_customer_snapshot->>'address', ''), coalesce(p_customer_snapshot->>'email', ''), coalesce(p_customer_snapshot->>'phone', ''), coalesce(p_customer_snapshot->>'website', ''), now())
    on conflict (workspace_id, lower(company_name), lower(name)) where deleted_at is null
    do update set company_name = excluded.company_name, name = excluded.name, address_text = excluded.address_text, email = excluded.email, phone = excluded.phone, website = excluded.website, updated_at = now(), deleted_at = null;
  end if;

  return query select v_invoice_id, v_version, null::text;
end;
$$;

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
  if auth.uid() is null then return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text; return; end if;
  if p_invoice_id is null or p_expected_version is null or p_expected_version < 0 or p_canonical is null then return query select p_invoice_id, null::bigint, 'INVALID_REQUEST'::text; return; end if;
  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text; return; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id and workspace_id = v_workspace_id for update;
  if not found then return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text; return; end if;
  if v_invoice.lifecycle_status <> 'finalized' then return query select p_invoice_id, null::bigint, 'NOT_FINALIZED'::text; return; end if;
  if v_invoice.version <> p_expected_version then return query select p_invoice_id, v_invoice.version, 'VERSION_CONFLICT'::text; return; end if;

  v_canonical := jsonb_set(jsonb_set(coalesce(p_canonical, '{}'::jsonb), '{paymentStatus}', to_jsonb(p_payment_status::text), true), '{issueDate}', to_jsonb(p_issue_date::text), true);
  v_canonical := jsonb_set(v_canonical, '{dueDate}', to_jsonb(p_due_date::text), true);
  if nullif(trim(v_canonical->>'sellerCompanyName'), '') is null or nullif(trim(v_canonical->>'sellerName'), '') is null or nullif(trim(v_canonical->>'buyerCompanyName'), '') is null or nullif(trim(v_canonical->>'buyerName'), '') is null then return query select p_invoice_id, v_invoice.version, 'REQUIRED_FIELDS_MISSING'::text; return; end if;
  if jsonb_typeof(v_canonical->'lines') <> 'array' or jsonb_array_length(v_canonical->'lines') = 0 then return query select p_invoice_id, v_invoice.version, 'LINE_ITEMS_REQUIRED'::text; return; end if;

  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    if nullif(trim(v_line->>'description'), '') is null or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$' or coalesce(v_line->>'unitPrice', '') !~ '^[0-9]+$' then return query select p_invoice_id, v_invoice.version, 'LINE_ITEM_INVALID'::text; return; end if;
    v_quantity := (v_line->>'quantity')::bigint;
    v_unit_price := (v_line->>'unitPrice')::bigint;
    if v_quantity < 1 or v_quantity > 1000000 or v_unit_price < 0 or v_unit_price > 1000000000000 then return query select p_invoice_id, v_invoice.version, 'LINE_ITEM_OUT_OF_RANGE'::text; return; end if;
    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    if coalesce(v_line->>'discountType', 'none') not in ('none', 'fixed', 'percentage') then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; end if;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;
    if v_line_discount_type = 'none' then v_line_discount_input := 0; elsif coalesce(v_line->>'discountValue', '') !~ '^[0-9]+$' then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; else v_line_discount_input := (v_line->>'discountValue')::bigint; end if;
    if v_line_discount_type = 'percentage' and v_line_discount_input > 100 then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; end if;
    if v_line_discount_type = 'fixed' and v_line_discount_input::numeric > v_line_original then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; end if;
    if v_line_discount_type = 'fixed' then v_line_discount := v_line_discount_input::numeric; elsif v_line_discount_type = 'percentage' then v_line_discount := round((v_line_original * v_line_discount_input::numeric) / 100); else v_line_discount := 0; end if;
    v_has_line_discount := v_has_line_discount or v_line_discount_type <> 'none' or v_line_discount_input > 0;
    v_subtotal := v_subtotal + v_line_original;
    v_discount_amount := v_discount_amount + v_line_discount;
  end loop;

  if v_has_line_discount then
    v_effective_discount_type := 'none';
    v_discount_input := 0;
  else
    if coalesce(v_canonical->>'discountType', 'none') not in ('none', 'fixed', 'percentage') then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; end if;
    v_legacy_discount_type := coalesce(v_canonical->>'discountType', 'none')::public.discount_type;
    v_effective_discount_type := v_legacy_discount_type;
    if v_legacy_discount_type = 'none' then v_discount_input := 0; elsif coalesce(v_canonical->>'discountValue', '') !~ '^[0-9]+$' then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; else v_discount_input := (v_canonical->>'discountValue')::bigint; end if;
    if v_legacy_discount_type = 'percentage' then if v_discount_input > 100 then return query select p_invoice_id, v_invoice.version, 'DISCOUNT_INVALID'::text; return; end if; v_discount_amount := round((v_subtotal * v_discount_input::numeric) / 100); elsif v_legacy_discount_type = 'fixed' then v_discount_amount := least(v_subtotal, v_discount_input::numeric); end if;
  end if;

  v_total := greatest(0, v_subtotal - v_discount_amount);
  if v_total > 9223372036854775807 or v_discount_amount > 9223372036854775807 then return query select p_invoice_id, v_invoice.version, 'TOTAL_OUT_OF_RANGE'::text; return; end if;
  v_canonical := jsonb_set(v_canonical, '{totals}', jsonb_build_object('subtotal', v_subtotal::bigint, 'discountAmount', v_discount_amount::bigint, 'total', v_total::bigint), true);

  delete from public.invoice_lines where invoice_id = p_invoice_id;
  v_position := 0;
  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    v_quantity := (v_line->>'quantity')::bigint;
    v_unit_price := (v_line->>'unitPrice')::bigint;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;
    v_line_discount_input := case when v_line_discount_type = 'none' then 0 else (v_line->>'discountValue')::bigint end;
    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    v_line_discount := case when v_has_line_discount and v_line_discount_type = 'fixed' then v_line_discount_input::numeric when v_has_line_discount and v_line_discount_type = 'percentage' then round((v_line_original * v_line_discount_input::numeric) / 100) else 0 end;
    v_line_total := v_line_original - v_line_discount;
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, discount_type, discount_input_value, original_amount, discount_amount, line_total)
    values (p_invoice_id, v_position, trim(v_line->>'description'), v_quantity::integer, v_unit_price, case when v_has_line_discount then v_line_discount_type else 'none' end, case when v_has_line_discount then v_line_discount_input else 0 end, v_line_original::bigint, v_line_discount::bigint, v_line_total::bigint);
    v_position := v_position + 1;
  end loop;

  update public.invoices
  set issue_date = p_issue_date, due_date = p_due_date, payment_status = p_payment_status,
      discount_type = v_effective_discount_type, discount_input_value = v_discount_input::integer,
      subtotal_amount = v_subtotal::bigint, discount_amount = v_discount_amount::bigint, total_amount = v_total::bigint,
      canonical_document = v_canonical,
      seller_snapshot = jsonb_build_object('companyName', v_canonical->>'sellerCompanyName', 'name', v_canonical->>'sellerName', 'email', coalesce(v_canonical->>'sellerEmail', ''), 'phone', coalesce(v_canonical->>'sellerPhone', ''), 'address', coalesce(v_canonical->>'sellerAddress', '')),
      customer_snapshot = jsonb_build_object('companyName', v_canonical->>'buyerCompanyName', 'name', v_canonical->>'buyerName', 'email', coalesce(v_canonical->>'buyerEmail', ''), 'phone', coalesce(v_canonical->>'buyerPhone', ''), 'address', coalesce(v_canonical->>'buyerAddress', '')),
      version = version + 1, updated_at = now()
  where id = p_invoice_id and workspace_id = v_workspace_id
  returning version into v_version;
  return query select p_invoice_id, v_version, null::text;
end;
$$;

create or replace function public.finalize_invoice(
  p_invoice_id uuid,
  p_idempotency_key uuid,
  p_expected_version bigint
)
returns table (result_invoice_id uuid, result_invoice_number text, result_sequence_value bigint, result_version bigint, replayed boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_invoice public.invoices%rowtype;
  v_request private.invoice_finalization_requests%rowtype;
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
  v_sequence bigint;
  v_reservation_id uuid;
  v_prefix text;
  v_invoice_number text;
  v_fingerprint text;
  v_result jsonb;
begin
  if auth.uid() is null then return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'AUTH_REQUIRED'::text; return; end if;
  if p_invoice_id is null or p_idempotency_key is null or p_expected_version is null then return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'INVALID_REQUEST'::text; return; end if;
  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'WORKSPACE_NOT_FOUND'::text; return; end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and workspace_id = v_workspace_id for update;
  if not found then return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'INVOICE_NOT_FOUND'::text; return; end if;
  v_canonical := coalesce(v_invoice.canonical_document, '{}'::jsonb);
  v_fingerprint := md5(v_canonical::text || ':' || v_invoice.version::text);

  select * into v_request from private.invoice_finalization_requests where workspace_id = v_workspace_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.invoice_id <> p_invoice_id then return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'IDEMPOTENCY_MISMATCH'::text; return; end if;
    if v_request.status = 'completed' and v_request.result is not null then return query select (v_request.result->>'invoiceId')::uuid, v_request.result->>'invoiceNumber', (v_request.result->>'sequenceValue')::bigint, (v_request.result->>'version')::bigint, true, null::text; return; end if;
    if v_request.status = 'orphaned' then return query select p_invoice_id, null::text, null::bigint, null::bigint, true, coalesce(v_request.error_code, 'FINALIZATION_FAILED'); return; end if;
    if v_request.request_fingerprint <> v_fingerprint then return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'IDEMPOTENCY_MISMATCH'::text; return; end if;
  end if;
  if v_invoice.lifecycle_status <> 'draft' then return query select p_invoice_id, v_invoice.invoice_number, v_invoice.sequence_value, v_invoice.version, false, 'ALREADY_FINALIZED'::text; return; end if;
  if v_invoice.version <> p_expected_version then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'VERSION_CONFLICT'::text; return; end if;
  if nullif(trim(v_canonical->>'sellerCompanyName'), '') is null or nullif(trim(v_canonical->>'sellerName'), '') is null or nullif(trim(v_canonical->>'buyerCompanyName'), '') is null or nullif(trim(v_canonical->>'buyerName'), '') is null then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'REQUIRED_FIELDS_MISSING'::text; return; end if;
  if jsonb_typeof(v_canonical->'lines') <> 'array' or jsonb_array_length(v_canonical->'lines') = 0 then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEMS_REQUIRED'::text; return; end if;

  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    if nullif(trim(v_line->>'description'), '') is null or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$' or coalesce(v_line->>'unitPrice', '') !~ '^[0-9]+$' then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEM_INVALID'::text; return; end if;
    v_quantity := (v_line->>'quantity')::bigint;
    v_unit_price := (v_line->>'unitPrice')::bigint;
    if v_quantity < 1 or v_quantity > 1000000 or v_unit_price < 0 or v_unit_price > 1000000000000 then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEM_OUT_OF_RANGE'::text; return; end if;
    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    if coalesce(v_line->>'discountType', 'none') not in ('none', 'fixed', 'percentage') then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text; return; end if;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;
    if v_line_discount_type = 'none' then v_line_discount_input := 0; elsif coalesce(v_line->>'discountValue', '') !~ '^[0-9]+$' then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text; return; else v_line_discount_input := (v_line->>'discountValue')::bigint; end if;
    if v_line_discount_type = 'percentage' and v_line_discount_input > 100 then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text; return; end if;
    if v_line_discount_type = 'fixed' and v_line_discount_input::numeric > v_line_original then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text; return; end if;
    if v_line_discount_type = 'fixed' then v_line_discount := v_line_discount_input::numeric; elsif v_line_discount_type = 'percentage' then v_line_discount := round((v_line_original * v_line_discount_input::numeric) / 100); else v_line_discount := 0; end if;
    v_has_line_discount := v_has_line_discount or v_line_discount_type <> 'none' or v_line_discount_input > 0;
    v_subtotal := v_subtotal + v_line_original;
    v_discount_amount := v_discount_amount + v_line_discount;
  end loop;

  if v_has_line_discount then
    v_effective_discount_type := 'none';
    v_discount_input := 0;
  else
    v_legacy_discount_type := v_invoice.discount_type;
    v_effective_discount_type := v_legacy_discount_type;
    if v_legacy_discount_type = 'none' then v_discount_input := 0; else v_discount_input := v_invoice.discount_input_value; end if;
    if v_legacy_discount_type = 'percentage' then if v_discount_input > 100 then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text; return; end if; v_discount_amount := round((v_subtotal * v_discount_input::numeric) / 100); elsif v_legacy_discount_type = 'fixed' then v_discount_amount := least(v_subtotal, v_discount_input::numeric); end if;
  end if;

  v_total := greatest(0, v_subtotal - v_discount_amount);
  if v_total > 9223372036854775807 or v_discount_amount > 9223372036854775807 then return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'TOTAL_OUT_OF_RANGE'::text; return; end if;
  select w.invoice_number_prefix into v_prefix from public.workspaces w where w.id = v_workspace_id for update;
  update public.workspaces set invoice_sequence = invoice_sequence + 1, updated_at = now() where id = v_workspace_id returning invoice_sequence into v_sequence;
  v_invoice_number := v_prefix || '-' || lpad(v_sequence::text, 4, '0');
  insert into public.number_reservations (workspace_id, sequence_value, prefix_snapshot, formatted_number, invoice_id, status) values (v_workspace_id, v_sequence, v_prefix, v_invoice_number, p_invoice_id, 'consumed') returning id into v_reservation_id;
  insert into private.invoice_finalization_requests (workspace_id, idempotency_key, invoice_id, request_fingerprint, reservation_id, status) values (v_workspace_id, p_idempotency_key, p_invoice_id, v_fingerprint, v_reservation_id, 'reserved');

  v_canonical := jsonb_set(v_canonical, '{totals}', jsonb_build_object('subtotal', v_subtotal::bigint, 'discountAmount', v_discount_amount::bigint, 'total', v_total::bigint), true);
  delete from public.invoice_lines where invoice_id = p_invoice_id;
  v_position := 0;
  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    v_quantity := (v_line->>'quantity')::bigint;
    v_unit_price := (v_line->>'unitPrice')::bigint;
    v_line_discount_type := coalesce(v_line->>'discountType', 'none')::public.discount_type;
    v_line_discount_input := case when v_line_discount_type = 'none' then 0 else (v_line->>'discountValue')::bigint end;
    v_line_original := v_quantity::numeric * v_unit_price::numeric;
    v_line_discount := case when v_has_line_discount and v_line_discount_type = 'fixed' then v_line_discount_input::numeric when v_has_line_discount and v_line_discount_type = 'percentage' then round((v_line_original * v_line_discount_input::numeric) / 100) else 0 end;
    v_line_total := v_line_original - v_line_discount;
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, discount_type, discount_input_value, original_amount, discount_amount, line_total) values (p_invoice_id, v_position, trim(v_line->>'description'), v_quantity::integer, v_unit_price, case when v_has_line_discount then v_line_discount_type else 'none' end, case when v_has_line_discount then v_line_discount_input else 0 end, v_line_original::bigint, v_line_discount::bigint, v_line_total::bigint);
    v_position := v_position + 1;
  end loop;

  update public.invoices
  set lifecycle_status = 'finalized', invoice_number = v_invoice_number, sequence_value = v_sequence, number_prefix_snapshot = v_prefix,
      discount_type = v_effective_discount_type, discount_input_value = v_discount_input::integer, subtotal_amount = v_subtotal::bigint, discount_amount = v_discount_amount::bigint, total_amount = v_total::bigint, canonical_document = v_canonical,
      seller_snapshot = jsonb_build_object('companyName', v_canonical->>'sellerCompanyName', 'name', v_canonical->>'sellerName', 'email', coalesce(v_canonical->>'sellerEmail', ''), 'phone', coalesce(v_canonical->>'sellerPhone', ''), 'address', coalesce(v_canonical->>'sellerAddress', '')),
      customer_snapshot = jsonb_build_object('companyName', v_canonical->>'buyerCompanyName', 'name', v_canonical->>'buyerName', 'email', coalesce(v_canonical->>'buyerEmail', ''), 'phone', coalesce(v_canonical->>'buyerPhone', ''), 'address', coalesce(v_canonical->>'buyerAddress', '')),
      version = version + 1, finalized_at = now(), updated_at = now()
  where id = p_invoice_id and workspace_id = v_workspace_id;

  v_result := jsonb_build_object('invoiceId', p_invoice_id, 'invoiceNumber', v_invoice_number, 'sequenceValue', v_sequence, 'version', v_invoice.version + 1);
  update private.invoice_finalization_requests set status = 'completed', result = v_result, completed_at = now() where workspace_id = v_workspace_id and idempotency_key = p_idempotency_key;
  return query select p_invoice_id, v_invoice_number, v_sequence, v_invoice.version + 1, false, null::text;
end;
$$;

revoke all on function public.finalize_invoice(uuid, uuid, bigint) from public, anon;
grant execute on function public.finalize_invoice(uuid, uuid, bigint) to authenticated;

revoke all on function public.save_invoice_draft(uuid, bigint, date, date, public.payment_status, public.discount_type, integer, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_invoice_draft(uuid, bigint, date, date, public.payment_status, public.discount_type, integer, jsonb, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.update_finalized_invoice(uuid, bigint, jsonb, date, date, public.payment_status) from public, anon;
grant execute on function public.update_finalized_invoice(uuid, bigint, jsonb, date, date, public.payment_status) to authenticated;

commit;
