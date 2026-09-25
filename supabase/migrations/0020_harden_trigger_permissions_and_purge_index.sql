begin;

-- These functions are invoked by table triggers only. They are not API RPCs.
-- Keep their trigger execution privileges without exposing them through PostgREST.
revoke all on function public.prevent_allowlist_identity_change() from public, anon, authenticated;
revoke all on function public.prevent_historical_logo_delete() from public, anon, authenticated;
revoke all on function public.prevent_profile_identity_change() from public, anon, authenticated;

-- Cover the purge-job foreign key used when allowlist history is retained.
create index if not exists account_purge_jobs_allowlist_entry_id_idx
  on public.account_purge_jobs (allowlist_entry_id)
  where allowlist_entry_id is not null;

commit;
