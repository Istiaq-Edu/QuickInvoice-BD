-- Invoice mutations are exposed through validated security-definer RPCs.
drop policy if exists "workspace members manage invoices" on public.invoices;
drop policy if exists "workspace members create drafts" on public.invoices;
drop policy if exists "workspace members update drafts" on public.invoices;

drop policy if exists "workspace members manage invoice lines" on public.invoice_lines;
drop policy if exists "workspace members create draft lines" on public.invoice_lines;
drop policy if exists "workspace members update draft lines" on public.invoice_lines;
drop policy if exists "workspace members delete draft lines" on public.invoice_lines;
drop policy if exists "workspace members read invoices" on public.invoices;
drop policy if exists "workspace members read invoice lines" on public.invoice_lines;

create policy "workspace members read invoices" on public.invoices
for select using (workspace_id = public.current_workspace_id());

create policy "workspace members read invoice lines" on public.invoice_lines
for select using (exists (
  select 1 from public.invoices
  where invoices.id = invoice_lines.invoice_id
    and invoices.workspace_id = public.current_workspace_id()
));

-- Keep historical logo references intact. Normal logo removal marks the asset
-- unused through set_current_logo(); physical deletion is only allowed for an
-- asset that was never captured by a finalized invoice.
create or replace function public.prevent_historical_logo_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.invoices
    where logo_asset_id_snapshot = old.id
      and lifecycle_status in ('finalized', 'trashed')
  ) then
    raise exception 'Historical logo snapshots cannot be deleted.' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_historical_logo_delete on public.logo_assets;
create trigger prevent_historical_logo_delete
before delete on public.logo_assets
for each row execute function public.prevent_historical_logo_delete();

update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']::text[]
where id = 'seller-logos';

revoke insert, update, delete on public.invoices from anon, authenticated;
revoke insert, update, delete on public.invoice_lines from anon, authenticated;
