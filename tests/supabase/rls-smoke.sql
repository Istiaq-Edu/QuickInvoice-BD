-- Non-destructive anonymous RLS smoke test.
-- Run only against a disposable/test Supabase database. No credentials belong here.
-- The runner sets role anon, so auth.uid() is NULL and protected tables must be empty.
--
-- Everything is wrapped in a transaction that is rolled back, so the retirement
-- function is only ever checked for privileges, never called.

begin;

-- Catalog checks run before the role is switched, because information_schema only
-- shows objects the current role can access and anon has no grant on these tables.
DO $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'logo_assets'
      and column_name = 'storage_purged_at'
  ) then
    raise exception 'public.logo_assets.storage_purged_at is missing; apply 0027_logo_asset_lifecycle.sql';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'logo_assets_workspace_content_idx'
  ) then
    raise exception 'logo dedupe index is missing; apply 0027_logo_asset_lifecycle.sql';
  end if;

  if not has_function_privilege('service_role', 'public.mark_unused_logo_assets(integer, integer)', 'execute') then
    raise exception 'Service role cannot execute public.mark_unused_logo_assets()';
  end if;
end
$$;

set local role anon;

DO $$
declare
  table_name text;
  has_rows boolean;
begin
  foreach table_name in array array['workspaces', 'profiles', 'seller_profiles', 'logo_assets', 'customers', 'templates', 'invoices', 'invoice_lines'] loop
    begin
      execute format('select exists (select 1 from public.%I limit 1)', table_name) into has_rows;
      if has_rows then
        raise exception 'Anonymous role can read rows from public.%', table_name;
      end if;
    exception when insufficient_privilege then
      -- The helper used by the RLS policy intentionally denies anon EXECUTE.
      null;
    end;
  end loop;

  if has_function_privilege('anon', 'public.current_workspace_id()', 'execute') then
    raise exception 'Anonymous role can execute public.current_workspace_id()';
  end if;

  -- The logo retention worker must stay unreachable from a browser session: it
  -- can retire assets for any workspace.
  if has_function_privilege('anon', 'public.mark_unused_logo_assets(integer, integer)', 'execute') then
    raise exception 'Anonymous role can execute public.mark_unused_logo_assets()';
  end if;

  if has_function_privilege('authenticated', 'public.mark_unused_logo_assets(integer, integer)', 'execute') then
    raise exception 'Authenticated role can execute public.mark_unused_logo_assets()';
  end if;
end
$$;

rollback;
