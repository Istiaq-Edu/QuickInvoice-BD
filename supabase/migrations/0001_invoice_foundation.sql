create extension if not exists pgcrypto;

create type public.workspace_status as enum ('active', 'disabled', 'purge_pending', 'purged');
create type public.invoice_lifecycle as enum ('draft', 'finalized', 'trashed');
create type public.payment_status as enum ('unpaid', 'paid', 'overdue');
create type public.discount_type as enum ('none', 'fixed', 'percentage');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  status public.workspace_status not null default 'active',
  current_logo_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  email_normalized text not null,
  is_admin boolean not null default false,
  status public.workspace_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_normalized_idx on public.profiles (email_normalized);

create table public.allowlist_entries (
  id uuid primary key default gen_random_uuid(),
  email_original text not null,
  email_normalized text not null unique,
  status text not null default 'approved' check (status in ('approved', 'removed', 'purge_pending', 'purged')),
  added_by_user_id uuid references auth.users(id) on delete set null,
  removed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  purge_completed_at timestamptz
);

create table public.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  company_name text not null default '',
  seller_name text not null default '',
  address_text text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  updated_at timestamptz not null default now()
);

create table public.logo_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  content_hash text not null,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.workspaces add constraint workspaces_current_logo_fk foreign key (current_logo_asset_id) references public.logo_assets(id) on delete set null;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_name text not null default '',
  name text not null,
  address_text text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index customers_workspace_name_idx on public.customers (workspace_id, lower(name));

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  schema_version integer not null default 1,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lifecycle_status public.invoice_lifecycle not null default 'draft',
  invoice_number text,
  sequence_value bigint,
  number_prefix_snapshot text,
  issue_date date not null,
  due_date date not null,
  payment_status public.payment_status not null default 'unpaid',
  discount_type public.discount_type not null default 'none',
  discount_input_value integer not null default 0 check (discount_input_value >= 0),
  subtotal_amount bigint not null default 0 check (subtotal_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  canonical_document jsonb not null default '{}'::jsonb,
  seller_snapshot jsonb not null default '{}'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  template_snapshot jsonb not null default '{}'::jsonb,
  logo_asset_id_snapshot uuid references public.logo_assets(id) on delete set null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  trashed_at timestamptz,
  purged_at timestamptz,
  unique (workspace_id, invoice_number),
  unique (workspace_id, sequence_value)
);

create index invoices_workspace_updated_idx on public.invoices (workspace_id, updated_at desc);
create index invoices_workspace_issue_idx on public.invoices (workspace_id, issue_date desc);
create index invoices_workspace_status_idx on public.invoices (workspace_id, payment_status);
create index invoices_workspace_total_idx on public.invoices (workspace_id, total_amount);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null check (position >= 0),
  description text not null default '',
  quantity integer not null default 1 check (quantity >= 1),
  unit_price bigint not null default 0 check (unit_price >= 0),
  line_total bigint not null default 0 check (line_total >= 0),
  unique (invoice_id, position)
);

create table public.number_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_value bigint not null,
  prefix_snapshot text not null,
  formatted_number text not null,
  invoice_id uuid references public.invoices(id) on delete set null,
  status text not null default 'consumed' check (status in ('consumed', 'orphaned')),
  created_at timestamptz not null default now(),
  unique (workspace_id, sequence_value),
  unique (workspace_id, formatted_number)
);

create table public.account_purge_jobs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  retry_count integer not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id
  from public.profiles
  where user_id = auth.uid() and status = 'active'
  limit 1
$$;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_admin = true and status = 'active'
  )
$$;

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.allowlist_entries enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.logo_assets enable row level security;
alter table public.customers enable row level security;
alter table public.templates enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.number_reservations enable row level security;
alter table public.account_purge_jobs enable row level security;

create policy "workspace members can read workspace" on public.workspaces for select using (id = public.current_workspace_id());
create policy "workspace members can update workspace" on public.workspaces for update using (id = public.current_workspace_id()) with check (id = public.current_workspace_id());

create policy "users can read own profile" on public.profiles for select using (user_id = auth.uid());
create policy "users can update own profile" on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid() and workspace_id = public.current_workspace_id());

create policy "admins manage allowlist" on public.allowlist_entries for all using (public.is_current_admin()) with check (public.is_current_admin());

create policy "workspace members manage seller" on public.seller_profiles for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members manage logos" on public.logo_assets for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members manage customers" on public.customers for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members manage templates" on public.templates for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members manage invoices" on public.invoices for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members manage invoice lines" on public.invoice_lines for all using (exists (select 1 from public.invoices where invoices.id = invoice_lines.invoice_id and invoices.workspace_id = public.current_workspace_id())) with check (exists (select 1 from public.invoices where invoices.id = invoice_lines.invoice_id and invoices.workspace_id = public.current_workspace_id()));
create policy "workspace members read number reservations" on public.number_reservations for select using (workspace_id = public.current_workspace_id());
create policy "workspace members read purge state" on public.account_purge_jobs for select using (workspace_id = public.current_workspace_id());

insert into storage.buckets (id, name, public)
values ('seller-logos', 'seller-logos', false)
on conflict (id) do nothing;

create policy "workspace members read own logos" on storage.objects for select using (bucket_id = 'seller-logos' and (storage.foldername(name))[1] = 'workspaces' and (storage.foldername(name))[2] = public.current_workspace_id()::text);
create policy "workspace members upload own logos" on storage.objects for insert with check (bucket_id = 'seller-logos' and (storage.foldername(name))[1] = 'workspaces' and (storage.foldername(name))[2] = public.current_workspace_id()::text);
create policy "workspace members delete own logos" on storage.objects for delete using (bucket_id = 'seller-logos' and (storage.foldername(name))[1] = 'workspaces' and (storage.foldername(name))[2] = public.current_workspace_id()::text);

create or replace function public.enforce_beta_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowlist_entries
    where email_normalized = lower(trim(new.email)) and status = 'approved'
  ) then
    raise exception 'This email is not approved for the private beta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_beta_allowlist_before_user
before insert on auth.users
for each row execute function public.enforce_beta_allowlist();

create or replace function public.create_workspace_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_id uuid;
  first_admin boolean;
begin
  select not exists (select 1 from public.profiles where is_admin = true) into first_admin;
  insert into public.workspaces (owner_user_id) values (new.id) returning id into workspace_id;
  insert into public.profiles (user_id, workspace_id, email_normalized, is_admin)
  values (new.id, workspace_id, lower(trim(new.email)), first_admin);
  insert into public.seller_profiles (workspace_id) values (workspace_id);
  insert into public.templates (workspace_id, settings) values (workspace_id, jsonb_build_object('schemaVersion', 1));
  return new;
end;
$$;

create trigger create_workspace_after_user
after insert on auth.users
for each row execute function public.create_workspace_for_user();
