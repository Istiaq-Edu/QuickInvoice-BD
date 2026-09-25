-- Proves the logo retention rules and the draft sanitiser on a real Postgres.
--
-- Every asset below is old enough to retire, so each row is a separate assertion
-- of one exclusion rule. Wrapped in a transaction that is rolled back, so this is
-- safe to run anywhere.
begin;

-- Inserting a user fires the beta allowlist trigger and then auto-creates that
-- user's workspace, profile, seller profile and template, so the fixtures
-- allowlist first and reuse the workspaces the trigger built.
insert into public.allowlist_entries (email_original, email_normalized, status)
values ('retention-a@example.test', 'retention-a@example.test', 'approved'),
       ('retention-b@example.test', 'retention-b@example.test', 'approved');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000a0', 'retention-a@example.test'),
       ('00000000-0000-4000-8000-0000000000b0', 'retention-b@example.test');

do $$
declare
  v_workspace uuid;
  v_other_workspace uuid;
  v_current uuid := '00000000-0000-4000-8000-0000000000c1';
  v_profile uuid := '00000000-0000-4000-8000-0000000000c2';
  v_snapshot uuid := '00000000-0000-4000-8000-0000000000c3';
  v_document uuid := '00000000-0000-4000-8000-0000000000c4';
  v_foreign uuid := '00000000-0000-4000-8000-0000000000c5';
  v_recent uuid := '00000000-0000-4000-8000-0000000000c6';
  v_unused uuid := '00000000-0000-4000-8000-0000000000c7';
  v_retired uuid[];
begin
  select p.workspace_id into v_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'retention-a@example.test';
  select p.workspace_id into v_other_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'retention-b@example.test';
  if v_workspace is null or v_other_workspace is null then
    raise exception 'fixture workspaces were not created for the seeded users';
  end if;

  -- Assets first: the workspace pointer has a foreign key into this table.
  insert into public.logo_assets (id, workspace_id, storage_path, mime_type, byte_size, content_hash, created_at)
  values
    (v_current,  v_workspace,       'workspaces/a/logos/current.png',  'image/png', 10, 'h1', now() - interval '90 days'),
    (v_profile,  v_workspace,       'workspaces/a/logos/profile.png',  'image/png', 10, 'h2', now() - interval '90 days'),
    (v_snapshot, v_workspace,       'workspaces/a/logos/snapshot.png', 'image/png', 10, 'h3', now() - interval '90 days'),
    (v_document, v_workspace,       'workspaces/a/logos/document.png', 'image/png', 10, 'h4', now() - interval '90 days'),
    (v_foreign,  v_other_workspace, 'workspaces/b/logos/foreign.png',  'image/png', 10, 'h5', now() - interval '90 days'),
    (v_recent,   v_workspace,       'workspaces/a/logos/recent.png',   'image/png', 10, 'h6', now() - interval '2 days'),
    (v_unused,   v_workspace,       'workspaces/a/logos/unused.png',   'image/png', 10, 'h7', now() - interval '90 days');

  update public.workspaces set current_logo_asset_id = v_current where id = v_workspace;
  update public.workspaces set current_logo_asset_id = v_foreign where id = v_other_workspace;

  update public.seller_profiles
  set company_name = 'Acme', seller_name = 'Sam', logo_asset_id = v_profile
  where workspace_id = v_workspace;

  -- A finalized invoice pins the snapshot column and needs a number, a sequence
  -- value and a timestamp (0002), plus a buyer phone (0010). A draft must carry
  -- none of those (0002), which is why its number column is left null. The
  -- sequence value is high so it cannot collide with the numbers the
  -- finalization RPC allocates from the workspace counter.
  insert into public.invoices (workspace_id, invoice_number, sequence_value, issue_date, due_date, canonical_document, logo_asset_id_snapshot, lifecycle_status, finalized_at, customer_snapshot, template_snapshot)
  values (v_workspace, 'RET-0001', 99, current_date, current_date, jsonb_build_object('buyerPhone', '01700000000'), v_snapshot, 'finalized', now(), '{}'::jsonb, '{}'::jsonb),
         (v_workspace, null, null, current_date, current_date, jsonb_build_object('logoAssetId', v_document::text), null, 'draft', null, '{}'::jsonb, '{}'::jsonb);

  -- The worker runs as the service role; the function refuses anyone else.
  perform set_config('request.jwt.claim.role', 'service_role', true);

  -- First call uses a realistic 30 day window. With every fixture older than 90
  -- days except v_recent, this one call proves both mechanisms: v_recent is
  -- spared by age, and everything else is spared by being referenced.
  v_retired := public.mark_unused_logo_assets(30, 100);
  if v_retired is null or array_length(v_retired, 1) <> 1 or v_retired[1] <> v_unused then
    raise exception '30 day window: expected only the unreferenced asset to be retired, got %', coalesce(v_retired::text, 'nothing');
  end if;

  if exists (select 1 from public.logo_assets where id = v_current and deleted_at is not null) then
    raise exception 'the current logo was retired';
  end if;
  if exists (select 1 from public.logo_assets where id = v_profile and deleted_at is not null) then
    raise exception 'a seller profile logo was retired';
  end if;
  if exists (select 1 from public.logo_assets where id = v_snapshot and deleted_at is not null) then
    raise exception 'a finalized invoice snapshot was retired';
  end if;
  if exists (select 1 from public.logo_assets where id = v_document and deleted_at is not null) then
    raise exception 'a draft document logo was retired';
  end if;
  if exists (select 1 from public.logo_assets where id = v_foreign and deleted_at is not null) then
    raise exception 'another workspace''s asset was retired';
  end if;
  if not exists (select 1 from public.logo_assets where id = v_recent and deleted_at is null) then
    raise exception 'an asset inside the retention window was retired';
  end if;

  -- Second call drops the age protection by asking for zero days, so the only
  -- thing still shielding the referenced assets is the reference check itself.
  -- v_recent is now the only unprotected asset, and it must be the only one
  -- retired. (The worker clamps retention to at least one day, so this is a
  -- direct-call scenario, not a worker scenario.)
  v_retired := public.mark_unused_logo_assets(0, 100);
  if v_retired is null or array_length(v_retired, 1) <> 1 or v_retired[1] <> v_recent then
    raise exception 'zero day window: expected only the unreferenced recent asset to be retired, got %', coalesce(v_retired::text, 'nothing');
  end if;
  if exists (
    select 1 from public.logo_assets
    where id in (v_current, v_profile, v_snapshot, v_document, v_foreign) and deleted_at is not null
  ) then
    raise exception 'a referenced asset was retired once age stopped protecting it';
  end if;

  -- A third run must be a no-op, which is what makes the sweep idempotent.
  v_retired := public.mark_unused_logo_assets(0, 100);
  if coalesce(array_length(v_retired, 1), 0) <> 0 then
    raise exception 'a second run retired additional assets: %', v_retired::text;
  end if;
end
$$;

-- The draft sanitiser: a malformed or foreign logoAssetId must be dropped on
-- write, a valid one for the row's own workspace must survive untouched.
do $$
declare
  v_workspace uuid;
  v_foreign uuid := '00000000-0000-4000-8000-0000000000c5';
  v_owned uuid := '00000000-0000-4000-8000-0000000000c8';
  v_padded uuid := '00000000-0000-4000-8000-0000000000ca';
  v_shouted uuid := '00000000-0000-4000-8000-0000000000cb';
  v_document jsonb;
  v_row uuid;
begin
  select p.workspace_id into v_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'retention-a@example.test';

  insert into public.logo_assets (id, workspace_id, storage_path, mime_type, byte_size, content_hash)
  values (v_owned, v_workspace, 'workspaces/a/logos/owned.png', 'image/png', 10, 'h8');

  -- Drafts carry no invoice number (0002), so each row is identified by the id
  -- the insert returns rather than by a number.
  insert into public.invoices (workspace_id, issue_date, due_date, canonical_document, customer_snapshot, template_snapshot)
  values (v_workspace, current_date, current_date, jsonb_build_object('logoAssetId', v_owned::text, 'keep', 'yes'), '{}'::jsonb, '{}'::jsonb)
  returning id into v_row;
  select canonical_document into v_document from public.invoices where id = v_row;
  if v_document ->> 'logoAssetId' is distinct from v_owned::text then
    raise exception 'a valid workspace logo reference was dropped on write';
  end if;
  if v_document ->> 'keep' is distinct from 'yes' then
    raise exception 'the sanitiser altered unrelated document fields';
  end if;

  -- 0029. 0028 validated the id after trimming it and matched the regex
  -- case-insensitively, but stored whatever the client sent. 0027 decides what
  -- is still referenced with an exact, lowercase comparison against the raw
  -- text, so a padded or uppercased id passed the sanitiser and was then
  -- invisible to retention: the asset was retired, and the sweep deleted the
  -- file, while a live draft was still pointing at it. Both spellings are
  -- accepted inputs, so both have to be written back in canonical form.
  insert into public.logo_assets (id, workspace_id, storage_path, mime_type, byte_size, content_hash, created_at)
  values (v_padded, v_workspace, 'workspaces/a/logos/padded.png', 'image/png', 10, 'h10', now() - interval '90 days'),
         (v_shouted, v_workspace, 'workspaces/a/logos/shouted.png', 'image/png', 10, 'h11', now() - interval '90 days');

  insert into public.invoices (workspace_id, issue_date, due_date, canonical_document, customer_snapshot, template_snapshot)
  values (v_workspace, current_date, current_date, jsonb_build_object('logoAssetId', '  ' || upper(v_padded::text) || '  '), '{}'::jsonb, '{}'::jsonb)
  returning id into v_row;
  select canonical_document into v_document from public.invoices where id = v_row;
  if v_document ->> 'logoAssetId' is distinct from v_padded::text then
    raise exception 'a padded, uppercased logo reference was not normalised to the bare uuid: %', coalesce(v_document ->> 'logoAssetId', 'stripped');
  end if;

  insert into public.invoices (workspace_id, issue_date, due_date, canonical_document, customer_snapshot, template_snapshot)
  values (v_workspace, current_date, current_date, jsonb_build_object('logoAssetId', upper(v_shouted::text)), '{}'::jsonb, '{}'::jsonb)
  returning id into v_row;
  select canonical_document into v_document from public.invoices where id = v_row;
  if v_document ->> 'logoAssetId' is distinct from v_shouted::text then
    raise exception 'an uppercased logo reference was not normalised to the bare uuid: %', coalesce(v_document ->> 'logoAssetId', 'stripped');
  end if;

  -- Normalising is only worth anything if retention can then see the reference.
  -- With a zero day window these two are old enough to retire, and the draft
  -- pointing at each of them is the only thing protecting them.
  perform public.mark_unused_logo_assets(0, 100);
  if exists (select 1 from public.logo_assets where id in (v_padded, v_shouted) and deleted_at is not null) then
    raise exception 'an asset referenced by a non-canonical draft was retired';
  end if;

  insert into public.invoices (workspace_id, issue_date, due_date, canonical_document, customer_snapshot, template_snapshot)
  values (v_workspace, current_date, current_date, jsonb_build_object('logoAssetId', 'not-a-uuid'), '{}'::jsonb, '{}'::jsonb)
  returning id into v_row;
  select canonical_document into v_document from public.invoices where id = v_row;
  if v_document ? 'logoAssetId' then
    raise exception 'a malformed logo reference survived the write';
  end if;

  insert into public.invoices (workspace_id, issue_date, due_date, canonical_document, customer_snapshot, template_snapshot)
  values (v_workspace, current_date, current_date, jsonb_build_object('logoAssetId', v_foreign::text), '{}'::jsonb, '{}'::jsonb)
  returning id into v_row;
  select canonical_document into v_document from public.invoices where id = v_row;
  if v_document ? 'logoAssetId' then
    raise exception 'another workspace''s asset reference survived the write';
  end if;

  insert into public.invoices (workspace_id, issue_date, due_date, canonical_document, customer_snapshot, template_snapshot)
  values (v_workspace, current_date, current_date, jsonb_build_object('note', 'no logo here'), '{}'::jsonb, '{}'::jsonb)
  returning id into v_row;
  if not exists (select 1 from public.invoices where id = v_row) then
    raise exception 'a document without a logo failed to save';
  end if;
end
$$;

-- The same two checks through the real RPC path, as the seeded user, so the
-- draft-save and finalization flows are exercised rather than raw table writes.
-- This is what proves the sanitiser sits in front of finalization safely: a
-- stripped reference falls back to the workspace's current logo instead of
-- leaving the invoice without one.
do $$
declare
  v_user uuid := '00000000-0000-4000-8000-0000000000a0';
  v_workspace uuid;
  v_current uuid := '00000000-0000-4000-8000-0000000000c1';
  v_owned uuid := '00000000-0000-4000-8000-0000000000c9';
  v_foreign uuid := '00000000-0000-4000-8000-0000000000c5';
  v_draft_bad uuid;
  v_draft_good uuid;
  v_document jsonb;
  v_error text;
begin
  select p.workspace_id into v_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'retention-a@example.test';

  insert into public.logo_assets (id, workspace_id, storage_path, mime_type, byte_size, content_hash)
  values (v_owned, v_workspace, 'workspaces/a/logos/rpc-owned.png', 'image/png', 10, 'h9');

  -- Finalization allocates a number from the workspace prefix.
  update public.workspaces set invoice_number_prefix = 'QI' where id = v_workspace;

  -- Impersonate the seeded user the way a signed-in session would.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- A draft whose document points at another workspace's asset.
  select result_invoice_id, error_code into v_draft_bad, v_error
  from public.save_invoice_draft(
    null, null, current_date, current_date, 'unpaid', 'none', 0,
    jsonb_build_object(
      'schemaVersion', 1,
      'sellerCompanyName', 'Acme', 'sellerName', 'Sam',
      'buyerCompanyName', 'Buyer Ltd', 'buyerName', 'Buyer',
      'buyerPhone', '01700000000',
      'logoAssetId', v_foreign::text,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Work', 'quantity', '2', 'unitPrice', '1500'))),
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('description', 'Work', 'quantity', '2', 'unitPrice', '1500'))
  );
  if v_error is not null then
    raise exception 'saving a draft with a foreign logo reference failed: %', v_error;
  end if;

  select canonical_document into v_document from public.invoices where id = v_draft_bad;
  if v_document ? 'logoAssetId' then
    raise exception 'the RPC path stored a foreign logo reference';
  end if;

  -- A draft whose document points at its own workspace's live asset.
  select result_invoice_id, error_code into v_draft_good, v_error
  from public.save_invoice_draft(
    null, null, current_date, current_date, 'unpaid', 'none', 0,
    jsonb_build_object(
      'schemaVersion', 1,
      'sellerCompanyName', 'Acme', 'sellerName', 'Sam',
      'buyerCompanyName', 'Buyer Ltd', 'buyerName', 'Buyer',
      'buyerPhone', '01700000000',
      'logoAssetId', v_owned::text,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Work', 'quantity', '1', 'unitPrice', '1000'))),
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('description', 'Work', 'quantity', '1', 'unitPrice', '1000'))
  );
  if v_error is not null then
    raise exception 'saving a draft with a valid logo reference failed: %', v_error;
  end if;

  select canonical_document into v_document from public.invoices where id = v_draft_good;
  if v_document ->> 'logoAssetId' is distinct from v_owned::text then
    raise exception 'the RPC path dropped a valid workspace logo reference';
  end if;

  -- Finalizing the stripped draft must still snapshot a usable asset: the
  -- snapshot trigger falls back to the workspace's current logo.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select error_code into v_error
  from public.finalize_invoice(v_draft_bad, '00000000-0000-4000-8000-0000000000d1'::uuid, 1);
  if v_error is not null then
    raise exception 'finalizing a draft with a stripped logo reference failed: %', v_error;
  end if;
  if (select logo_asset_id_snapshot from public.invoices where id = v_draft_bad) is distinct from v_current then
    raise exception 'the stripped reference did not fall back to the current logo';
  end if;

  -- Finalizing a draft with a live reference must snapshot that exact asset.
  select error_code into v_error
  from public.finalize_invoice(v_draft_good, '00000000-0000-4000-8000-0000000000d2'::uuid, 1);
  if v_error is not null then
    raise exception 'finalizing a draft with a valid logo reference failed: %', v_error;
  end if;
  if (select logo_asset_id_snapshot from public.invoices where id = v_draft_good) is distinct from v_owned then
    raise exception 'finalization did not snapshot the referenced asset';
  end if;
end
$$;

rollback;

