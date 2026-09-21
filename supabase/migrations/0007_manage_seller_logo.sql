create or replace function public.set_current_logo(p_logo_asset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_updated boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_workspace_id := public.current_workspace_id();
  if v_workspace_id is null then
    return false;
  end if;

  if p_logo_asset_id is not null and not exists (
    select 1
    from public.logo_assets
    where id = p_logo_asset_id
      and workspace_id = v_workspace_id
      and deleted_at is null
  ) then
    return false;
  end if;

  update public.workspaces
  set current_logo_asset_id = p_logo_asset_id,
      updated_at = now()
  where id = v_workspace_id
    and status = 'active';

  v_updated := found;
  return v_updated;
end;
$$;

revoke all on function public.set_current_logo(uuid) from public, anon;
grant execute on function public.set_current_logo(uuid) to authenticated;

create or replace function public.snapshot_invoice_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_status = 'finalized' then
    new.template_snapshot := coalesce(new.canonical_document->'templateSettings', '{}'::jsonb);
    select w.current_logo_asset_id
      into new.logo_asset_id_snapshot
    from public.workspaces w
    where w.id = new.workspace_id;
  end if;
  return new;
end;
$$;
