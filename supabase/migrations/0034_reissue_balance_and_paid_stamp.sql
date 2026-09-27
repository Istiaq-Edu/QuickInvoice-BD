-- Re-raising a balance, and stamping a paid invoice.
--
-- Two related features for the settlement work:
--
--   1. `parent_invoice_id` links a newly raised invoice back to the one it
--      settles the balance of. This is the "progress invoicing" model used by
--      QuickBooks and FreshBooks: instead of editing a part-paid invoice (which
--      would rewrite a document the customer has already paid against), the
--      seller raises a fresh document for the outstanding amount and the two stay
--      linked. The link is what lets a reader prove the two are one engagement.
--
--   2. A paid invoice records when it was settled, so a downloaded PDF can carry
--      a PAID stamp. Without a stored date the stamp could only say "paid" and
--      not "paid on", which is the part a customer or auditor actually needs.
--
-- Generated as plain SQL; apply in order. Note the numbering skips 0033, which
-- was never used: the runner sorts filenames, so 0034 still applies last.
begin;

alter table public.invoices
  add column if not exists parent_invoice_id uuid references public.invoices(id) on delete set null;

alter table public.invoices
  add column if not exists settled_on date;

-- One raise per parent. Without this the endpoint is a direct over-billing
-- primitive: three clicks, or one retried POST, raised three drafts for the same
-- balance. A retried request is indistinguishable from a repeated one, so the
-- database enforces it rather than the client.
create unique index if not exists invoices_single_reissue_idx
  on public.invoices (parent_invoice_id) where parent_invoice_id is not null;

-- A parent link is only meaningful within one workspace. The FK alone is a bare
-- reference to invoices(id) and would happily link two tenants together, so the
-- composite key is what actually enforces it.
alter table public.invoices drop constraint if exists invoices_unique_id_workspace;
alter table public.invoices add constraint invoices_unique_id_workspace unique (id, workspace_id);

alter table public.invoices drop constraint if exists invoices_parent_same_workspace_fk;
alter table public.invoices add constraint invoices_parent_same_workspace_fk
  foreign key (parent_invoice_id, workspace_id) references public.invoices(id, workspace_id) on delete set null;

alter table public.invoices drop constraint if exists invoices_not_self_parent;
alter table public.invoices add constraint invoices_not_self_parent check (parent_invoice_id is null or parent_invoice_id <> id);

create index if not exists invoices_parent_idx
  on public.invoices (parent_invoice_id) where parent_invoice_id is not null;

create index if not exists invoices_settled_idx
  on public.invoices (workspace_id, settled_on) where settled_on is not null;

-- settled_on and the derived status are kept correct by a trigger rather than by
-- each writer remembering to set them. The two edit paths can move the total in
-- either direction, and a paid invoice whose total is then raised would otherwise
-- keep a PAID date while money is outstanding. A trigger is the only way to be
-- sure every write path agrees, including ones added later.
create or replace function public.sync_invoice_settled_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid bigint;
  v_total bigint;
begin
  if new.lifecycle_status <> 'finalized' then
    new.settled_on := null;
    return new;
  end if;

  if new.amount_paid is not distinct from old.amount_paid
     and new.total_amount is not distinct from old.total_amount
     and new.lifecycle_status is not distinct from old.lifecycle_status then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.invoice_payments where invoice_id = new.id;
  v_total := new.total_amount;

  if v_paid >= v_total then
    new.settled_on := coalesce(new.settled_on, current_date);
  else
    new.settled_on := null;
  end if;

  -- The status follows the money. The edit path still accepts a caller's label
  -- for backwards compatibility, but once an invoice has recorded payments the
  -- stored value has to agree with the ledger or the list would show a part-paid
  -- invoice as unpaid. A manual 'unpaid'/'overdue' is preserved because overdue is
  -- a judgement the seller makes; only 'partial' and 'paid' are ledger-derived.
  if v_paid > 0 and new.payment_status in ('unpaid', 'partial', 'paid') then
    new.payment_status := case
      when v_paid >= v_total then 'paid'::public.payment_status
      else 'partial'::public.payment_status
    end;
  elsif v_paid = 0 and new.payment_status = 'paid' then
    new.payment_status := 'unpaid'::public.payment_status;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_sync_settled_state on public.invoices;
create trigger invoices_sync_settled_state
before update on public.invoices
for each row execute function public.sync_invoice_settled_state();

-- Raises a new draft for whatever is still owed on a finalized invoice.
--
-- The amount is computed inside the function, from the ledger, while the invoice
-- row is locked. Computing it in the browser and passing it in would let a
-- concurrent payment slip in between the read and the write and over-bill the
-- customer by that much, which is the one failure mode a billing tool cannot
-- afford.
create or replace function public.reissue_invoice_balance(p_invoice_id uuid)
returns table (result_parent_invoice_id uuid, result_new_invoice_id uuid, result_amount bigint, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_invoice public.invoices%rowtype;
  v_paid bigint;
  v_balance bigint;
  v_document jsonb;
  v_seller jsonb;
  v_customer jsonb;
  v_new_id uuid;
  v_issue_date date := current_date;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::uuid, null::bigint, 'AUTH_REQUIRED'::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::uuid, null::bigint, 'WORKSPACE_NOT_FOUND'::text;
    return;
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and workspace_id = v_workspace_id
  for update;

  if not found or v_invoice.lifecycle_status <> 'finalized' then
    return query select p_invoice_id, null::uuid, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.invoice_payments where invoice_id = p_invoice_id;

  v_balance := v_invoice.total_amount - v_paid;
  if v_balance <= 0 then
    return query select p_invoice_id, null::uuid, null::bigint, 'NOTHING_OUTSTANDING'::text;
    return;
  end if;

  -- An already-raised balance is returned as-is rather than raised again. A
  -- double-click or a retried POST lands here and costs the customer nothing,
  -- which is the behaviour a seller would assume the button already had.
  select id into v_new_id
  from public.invoices
  where parent_invoice_id = v_invoice.id;

  if v_new_id is not null then
    return query select v_invoice.id, v_new_id, v_balance, 'ALREADY_REISSUED'::text;
    return;
  end if;

  v_seller := v_invoice.seller_snapshot;
  v_customer := v_invoice.customer_snapshot;

  -- The raised invoice reproduces the work already done as a single balance
  -- line rather than a partial copy of the original items: the original items
  -- stay intact on the original document, and splitting them across two invoices
  -- would misrepresent what was delivered for this amount.
  v_document := jsonb_build_object(
    'schemaVersion', 1,
    'sellerCompanyName', coalesce(v_seller->>'companyName', ''),
    'sellerName', coalesce(v_seller->>'name', ''),
    'sellerEmail', coalesce(v_seller->>'email', ''),
    'sellerPhone', coalesce(v_seller->>'phone', ''),
    'sellerAddress', coalesce(v_seller->>'address', ''),
    'buyerCompanyName', coalesce(v_customer->>'companyName', ''),
    'buyerName', coalesce(v_customer->>'name', ''),
    'buyerEmail', coalesce(v_customer->>'email', ''),
    'buyerPhone', coalesce(v_customer->>'phone', ''),
    'buyerAddress', coalesce(v_customer->>'address', ''),
    'issueDate', v_issue_date::text,
    'dueDate', (v_issue_date + 14)::text,
    'discountType', 'none',
    'discountValue', 0,
    'paymentStatus', 'unpaid',
    'notes', '',
    -- Snapshotted rather than re-read at render time, so the raised document
    -- still shows the figures that were true when it was raised even if the
    -- original is settled or revised afterwards.
    'carriedForward', jsonb_build_object(
      'invoiceId', v_invoice.id,
      'invoiceNumber', v_invoice.invoice_number,
      'originalTotal', v_invoice.total_amount,
      'received', v_paid,
      'amount', v_balance
    ),
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Balance due from ' || coalesce(v_invoice.invoice_number, 'a previous invoice'),
      'quantity', 1,
      'unitPrice', v_balance,
      'discountType', 'none',
      'discountValue', 0
    ))
  );

  insert into public.invoices (
    workspace_id, lifecycle_status, issue_date, due_date, payment_status,
    discount_type, discount_input_value, subtotal_amount, discount_amount,
    total_amount, canonical_document, seller_snapshot, customer_snapshot,
    -- Carried across from the original so a finalized reissue renders with the
    -- same template and logo instead of silently reverting to defaults.
    template_snapshot, logo_asset_id_snapshot, parent_invoice_id
  ) values (
    v_workspace_id, 'draft', v_issue_date, v_issue_date + 14, 'unpaid',
    'none', 0, v_balance, 0, v_balance, v_document, v_seller, v_customer,
    coalesce(v_invoice.template_snapshot, '{}'::jsonb), v_invoice.logo_asset_id_snapshot,
    v_invoice.id
  )
  returning id into v_new_id;

  insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, discount_type, discount_input_value, original_amount, discount_amount, line_total)
  values (v_new_id, 0, 'Balance due from ' || coalesce(v_invoice.invoice_number, 'a previous invoice'), 1, v_balance, 'none', 0, v_balance, 0, v_balance);

  return query select v_invoice.id, v_new_id, v_balance, null::text;
end;
$$;

revoke all on function public.reissue_invoice_balance(uuid) from public, anon;
grant execute on function public.reissue_invoice_balance(uuid) to authenticated;

commit;

