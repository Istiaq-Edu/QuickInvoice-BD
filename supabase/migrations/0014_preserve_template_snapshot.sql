create or replace function public.snapshot_invoice_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_status = 'finalized' and old.lifecycle_status <> 'finalized' then
    new.template_snapshot := coalesce(new.canonical_document->'templateSettings', '{}'::jsonb);
    if new.logo_asset_id_snapshot is null then
      select w.current_logo_asset_id
        into new.logo_asset_id_snapshot
      from public.workspaces w
      where w.id = new.workspace_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.snapshot_invoice_template() from public, anon, authenticated;
