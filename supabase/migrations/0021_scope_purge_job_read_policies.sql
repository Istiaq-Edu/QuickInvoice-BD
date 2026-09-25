begin;

-- Purge status is only meaningful to signed-in workspace members and admins.
-- Scoping these policies avoids exposing public-role policy branches and removes
-- duplicate permissive policy evaluation for anonymous requests.
drop policy if exists "admins read purge jobs" on public.account_purge_jobs;
drop policy if exists "workspace members read purge state" on public.account_purge_jobs;

create policy "admins read purge jobs" on public.account_purge_jobs
for select to authenticated
using (public.is_current_admin());

create policy "workspace members read purge state" on public.account_purge_jobs
for select to authenticated
using (workspace_id = public.current_workspace_id());

commit;
