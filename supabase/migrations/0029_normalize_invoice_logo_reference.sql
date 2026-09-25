begin;

-- 0028 validates logoAssetId with nullif(trim(...), '') and a case-insensitive
-- regex, but then stored the document unchanged. 0027 decides what is still
-- referenced with `canonical_document ->> 'logoAssetId' = la.id::text`: an exact,
-- lowercase match on the raw value.
--
-- The two therefore disagreed about what a reference is. A value that 0028
-- accepted could be invisible to 0027, so an asset a live draft was still
-- showing was treated as unused, retired, and then deleted from the bucket by
-- the sweep:
--
--   * padded, '  <uuid>  ' -> accepted because 0028 trims before validating
--   * uppercase, '<UUID>'  -> accepted because the regex is case-insensitive
--
-- Both were reproduced against production. The damage is bounded to the
-- writer's own workspace, because 0028 still scopes the lookup to
-- new.workspace_id, but the broken logo is a customer's, on an invoice they can
-- still edit.
--
-- The fix is to normalise here rather than to trim in 0027: 0027's predicate and
-- invoices_logo_document_idx both read the raw expression, so trimming on the
-- read side would make that index unusable and turn the reference check into a
-- scan per candidate asset. Writing the canonical uuid keeps the stored value
-- and the index in agreement, and retires the padding/case variants entirely.
--
-- The only rewritten value is one that has just been proved to exist, to belong
-- to this row's workspace, and to be live, so this still cannot invent a
-- reference.
create or replace function public.sanitize_invoice_logo_reference()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_asset_id text;
  v_canonical_id uuid;
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
  if v_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select la.id into v_canonical_id
    from public.logo_assets la
    where la.id = v_asset_id::uuid
      and la.workspace_id = new.workspace_id
      and la.deleted_at is null;

    if v_canonical_id is not null then
      -- Always normalise, even when the value already matches: the comparison
      -- is the cheap path and keeps the stored form canonical for every writer.
      if new.canonical_document ->> 'logoAssetId' is distinct from v_canonical_id::text then
        new.canonical_document := new.canonical_document || jsonb_build_object('logoAssetId', v_canonical_id::text);
      end if;
      return new;
    end if;
  end if;

  new.canonical_document := new.canonical_document - 'logoAssetId';
  return new;
end;
$$;

-- A trigger-only helper, not an API surface.
revoke all on function public.sanitize_invoice_logo_reference() from public, anon, authenticated;

commit;
