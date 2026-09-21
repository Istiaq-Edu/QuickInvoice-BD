drop policy if exists "users can read own profile" on public.profiles;
drop policy if exists "users can update own profile safely" on public.profiles;

create policy "users can read own profile" on public.profiles
for select
using (user_id = (select auth.uid()));

create policy "users can update own profile safely" on public.profiles
for update
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and workspace_id = public.current_workspace_id()
  and is_admin = public.current_profile_is_admin()
  and status = 'active'
);
