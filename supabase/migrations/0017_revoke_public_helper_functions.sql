revoke execute on function public.create_workspace_for_user() from public, anon, authenticated;
revoke execute on function public.enforce_beta_allowlist() from public, anon, authenticated;

revoke execute on function public.current_profile_is_admin() from public, anon;
revoke execute on function public.current_workspace_id() from public, anon;
revoke execute on function public.is_current_admin() from public, anon;
grant execute on function public.current_profile_is_admin() to authenticated;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.is_current_admin() to authenticated;
