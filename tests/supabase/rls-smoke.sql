-- Non-destructive anonymous RLS smoke test.
-- Run only against a disposable/test Supabase database. No credentials belong here.
-- The runner sets role anon, so auth.uid() is NULL and protected tables must be empty.

begin;
set local role anon;

DO $$
declare
  table_name text;
  has_rows boolean;
begin
  foreach table_name in array array['workspaces', 'profiles', 'seller_profiles', 'customers', 'templates', 'invoices', 'invoice_lines'] loop
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
end
$$;

rollback;
