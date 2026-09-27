-- Partial payment settlement.
--
-- `payment_status` alone cannot express "billed 10000, received 8000": the only
-- honest options were marking it paid (a lie, 2000 is still owed) or unpaid
-- (losing the fact that 8000 arrived). This adds the missing ledger so partial
-- settlement is recorded, auditable and reversible.
--
-- Design notes:
--   * Payments are rows, not a single counter. A lone amount_paid cannot answer
--     "when did they pay, how much, and by what method", and cannot be corrected
--     when a payment is entered twice.
--   * amount_paid is a stored cache of SUM(invoice_payments.amount) maintained by
--     trigger, so the list view never has to aggregate. The ledger stays the
--     single source of truth.
--   * Overpayment is ALLOWED and surfaced. Real cash arrived, so refusing to
--     record it would leave the books wrong; the UI shows an "Overpaid" state and
--     the balance goes negative, which is a credit the seller can refund or
--     apply to the next invoice.
--   * An invoice whose payments meet or exceed its total is 'paid', not partial.
--
-- An enum value cannot be added and used in the same transaction, so the type
-- change is committed on its own before the rest of the migration runs.
begin;

-- The enum and the table are created only if absent, so a partially applied 0031
-- can be re-run. Without this the bare transaction below is poisoned by the first
-- "already exists" error and every later statement in the file aborts with it.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'payment_method') then
    create type public.payment_method as enum ('cash', 'bank', 'mobile', 'card', 'other');
  end if;
end
$$;
alter type public.payment_status add value if not exists 'partial';

commit;


begin;

-- settled_on is declared here rather than in 0034, because the sync function in
-- this file writes it. PL/pgSQL defers SQL planning to first execution, so a
-- forward reference would create cleanly and then fail at runtime, leaving the
-- payment ledger unusable until a later migration happened to be applied.
alter table public.invoices
  add column if not exists settled_on date;

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount bigint not null check (amount > 0),
  method public.payment_method not null default 'other',
  reference text not null default '',
  received_on date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- The ledger is read through a workspace-scoped policy and written only through
-- the security-definer RPCs below, matching how invoices themselves are handled.
alter table public.invoice_payments enable row level security;

create policy "workspace members read invoice payments" on public.invoice_payments
for select using (workspace_id = public.current_workspace_id());

-- Revoked in full rather than privilege by privilege. A partial revoke leaves
-- TRUNCATE and TRIGGER granted by Supabase's default privileges, and TRUNCATE is
-- not subject to RLS, so any signed-in user of any workspace could wipe every
-- tenant's payment ledger irrecoverably. Read access comes back via the policy
-- plus an explicit grant, so the table ends up select-only for the browser.
revoke all on table public.invoice_payments from public, anon, authenticated;
grant select on table public.invoice_payments to authenticated;

-- Deleting an invoice takes its payments with it, so a permanently deleted
-- invoice can never leave orphan money rows behind.
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id, received_on desc);
create index invoice_payments_workspace_idx on public.invoice_payments (workspace_id);

-- amount_paid is derived from the ledger and is never written by a client.
alter table public.invoices
  add column if not exists amount_paid bigint not null default 0;

alter table public.invoices drop constraint if exists invoices_amount_paid_check;
alter table public.invoices add constraint invoices_amount_paid_check check (amount_paid >= 0);

-- Recomputes amount_paid and the derived status from the ledger. amount_paid is
-- cached for the list view, so it must never drift from the rows it summarises.
create or replace function public.sync_invoice_payment_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_paid bigint;
begin
  if p_invoice_id is null then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.invoice_payments
  where invoice_id = p_invoice_id;

  -- A trashed or draft invoice keeps its recorded payments but must not be
  -- re-labelled, so the status is only derived for finalized invoices.
  select total_amount into v_total
  from public.invoices
  where id = p_invoice_id and lifecycle_status = 'finalized';

  if not found then
    -- A draft or trashed invoice keeps its recorded payments but is never
    -- re-labelled, so the derived status and paid date are cleared instead of
    -- being left to contradict the money. The version is bumped so a later
    -- optimistic-concurrency edit can see that something changed.
    update public.invoices
    set amount_paid = v_paid,
        payment_status = 'unpaid',
        settled_on = null,
        version = version + 1,
        updated_at = now()
    where id = p_invoice_id;
    return;
  end if;

  update public.invoices
  set amount_paid = v_paid,
      payment_status = case
        when v_paid >= v_total then 'paid'::public.payment_status
        when v_paid > 0 then 'partial'::public.payment_status
        else 'unpaid'::public.payment_status
      end,
      -- The editor reads paymentStatus out of canonical_document, so the column
      -- alone is not enough: without this the document kept the pre-payment
      -- status, and opening a part-paid invoice and autosaving wrote "unpaid" back
      -- over the derived value, relabelling it in the list.
      canonical_document = jsonb_set(
        coalesce(canonical_document, '{}'::jsonb),
        '{paymentStatus}',
        to_jsonb(
          case
            when v_paid >= v_total then 'paid'
            when v_paid > 0 then 'partial'
            else 'unpaid'
          end
        ),
        true
      ),
      -- Stamped only on the transition into a settled state, so the date is when
      -- the invoice actually cleared rather than whenever it was last touched.
      settled_on = case
        when v_paid >= v_total and settled_on is null then current_date
        when v_paid < v_total then null
        else settled_on
      end,
      version = version + 1,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

create or replace function public.sync_invoice_payments_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_invoice_payment_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

create trigger invoice_payments_sync_totals
after insert or update or delete on public.invoice_payments
for each row execute function public.sync_invoice_payments_on_change();

-- Records a payment against a finalized invoice and re-derives the status.
-- Overpayment is deliberately accepted: the money genuinely arrived, and a
-- negative balance is a credit the seller can refund or carry forward.
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount bigint,
  p_method public.payment_method,
  p_reference text,
  p_received_on date,
  p_note text
)
returns table (result_invoice_id uuid, result_amount_paid bigint, result_balance bigint, result_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_invoice public.invoices%rowtype;
  v_amount_paid bigint;
  v_status text;
begin
  if auth.uid() is null then
    return query select p_invoice_id, null::bigint, null::bigint, null::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select p_invoice_id, null::bigint, null::bigint, null::text;
    return;
  end if;

  if p_invoice_id is null or p_amount is null or p_amount <= 0 then
    return query select p_invoice_id, null::bigint, null::bigint, null::text;
    return;
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and workspace_id = v_workspace_id
  for update;

  if not found or v_invoice.lifecycle_status <> 'finalized' then
    return query select p_invoice_id, null::bigint, null::bigint, null::text;
    return;
  end if;

  insert into public.invoice_payments (workspace_id, invoice_id, amount, method, reference, received_on, note, created_by)
  values (v_workspace_id, p_invoice_id, p_amount, coalesce(p_method, 'other'::public.payment_method),
          coalesce(trim(p_reference), ''), coalesce(p_received_on, current_date), coalesce(trim(p_note), ''), auth.uid());

  -- The trigger has already recomputed the totals by this point.
  select i.amount_paid, i.payment_status::text into v_amount_paid, v_status
  from public.invoices i where i.id = p_invoice_id;

  return query select p_invoice_id, v_amount_paid, v_invoice.total_amount - v_amount_paid, v_status;
end;
$$;

-- Removes a single payment so an entry made in error can be corrected without
-- editing history by hand.
create or replace function public.delete_invoice_payment(p_payment_id uuid)
returns table (result_invoice_id uuid, result_amount_paid bigint, result_balance bigint, result_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_invoice_id uuid;
  v_total bigint;
  v_amount_paid bigint;
  v_status text;
begin
  if auth.uid() is null then
    return query select null::uuid, null::bigint, null::bigint, null::text;
    return;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return query select null::uuid, null::bigint, null::bigint, null::text;
    return;
  end if;

  select invoice_id into v_invoice_id
  from public.invoice_payments
  where id = p_payment_id and workspace_id = v_workspace_id;

  if v_invoice_id is null then
    return query select null::uuid, null::bigint, null::bigint, null::text;
    return;
  end if;

  -- The parent invoice is locked before the delete, mirroring the write paths.
  -- Without it a re-raise can read the balance, insert a draft for it, and then
  -- have this delete land underneath it, leaving the customer billed for the same
  -- money twice.
  perform 1 from public.invoices
  where id = v_invoice_id and workspace_id = v_workspace_id
  for update;

  delete from public.invoice_payments where id = p_payment_id and workspace_id = v_workspace_id;

  -- The trigger has already recomputed the totals by this point.
  select i.total_amount, i.amount_paid, i.payment_status::text
  into v_total, v_amount_paid, v_status
  from public.invoices i where i.id = v_invoice_id;

  return query select v_invoice_id, v_amount_paid, v_total - v_amount_paid, v_status;
end;
$$;

-- Keeping the manual status control honest.
--
-- The status is now derived from the ledger whenever a payment exists, so a
-- hand-picked value must not be able to contradict it. Marking an invoice paid
-- without itemising a payment is still a legitimate shortcut (cash handed over,
-- no reference), so it is honoured by setting amount_paid to the full total.
-- Clearing an invoice back to unpaid is refused when payments are recorded,
-- because that would erase money that demonstrably arrived; the user removes the
-- payment entries instead, which stays auditable.
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
  v_invoice public.invoices%rowtype;
  v_paid bigint;
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

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and workspace_id = v_workspace_id and lifecycle_status = 'finalized'
  for update;

  if not found then
    return query select p_invoice_id, null::bigint, 'INVOICE_NOT_FOUND'::text;
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.invoice_payments where invoice_id = p_invoice_id;

  if p_payment_status = 'unpaid' and v_paid > 0 then
    return query select p_invoice_id, v_invoice.version, 'PAYMENTS_RECORDED'::text;
    return;
  end if;

  -- 'partial' is derived from the ledger, never chosen. The API route rejects it
  -- as well, but that check is not a boundary: the same session token reaches
  -- PostgREST directly, so the database has to refuse it too. Otherwise an invoice
  -- with no payments can be labelled part-paid and the books contradict the ledger.
  if p_payment_status = 'partial' then
    return query select p_invoice_id, v_invoice.version, 'PARTIAL_IS_DERIVED'::text;
    return;
  end if;

  -- Marking an invoice paid by hand means "the customer settled it, I have not
  -- itemised the money". Recording a real ledger row is what keeps amount_paid
  -- equal to SUM(invoice_payments.amount). Writing the total straight into the
  -- cached column without a row behind it was a real bug: the next payment would
  -- recompute the total from the ledger and the recorded amount would silently
  -- disappear, taking a settled invoice back to partial.
  if p_payment_status = 'paid' and v_paid < v_invoice.total_amount then
    insert into public.invoice_payments (workspace_id, invoice_id, amount, method, reference, received_on, note, created_by)
    values (v_workspace_id, p_invoice_id, v_invoice.total_amount - v_paid, 'other', '', current_date, 'Marked paid in full', auth.uid());
    v_paid := v_invoice.total_amount;
  end if;

  update public.invoices
  set payment_status = p_payment_status,
      -- Always taken from the ledger, never fabricated, so the cache and its
      -- source can never disagree.
      amount_paid = v_paid,
      settled_on = case
        when p_payment_status = 'paid' and settled_on is null then current_date
        when p_payment_status <> 'paid' then null
        else settled_on
      end,
      canonical_document = jsonb_set(
        coalesce(canonical_document, '{}'::jsonb),
        '{paymentStatus}',
        to_jsonb(p_payment_status::text),
        true
      ),
      version = version + 1,
      updated_at = now()
  where id = p_invoice_id and workspace_id = v_workspace_id
  returning version into v_version;

  return query select p_invoice_id, v_version, null::text;
end;
$$;

-- Internal helpers. Both are SECURITY DEFINER so the trigger can write to
-- invoices as its owner, which means an executable grant would let a browser
-- call them directly and bypass the RPCs' workspace checks: anyone able to
-- execute sync_invoice_payment_totals could rewrite amount_paid and bump the
-- version of an invoice belonging to another workspace. They are only ever
-- reached through the trigger or the two RPCs below, so no role needs EXECUTE.
revoke all on function public.sync_invoice_payment_totals(uuid) from public, anon, authenticated;
revoke all on function public.sync_invoice_payments_on_change() from public, anon, authenticated;

revoke all on function public.record_invoice_payment(uuid, bigint, public.payment_method, text, date, text) from public, anon;
grant execute on function public.record_invoice_payment(uuid, bigint, public.payment_method, text, date, text) to authenticated;
revoke all on function public.update_invoice_payment_status(uuid, public.payment_status) from public, anon;
grant execute on function public.update_invoice_payment_status(uuid, public.payment_status) to authenticated;

revoke all on function public.delete_invoice_payment(uuid) from public, anon;
grant execute on function public.delete_invoice_payment(uuid) to authenticated;

commit;
