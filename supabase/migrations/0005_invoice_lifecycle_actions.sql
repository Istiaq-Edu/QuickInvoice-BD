create or replace function public.revise_invoice(p_invoice_id uuid)
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
  v_source public.invoices%rowtype;
  v_document jsonb;
  v_new_id uuid;
  v_new_version bigint;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  select * into v_source
  from public.invoices
  where id = p_invoice_id and workspace_id = v_workspace_id
  for share;

  if not found then
    return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  if v_source.lifecycle_status <> 'finalized' then
    return query select p_invoice_id, null::bigint, 'NOT_FINALIZED'::text;
    return;
  end if;

  v_document := jsonb_set(
    coalesce(v_source.canonical_document, '{}'::jsonb),
    '{paymentStatus}',
    '"unpaid"'::jsonb,
    true
  );

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
    customer_snapshot,
    template_snapshot,
    logo_asset_id_snapshot
  ) values (
    v_workspace_id,
    'draft',
    v_source.issue_date,
    v_source.due_date,
    'unpaid',
    v_source.discount_type,
    v_source.discount_input_value,
    v_source.subtotal_amount,
    v_source.discount_amount,
    v_source.total_amount,
    v_document,
    v_source.seller_snapshot,
    v_source.customer_snapshot,
    v_source.template_snapshot,
    v_source.logo_asset_id_snapshot
  )
  returning id, version into v_new_id, v_new_version;

  insert into public.invoice_lines (
    invoice_id,
    position,
    description,
    quantity,
    unit_price,
    line_total
  )
  select
    v_new_id,
    position,
    description,
    quantity,
    unit_price,
    line_total
  from public.invoice_lines
  where invoice_id = p_invoice_id
  order by position;

  return query select v_new_id, v_new_version, null::text;
end;
$$;

create or replace function public.update_invoice_payment_status(
  p_invoice_id uuid,
  p_payment_status public.payment_status
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
  v_document jsonb;
  v_version bigint;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  update public.invoices
  set payment_status = p_payment_status,
      canonical_document = jsonb_set(
        coalesce(canonical_document, '{}'::jsonb),
        '{paymentStatus}',
        to_jsonb(p_payment_status::text),
        true
      ),
      version = version + 1,
      updated_at = now()
  where id = p_invoice_id
    and workspace_id = v_workspace_id
    and lifecycle_status = 'finalized'
  returning version, canonical_document into v_version, v_document;

  if not found then
    return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  return query select p_invoice_id, v_version, null::text;
end;
$$;

create or replace function public.trash_invoice(p_invoice_id uuid)
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
  v_version bigint;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  update public.invoices
  set lifecycle_status = 'trashed',
      trashed_at = now(),
      version = version + 1,
      updated_at = now()
  where id = p_invoice_id
    and workspace_id = v_workspace_id
    and lifecycle_status <> 'trashed'
  returning version into v_version;

  if not found then
    return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  return query select p_invoice_id, v_version, null::text;
end;
$$;

create or replace function public.restore_invoice(p_invoice_id uuid)
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
  v_version bigint;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  update public.invoices
  set lifecycle_status = case when invoice_number is null then 'draft' else 'finalized' end,
      trashed_at = null,
      version = version + 1,
      updated_at = now()
  where id = p_invoice_id
    and workspace_id = v_workspace_id
    and lifecycle_status = 'trashed'
  returning version into v_version;

  if not found then
    return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  return query select p_invoice_id, v_version, null::text;
end;
$$;

create or replace function public.permanently_delete_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    return 'AUTH_REQUIRED';
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return 'WORKSPACE_NOT_FOUND';
  end if;

  delete from public.invoices
  where id = p_invoice_id
    and workspace_id = v_workspace_id
    and lifecycle_status = 'trashed';

  if not found then
    return 'INVOICE_NOT_FOUND';
  end if;

  return null;
end;
$$;

revoke all on function public.revise_invoice(uuid) from public, anon;
revoke all on function public.update_invoice_payment_status(uuid, public.payment_status) from public, anon;
revoke all on function public.trash_invoice(uuid) from public, anon;
revoke all on function public.restore_invoice(uuid) from public, anon;
revoke all on function public.permanently_delete_invoice(uuid) from public, anon;
grant execute on function public.revise_invoice(uuid) to authenticated;
grant execute on function public.update_invoice_payment_status(uuid, public.payment_status) to authenticated;
grant execute on function public.trash_invoice(uuid) to authenticated;
grant execute on function public.restore_invoice(uuid) to authenticated;
grant execute on function public.permanently_delete_invoice(uuid) to authenticated;
