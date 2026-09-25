begin;

-- Superseded logos used to accumulate forever. Every upload creates a new
-- object plus a new row and only `workspaces.current_logo_asset_id` moves, so a
-- user who replaces their logo a few times leaves every superseded file in the
-- bucket until the whole account is purged.
--
-- Retention is two-phase, so a mistake is recoverable and a sweep is retryable:
--
--   1. mark_unused_logo_assets() soft deletes assets nothing points at. Every
--      read path already filters `deleted_at is null`, so a marked asset
--      disappears from the app immediately while its object is still intact.
--   2. after a grace window the worker deletes the object and stamps
--      `storage_purged_at`, which doubles as the idempotency marker: the worker
--      removes objects before stamping, so a failed removal is retried on the
--      next run instead of leaking.
--
-- Rows are intentionally never hard deleted here. Invoice snapshots stay
-- protected by prevent_historical_logo_delete, and account purge still removes
-- every row and object for a workspace.
alter table public.logo_assets
  add column if not exists storage_purged_at timestamptz;

-- Re-uploading an identical image is a no-op, so the upload route looks a live
-- asset up by workspace and content hash. Not unique on purpose: pre-existing
-- rows were never deduplicated, and a concurrent pair of identical uploads is
-- harmless because retention reclaims the loser.
--
-- Rows written before this migration still hold the old `size:lastModified`
-- fingerprint in content_hash. That value is not a SHA-256, so it can never
-- match a lookup and those rows simply never deduplicate; the column is not
-- rewritten because the original bytes would have to be re-read from storage to
-- re-hash them, and a wrong hash is worse than no hash.
create index if not exists logo_assets_workspace_content_idx
  on public.logo_assets (workspace_id, content_hash)
  where deleted_at is null;

-- Only assets waiting for their object to be removed are indexed here.
create index if not exists logo_assets_pending_sweep_idx
  on public.logo_assets (deleted_at)
  where deleted_at is not null and storage_purged_at is null;

-- Retirement walks live assets oldest first, so it can stop at its batch limit
-- instead of scanning the whole table.
create index if not exists logo_assets_live_created_idx
  on public.logo_assets (created_at)
  where deleted_at is null and storage_purged_at is null;

-- Retirement also asks whether any draft still points at an asset through its
-- document. Invoices already have an index on the snapshot column, but the
-- document expression had none, which turned that check into a full scan per
-- candidate asset.
create index if not exists invoices_logo_document_idx
  on public.invoices ((canonical_document ->> 'logoAssetId'))
  where canonical_document ->> 'logoAssetId' is not null;

-- Marks unused logo assets as retired once they are older than the retention
-- window. An asset is left alone while it is still reachable: the workspace's
-- current logo, a saved seller profile's logo, or a logo any invoice points at,
-- whether through the finalization snapshot or the draft's canonical document.
create or replace function public.mark_unused_logo_assets(
  p_retention_days integer default 30,
  p_limit integer default 500
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if current_user <> 'service_role'
     and current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Service-role access is required.' using errcode = '42501';
  end if;

  with candidates as (
    select la.id
    from public.logo_assets la
    join public.workspaces w on w.id = la.workspace_id
    where la.deleted_at is null
      and la.storage_purged_at is null
      and la.created_at < now() - make_interval(days => greatest(coalesce(p_retention_days, 30), 0))
      and w.current_logo_asset_id is distinct from la.id
      and not exists (
        select 1
        from public.seller_profiles sp
        where sp.logo_asset_id = la.id
      )
      and not exists (
        select 1
        from public.invoices i
        where i.workspace_id = la.workspace_id
          and (i.logo_asset_id_snapshot = la.id
               or i.canonical_document ->> 'logoAssetId' = la.id::text)
      )
    order by la.created_at
    for update of la skip locked
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  ), marked as (
    update public.logo_assets la
    set deleted_at = now()
    from candidates
    where la.id = candidates.id
    returning la.id
  )
  select coalesce(array_agg(marked.id), array[]::uuid[])
  into v_ids
  from marked;

  return v_ids;
end;
$$;

-- An operator function, never an API surface: the worker calls it with the
-- service role, and no browser session can reach it.
revoke all on function public.mark_unused_logo_assets(integer, integer) from public, anon, authenticated;
grant execute on function public.mark_unused_logo_assets(integer, integer) to service_role;

commit;
