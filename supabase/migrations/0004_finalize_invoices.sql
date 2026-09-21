create index if not exists number_reservations_invoice_idx
  on public.number_reservations (invoice_id);

create index if not exists invoice_finalization_requests_reservation_idx
  on private.invoice_finalization_requests (reservation_id);

create or replace function public.finalize_invoice(
  p_invoice_id uuid,
  p_idempotency_key uuid,
  p_expected_version bigint
)
returns table (
  result_invoice_id uuid,
  result_invoice_number text,
  result_sequence_value bigint,
  result_version bigint,
  replayed boolean,
  error_code text
)
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
  v_sequence bigint;
  v_reservation_id uuid;
  v_prefix text;
  v_invoice_number text;
  v_fingerprint text;
  v_result jsonb;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'AUTH_REQUIRED'::text;
    return;
  end if;

  if p_invoice_id is null or p_idempotency_key is null or p_expected_version is null then
    return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'INVALID_REQUEST'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and workspace_id = v_workspace_id
  for update;

  if not found then
    return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  v_canonical := coalesce(v_invoice.canonical_document, '{}'::jsonb);
  v_fingerprint := md5(v_canonical::text || ':' || v_invoice.version::text);

  select * into v_request
  from private.invoice_finalization_requests
  where workspace_id = v_workspace_id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_request.invoice_id <> p_invoice_id then
      return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'IDEMPOTENCY_MISMATCH'::text;
      return;
    end if;
    if v_request.status = 'completed' and v_request.result is not null then
      return query select
        (v_request.result->>'invoiceId')::uuid,
        v_request.result->>'invoiceNumber',
        (v_request.result->>'sequenceValue')::bigint,
        (v_request.result->>'version')::bigint,
        true,
        null::text;
      return;
    end if;
    if v_request.status = 'orphaned' then
      return query select p_invoice_id, null::text, null::bigint, null::bigint, true, coalesce(v_request.error_code, 'FINALIZATION_FAILED');
      return;
    end if;
    if v_request.request_fingerprint <> v_fingerprint then
      return query select p_invoice_id, null::text, null::bigint, null::bigint, false, 'IDEMPOTENCY_MISMATCH'::text;
      return;
    end if;
  end if;

  if v_invoice.lifecycle_status <> 'draft' then
    return query select p_invoice_id, v_invoice.invoice_number, v_invoice.sequence_value, v_invoice.version, false, 'ALREADY_FINALIZED'::text;
    return;
  end if;

  if v_invoice.version <> p_expected_version then
    return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'VERSION_CONFLICT'::text;
    return;
  end if;

  if nullif(trim(v_canonical->>'sellerCompanyName'), '') is null
    or nullif(trim(v_canonical->>'sellerName'), '') is null
    or nullif(trim(v_canonical->>'buyerCompanyName'), '') is null
    or nullif(trim(v_canonical->>'buyerName'), '') is null then
    return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'REQUIRED_FIELDS_MISSING'::text;
    return;
  end if;

  if jsonb_typeof(v_canonical->'lines') <> 'array' or jsonb_array_length(v_canonical->'lines') = 0 then
    return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEMS_REQUIRED'::text;
    return;
  end if;

  for v_line in select value from jsonb_array_elements(v_canonical->'lines')
  loop
    if nullif(trim(v_line->>'description'), '') is null
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$'
      or coalesce(v_line->>'unitPrice', '') !~ '^[0-9]+$' then
      return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEM_INVALID'::text;
      return;
    end if;

    begin
      v_quantity := (v_line->>'quantity')::bigint;
      v_unit_price := (v_line->>'unitPrice')::bigint;
    exception when others then
      return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEM_INVALID'::text;
      return;
    end;

    if v_quantity < 1 or v_quantity > 1000000 or v_unit_price < 0 or v_unit_price > 1000000000000 then
      return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'LINE_ITEM_OUT_OF_RANGE'::text;
      return;
    end if;

    v_subtotal := v_subtotal + (v_quantity::numeric * v_unit_price::numeric);
    v_position := v_position + 1;
  end loop;

  if v_subtotal > 9223372036854775807 then
    return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'TOTAL_OUT_OF_RANGE'::text;
    return;
  end if;

  if v_invoice.discount_type = 'none' then
    v_discount_input := 0;
  elsif coalesce(v_canonical->>'discountValue', '') !~ '^[0-9]+$' then
    return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text;
    return;
  else
    begin
      v_discount_input := (v_canonical->>'discountValue')::bigint;
    exception when others then
      return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text;
      return;
    end;
  end if;

  if v_invoice.discount_type = 'percentage' then
    if v_discount_input > 100 then
      return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text;
      return;
    end if;
    v_discount_amount := round((v_subtotal * v_discount_input::numeric) / 100);
  elsif v_invoice.discount_type = 'fixed' then
    if v_discount_input::numeric > v_subtotal then
      return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'DISCOUNT_INVALID'::text;
      return;
    end if;
    v_discount_amount := v_discount_input;
  end if;

  v_total := greatest(0, v_subtotal - v_discount_amount);
  if v_total > 9223372036854775807 or v_discount_amount > 9223372036854775807 then
    return query select p_invoice_id, null::text, null::bigint, v_invoice.version, false, 'TOTAL_OUT_OF_RANGE'::text;
    return;
  end if;

  select w.invoice_number_prefix into v_prefix
  from public.workspaces w
  where w.id = v_workspace_id
  for update;

  update public.workspaces
  set invoice_sequence = invoice_sequence + 1,
      updated_at = now()
  where id = v_workspace_id
  returning invoice_sequence into v_sequence;

  v_invoice_number := v_prefix || '-' || lpad(v_sequence::text, 4, '0');

  insert into public.number_reservations (
    workspace_id, sequence_value, prefix_snapshot, formatted_number, invoice_id, status
  ) values (
    v_workspace_id, v_sequence, v_prefix, v_invoice_number, p_invoice_id, 'consumed'
  ) returning id into v_reservation_id;

  insert into private.invoice_finalization_requests (
    workspace_id, idempotency_key, invoice_id, request_fingerprint, reservation_id, status
  ) values (
    v_workspace_id, p_idempotency_key, p_invoice_id, v_fingerprint,
    v_reservation_id,
    'reserved'
  );

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
    v_position := v_position + 1;
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, line_total)
    values (
      p_invoice_id,
      v_position - 1,
      trim(v_line->>'description'),
      (v_line->>'quantity')::integer,
      (v_line->>'unitPrice')::bigint,
      ((v_line->>'quantity')::numeric * (v_line->>'unitPrice')::numeric)::bigint
    );
  end loop;

  update public.invoices
  set lifecycle_status = 'finalized',
      invoice_number = v_invoice_number,
      sequence_value = v_sequence,
      number_prefix_snapshot = v_prefix,
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
      finalized_at = now(),
      updated_at = now()
  where id = p_invoice_id and workspace_id = v_workspace_id;

  v_result := jsonb_build_object(
    'invoiceId', p_invoice_id,
    'invoiceNumber', v_invoice_number,
    'sequenceValue', v_sequence,
    'version', v_invoice.version + 1
  );

  update private.invoice_finalization_requests
  set status = 'completed', result = v_result, completed_at = now()
  where workspace_id = v_workspace_id and idempotency_key = p_idempotency_key;

  return query select p_invoice_id, v_invoice_number, v_sequence, v_invoice.version + 1, false, null::text;
end;
$$;

revoke all on function public.finalize_invoice(uuid, uuid, bigint) from public, anon;
grant execute on function public.finalize_invoice(uuid, uuid, bigint) to authenticated;
