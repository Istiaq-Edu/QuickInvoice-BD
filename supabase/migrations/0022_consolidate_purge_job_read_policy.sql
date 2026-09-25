begin;

drop policy if exists "admins read purge jobs" on public.account_purge_jobs;
drop policy if exists "workspace members read purge state" on public.account_purge_jobs;

create policy "workspace members and admins read purge jobs" on public.account_purge_jobs
for select to authenticated
using (
  public.is_current_admin()
  or workspace_id = public.current_workspace_id()
);

commit;
