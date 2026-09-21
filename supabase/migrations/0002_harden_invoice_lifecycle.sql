alter table public.workspaces
  add column if not exists invoice_number_prefix text not null default 'INV',
  add column if not exists invoice_sequence bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_invoice_prefix_check') then
    alter table public.workspaces
      add constraint workspaces_invoice_prefix_check
      check (invoice_number_prefix ~ '^[A-Za-z0-9-]{1,10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspaces_invoice_sequence_check') then
    alter table public.workspaces
      add constraint workspaces_invoice_sequence_check
      check (invoice_sequence >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_lifecycle_number_check') then
    alter table public.invoices
      add constraint invoices_lifecycle_number_check
      check (
        (lifecycle_status = 'draft' and invoice_number is null and sequence_value is null and finalized_at is null)
        or
        (lifecycle_status = 'finalized' and invoice_number is not null and sequence_value is not null and finalized_at is not null)
        or
        (lifecycle_status = 'trashed' and (
          (invoice_number is null and sequence_value is null and finalized_at is null)
          or
          (invoice_number is not null and sequence_value is not null and finalized_at is not null)
        ))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_sequence_value_check') then
    alter table public.invoices
      add constraint invoices_sequence_value_check
      check (sequence_value is null or sequence_value > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_percentage_discount_check') then
    alter table public.invoices
      add constraint invoices_percentage_discount_check
      check (discount_type <> 'percentage' or discount_input_value <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'number_reservations_sequence_check') then
    alter table public.number_reservations
      add constraint number_reservations_sequence_check
      check (sequence_value > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'number_reservations_format_check') then
    alter table public.number_reservations
      add constraint number_reservations_format_check
      check (formatted_number = prefix_snapshot || '-' || lpad(sequence_value::text, 4, '0'));
  end if;
end
$$;

alter table public.number_reservations
  drop constraint if exists number_reservations_status_check;
alter table public.number_reservations
  add constraint number_reservations_status_check
  check (status in ('reserved', 'consumed', 'orphaned'));

create schema if not exists private;

create table if not exists private.invoice_finalization_requests (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key uuid not null,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  request_fingerprint text not null,
  reservation_id uuid references public.number_reservations(id) on delete set null,
  status text not null check (status in ('reserved', 'completed', 'orphaned')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, idempotency_key)
);

create unique index if not exists invoice_finalization_requests_active_invoice_idx
  on private.invoice_finalization_requests (workspace_id, invoice_id)
  where status in ('reserved', 'completed');

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.workspace_id
  from public.profiles p
  join public.workspaces w on w.id = p.workspace_id
  where p.user_id = auth.uid()
    and p.status = 'active'
    and w.status = 'active'
  limit 1
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_admin
    from public.profiles p
    where p.user_id = auth.uid() and p.status = 'active'
  ), false)
$$;

drop policy if exists "workspace members can update workspace" on public.workspaces;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "workspace members manage invoices" on public.invoices;
drop policy if exists "workspace members manage invoice lines" on public.invoice_lines;
drop policy if exists "workspace members read number reservations" on public.number_reservations;

create policy "users can update own profile safely" on public.profiles
for update
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and workspace_id = public.current_workspace_id()
  and is_admin = public.current_profile_is_admin()
  and status = 'active'
);

create policy "workspace members read invoices" on public.invoices
for select
using (workspace_id = public.current_workspace_id());

create policy "workspace members create drafts" on public.invoices
for insert
with check (
  workspace_id = public.current_workspace_id()
  and lifecycle_status = 'draft'
  and invoice_number is null
  and sequence_value is null
  and finalized_at is null
);

create policy "workspace members update drafts" on public.invoices
for update
using (workspace_id = public.current_workspace_id() and lifecycle_status = 'draft')
with check (
  workspace_id = public.current_workspace_id()
  and lifecycle_status = 'draft'
  and invoice_number is null
  and sequence_value is null
  and finalized_at is null
);

create policy "workspace members read invoice lines" on public.invoice_lines
for select
using (exists (
  select 1 from public.invoices
  where invoices.id = invoice_lines.invoice_id
    and invoices.workspace_id = public.current_workspace_id()
));

create policy "workspace members create draft lines" on public.invoice_lines
for insert
with check (exists (
  select 1 from public.invoices
  where invoices.id = invoice_lines.invoice_id
    and invoices.workspace_id = public.current_workspace_id()
    and invoices.lifecycle_status = 'draft'
));

create policy "workspace members update draft lines" on public.invoice_lines
for update
using (exists (
  select 1 from public.invoices
  where invoices.id = invoice_lines.invoice_id
    and invoices.workspace_id = public.current_workspace_id()
    and invoices.lifecycle_status = 'draft'
))
with check (exists (
  select 1 from public.invoices
  where invoices.id = invoice_lines.invoice_id
    and invoices.workspace_id = public.current_workspace_id()
    and invoices.lifecycle_status = 'draft'
));

create policy "workspace members delete draft lines" on public.invoice_lines
for delete
using (exists (
  select 1 from public.invoices
  where invoices.id = invoice_lines.invoice_id
    and invoices.workspace_id = public.current_workspace_id()
    and invoices.lifecycle_status = 'draft'
));

revoke all on private.invoice_finalization_requests from anon, authenticated, public;
revoke all on public.number_reservations from anon, authenticated, public;
