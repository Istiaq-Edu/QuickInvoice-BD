alter table public.seller_profiles
  add column if not exists logo_asset_id uuid references public.logo_assets(id) on delete set null;

create index if not exists seller_profiles_logo_asset_idx
  on public.seller_profiles (logo_asset_id)
  where logo_asset_id is not null;

create or replace function public.snapshot_invoice_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_status = 'finalized' then
    new.template_snapshot := coalesce(new.canonical_document->'templateSettings', '{}'::jsonb);
    if nullif(new.canonical_document->>'logoAssetId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (
        select 1
        from public.logo_assets la
        where la.id = (new.canonical_document->>'logoAssetId')::uuid
          and la.workspace_id = new.workspace_id
          and la.deleted_at is null
      ) then
      new.logo_asset_id_snapshot := (new.canonical_document->>'logoAssetId')::uuid;
    else
      select w.current_logo_asset_id
        into new.logo_asset_id_snapshot
      from public.workspaces w
      where w.id = new.workspace_id;
    end if;
  end if;
  return new;
end;
$$;
