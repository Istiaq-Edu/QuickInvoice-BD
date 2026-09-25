begin;

-- A draft document is client supplied, and save_invoice_draft never checked the
-- logoAssetId inside it. Finalization did re-check it (0023), so a forged or
-- foreign id could sit in a draft indefinitely, where it also pinned an asset
-- against logo retention.
--
-- Sanitizing at the point of write is deliberately done with a trigger rather
-- than by rewriting the 268 line draft RPC: one small reviewable object covers
-- every write path, including future ones, and it mirrors the check that
-- finalization already performs. The only thing it ever does is drop an invalid
-- key, so it cannot invent a reference.
--
-- Nothing is lost when a workspace replaces its logo. An asset referenced by a
-- draft document is excluded from retirement (0027), so a re-save of that draft
-- still finds it live and keeps it.
create or replace function public.sanitize_invoice_logo_reference()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_asset_id text;
begin
  if new.canonical_document is null then
    return new;
  end if;

  v_asset_id := nullif(trim(new.canonical_document ->> 'logoAssetId'), '');
  if v_asset_id is null then
    return new;
  end if;

  -- Scoped to the row's own workspace rather than relying on RLS, so the result
  -- is the same whether the write came from a user session or the service role.
  if v_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and exists (
       select 1
       from public.logo_assets la
       where la.id = v_asset_id::uuid
         and la.workspace_id = new.workspace_id
         and la.deleted_at is null
     ) then
    return new;
  end if;

  new.canonical_document := new.canonical_document - 'logoAssetId';
  return new;
end;
$$;

-- Applied on every write; the function returns immediately when the document
-- carries no logo, so the column list is not worth the syntax risk.
drop trigger if exists sanitize_invoice_logo_reference on public.invoices;
create trigger sanitize_invoice_logo_reference
before insert or update on public.invoices
for each row execute function public.sanitize_invoice_logo_reference();

-- A trigger-only helper, not an API surface.
revoke all on function public.sanitize_invoice_logo_reference() from public, anon, authenticated;

commit;
