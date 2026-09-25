begin;

-- Keep purge history after the workspace (and its owner) is deleted.
alter table public.account_purge_jobs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists allowlist_entry_id uuid,
  add column if not exists target_user_id uuid,
  add column if not exists started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.account_purge_jobs
set id = gen_random_uuid()
where id is null;

alter table public.account_purge_jobs
  drop constraint if exists account_purge_jobs_pkey,
  drop constraint if exists account_purge_jobs_workspace_id_fkey;

alter table public.account_purge_jobs
  alter column id set not null,
  alter column workspace_id drop not null;

alter table public.account_purge_jobs
  add constraint account_purge_jobs_pkey primary key (id),
  add constraint account_purge_jobs_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete set null,
  add constraint account_purge_jobs_allowlist_entry_id_fkey
    foreign key (allowlist_entry_id) references public.allowlist_entries(id) on delete set null;

create unique index if not exists account_purge_jobs_workspace_id_idx
  on public.account_purge_jobs (workspace_id)
  where workspace_id is not null;

-- Backfill the new worker metadata for jobs created by the foundation migration.
update public.account_purge_jobs jobs
set target_user_id = workspaces.owner_user_id
from public.workspaces
where jobs.workspace_id = workspaces.id
  and jobs.target_user_id is null;

update public.account_purge_jobs jobs
set allowlist_entry_id = entries.id
from public.profiles
join public.allowlist_entries entries
  on entries.email_normalized = profiles.email_normalized
where jobs.workspace_id = profiles.workspace_id
  and jobs.allowlist_entry_id is null;

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
    join public.workspaces w on w.id = p.workspace_id
    where p.user_id = auth.uid()
      and p.status = 'active'
      and w.status = 'active'
  ), false)
$$;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_admin()
$$;

-- Profiles are the immutable link between an Auth identity and its workspace.
create or replace function public.prevent_profile_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.workspace_id is distinct from old.workspace_id
     or new.email_normalized is distinct from old.email_normalized then
    raise exception 'Profile identity fields are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profile_identity_change on public.profiles;
create trigger prevent_profile_identity_change
before update of user_id, workspace_id, email_normalized on public.profiles
for each row execute function public.prevent_profile_identity_change();

create or replace function public.prevent_allowlist_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_normalized is distinct from old.email_normalized then
    raise exception 'Allowlist identity fields are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_allowlist_identity_change on public.allowlist_entries;
create trigger prevent_allowlist_identity_change
before update of email_normalized on public.allowlist_entries
for each row execute function public.prevent_allowlist_identity_change();

-- The lock makes the first-admin decision atomic when two accounts are created together.
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
  perform pg_advisory_xact_lock(hashtextextended('quickinvoice:first-admin', 0));
  select not exists (
    select 1
    from public.profiles p
    join public.workspaces w on w.id = p.workspace_id
    where p.is_admin = true
      and p.status = 'active'
      and w.status = 'active'
  ) into first_admin;

  insert into public.workspaces (owner_user_id)
  values (new.id)
  returning id into workspace_id;

  insert into public.profiles (user_id, workspace_id, email_normalized, is_admin)
  values (new.id, workspace_id, lower(trim(new.email)), first_admin);

  insert into public.seller_profiles (workspace_id) values (workspace_id);
  insert into public.templates (workspace_id, settings)
  values (workspace_id, jsonb_build_object('schemaVersion', 1));
  return new;
end;
$$;

-- Mutations go through these functions so authorization and account disablement
-- happen in one transaction instead of relying on a sequence of API writes.
create or replace function public.admin_add_allowlist_entry(p_email_original text)
returns setof public.allowlist_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  existing_entry public.allowlist_entries%rowtype;
  result_entry public.allowlist_entries%rowtype;
begin
  if not public.is_current_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  normalized_email := lower(btrim(coalesce(p_email_original, '')));
  if normalized_email = '' or length(normalized_email) > 320 or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('quickinvoice:allowlist:' || normalized_email, 0));
  select * into existing_entry
  from public.allowlist_entries
  where email_normalized = normalized_email
  for update;

  if existing_entry.id is not null then
    if exists (
      select 1
      from public.profiles
      where email_normalized = normalized_email
        and status <> 'active'
    ) then
      raise exception 'This account is disabled and is pending purge.' using errcode = '55000';
    end if;

    update public.allowlist_entries
    set email_original = p_email_original,
        status = 'approved',
        added_by_user_id = auth.uid(),
        removed_by_user_id = null,
        removed_at = null,
        purge_completed_at = null
    where id = existing_entry.id
    returning * into result_entry;
  else
    insert into public.allowlist_entries (
      email_original,
      email_normalized,
      status,
      added_by_user_id
    )
    values (
      btrim(p_email_original),
      normalized_email,
      'approved',
      auth.uid()
    )
    returning * into result_entry;
  end if;

  return next result_entry;
end;
$$;

create or replace function public.admin_remove_allowlist_entry(p_entry_id uuid)
returns table (
  entry_id uuid,
  workspace_id uuid,
  purge_requested boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_entry public.allowlist_entries%rowtype;
  target_workspace_id uuid;
  target_owner_user_id uuid;
  target_is_admin boolean;
  purge_job_id uuid;
begin
  if not public.is_current_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('quickinvoice:allowlist-admin', 0));
  select * into target_entry
  from public.allowlist_entries
  where id = p_entry_id
  for update;

  if target_entry.id is null then
    raise exception 'Allowlist entry was not found.' using errcode = 'P0002';
  end if;

  select p.workspace_id, p.user_id, p.is_admin
  into target_workspace_id, target_owner_user_id, target_is_admin
  from public.profiles p
  where p.email_normalized = target_entry.email_normalized
  limit 1
  for update;

  if coalesce(target_is_admin, false)
     and (
       select count(*)
       from public.profiles p
       join public.workspaces w on w.id = p.workspace_id
       where p.is_admin = true
         and p.status = 'active'
         and w.status = 'active'
     ) <= 1 then
    raise exception 'The last administrator cannot be removed.' using errcode = '55000';
  end if;

  update public.allowlist_entries
  set status = 'removed',
      removed_by_user_id = auth.uid(),
      removed_at = coalesce(removed_at, now())
  where id = target_entry.id;

  if target_workspace_id is not null then
    update public.profiles
    set status = 'disabled', updated_at = now()
    where workspace_id = target_workspace_id;

    update public.workspaces
    set status = 'disabled', updated_at = now()
    where id = target_workspace_id;

    select id into purge_job_id
    from public.account_purge_jobs
    where account_purge_jobs.workspace_id = target_workspace_id
    for update;

    if purge_job_id is null then
      insert into public.account_purge_jobs (
        workspace_id,
        allowlist_entry_id,
        target_user_id,
        requested_by_user_id,
        status,
        retry_count,
        last_error_code,
        started_at,
        completed_at,
        updated_at
      )
      values (
        target_workspace_id,
        target_entry.id,
        target_owner_user_id,
        auth.uid(),
        'pending',
        0,
        null,
        null,
        null,
        now()
      );
    else
      update public.account_purge_jobs
      set allowlist_entry_id = target_entry.id,
          target_user_id = target_owner_user_id,
          requested_by_user_id = auth.uid(),
          status = 'pending',
          retry_count = 0,
          last_error_code = null,
          started_at = null,
          completed_at = null,
          updated_at = now()
      where id = purge_job_id;
    end if;
  end if;

  return query select target_entry.id, target_workspace_id, target_workspace_id is not null;
end;
$$;

-- The worker is the only caller of this claim function. SKIP LOCKED allows
-- multiple cron invocations without processing the same job concurrently.
create or replace function public.claim_account_purge_jobs(p_limit integer default 10)
returns table (
  id uuid,
  workspace_id uuid,
  allowlist_entry_id uuid,
  target_user_id uuid,
  retry_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user <> 'service_role'
     and current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Service-role access is required.' using errcode = '42501';
  end if;

  return query
  with claimable as (
    select jobs.id
    from public.account_purge_jobs jobs
    where jobs.status in ('pending', 'failed')
       or (jobs.status = 'running' and jobs.started_at < now() - interval '15 minutes')
    order by jobs.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.account_purge_jobs jobs
    set status = 'running',
        retry_count = jobs.retry_count + 1,
        started_at = now(),
        last_error_code = null,
        updated_at = now()
    from claimable
    where jobs.id = claimable.id
    returning jobs.id, jobs.workspace_id, jobs.allowlist_entry_id,
      jobs.target_user_id, jobs.retry_count
  )
  select claimed.id, claimed.workspace_id, claimed.allowlist_entry_id,
    claimed.target_user_id, claimed.retry_count
  from claimed;
end;
$$;

-- Admins may inspect allowlist/job state, but cannot mutate either table directly.
drop policy if exists "admins manage allowlist" on public.allowlist_entries;
drop policy if exists "admins read allowlist" on public.allowlist_entries;
create policy "admins read allowlist" on public.allowlist_entries
for select using (public.is_current_admin());

drop policy if exists "admins read purge jobs" on public.account_purge_jobs;
create policy "admins read purge jobs" on public.account_purge_jobs
for select using (public.is_current_admin());

revoke all on function public.admin_add_allowlist_entry(text) from public, anon;
revoke all on function public.admin_remove_allowlist_entry(uuid) from public, anon;
revoke all on function public.claim_account_purge_jobs(integer) from public, anon, authenticated;
grant execute on function public.admin_add_allowlist_entry(text) to authenticated;
grant execute on function public.admin_remove_allowlist_entry(uuid) to authenticated;
grant execute on function public.claim_account_purge_jobs(integer) to service_role;

commit;
