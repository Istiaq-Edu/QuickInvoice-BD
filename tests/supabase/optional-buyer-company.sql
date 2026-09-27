-- Proves the buyer company name is genuinely optional.
--
-- Migration 0030 removed the buyerCompanyName term from the required-field guard
-- in save_invoice_draft, update_finalized_invoice and finalize_invoice. The guard
-- lives only in those three functions, so each one is driven directly with a blank
-- company: if any of them still rejected the invoice, this file raises.
--
-- The buyer name stays required, so the last assertion proves the guard was not
-- simply removed wholesale. Wrapped in a transaction that is rolled back, so this
-- is safe to run anywhere.
begin;

insert into public.allowlist_entries (email_original, email_normalized, status)
values ('individual-buyer@example.test', 'individual-buyer@example.test', 'approved');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000e0', 'individual-buyer@example.test');

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-0000000000e0';
  v_workspace uuid;
  v_draft uuid;
  v_finished uuid;
  v_next_version bigint;
  v_canonical jsonb;
  v_snapshot jsonb;
  v_error text;
  v_version bigint;
begin
  select p.workspace_id into v_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'individual-buyer@example.test';
  if v_workspace is null then
    raise exception 'fixture workspace was not created for the seeded user';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- The seller is complete, the buyer has a name but no company at all.
  v_canonical := jsonb_build_object(
    'schemaVersion', 1,
    'sellerCompanyName', 'Acme',
    'sellerName', 'Sam',
    'sellerEmail', 'sam@acme.test',
    'sellerPhone', '01700000000',
    'sellerAddress', 'Dhaka',
    'buyerCompanyName', '',
    'buyerName', 'Rahim Uddin',
    'buyerEmail', 'rahim@example.test',
    'buyerPhone', '01800000000',
    'buyerAddress', 'Chattogram',
    'issueDate', '2026-09-26',
    'dueDate', '2026-10-03',
    'discountType', 'none',
    'discountValue', 0,
    'paymentStatus', 'unpaid',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 2, 'unitPrice', 1250,
      'discountType', 'none', 'discountValue', 0))
  );
  v_snapshot := jsonb_build_object(
    'companyName', '', 'name', 'Rahim Uddin',
    'email', 'rahim@example.test', 'phone', '01800000000', 'address', 'Chattogram');

  -- save_invoice_draft must accept a company-less buyer.
  select result_invoice_id, result_version, error_code
  into v_draft, v_version, v_error
  from public.save_invoice_draft(
    null, null, '2026-09-26'::date, '2026-10-03'::date, 'unpaid', 'none', 0,
    v_canonical, '{}'::jsonb, v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 2, 'unitPrice', 1250,
      'discountType', 'none', 'discountValue', 0)));
  if v_error is not null then
    raise exception 'saving a draft without a buyer company was rejected: %', v_error;
  end if;

  -- finalize_invoice must accept it too, and must store the company as an empty
  -- string rather than JSON null so the list and preview read it consistently.
  select result_version, error_code into v_next_version, v_error
  from public.finalize_invoice(v_draft, '00000000-0000-4000-8000-0000000000e1'::uuid, v_version);
  if v_error is not null then
    raise exception 'finalizing an invoice without a buyer company was rejected: %', v_error;
  end if;

  select customer_snapshot into v_snapshot from public.invoices where id = v_draft;
  if v_snapshot->>'companyName' is distinct from '' then
    raise exception 'the stored customer snapshot is not a string: %', v_snapshot->>'companyName';
  end if;
  if v_snapshot->>'name' is distinct from 'Rahim Uddin' then
    raise exception 'finalization lost the buyer name';
  end if;

  -- update_finalized_invoice is the last guard to relax: revising this same
  -- company-less invoice must still succeed.
  select result_version, error_code into v_next_version, v_error
  from public.update_finalized_invoice(
    v_draft, v_next_version, v_canonical, '2026-09-26'::date, '2026-10-03'::date, 'unpaid'::public.payment_status);
  if v_error is not null then
    raise exception 'revising a finalized invoice without a buyer company was rejected: %', v_error;
  end if;

  -- The guard must not have been dropped wholesale. save_invoice_draft is
  -- deliberately lenient (autosave stores work in progress), so the required-field
  -- guard is asserted where it actually lives: finalization. Each case below is a
  -- fresh draft, finalized with exactly one required field blanked.
  v_canonical := jsonb_set(v_canonical, '{buyerName}', '""'::jsonb, true);
  select result_invoice_id, result_version into v_finished, v_version
  from public.save_invoice_draft(
    null, null, '2026-09-26'::date, '2026-10-03'::date, 'unpaid', 'none', 0,
    v_canonical, '{}'::jsonb, v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 2, 'unitPrice', 1250,
      'discountType', 'none', 'discountValue', 0)));
  select error_code into v_error
  from public.finalize_invoice(v_finished, '00000000-0000-4000-8000-0000000000e2'::uuid, v_version);
  if v_error is distinct from 'REQUIRED_FIELDS_MISSING' then
    raise exception 'a missing buyer name should be rejected, got: %', coalesce(v_error, 'no error');
  end if;

  v_canonical := jsonb_set(v_canonical, '{sellerCompanyName}', '""'::jsonb, true);
  v_canonical := jsonb_set(v_canonical, '{buyerName}', '"Rahim Uddin"'::jsonb, true);
  select result_invoice_id, result_version into v_finished, v_version
  from public.save_invoice_draft(
    null, null, '2026-09-26'::date, '2026-10-03'::date, 'unpaid', 'none', 0,
    v_canonical, '{}'::jsonb, v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 2, 'unitPrice', 1250,
      'discountType', 'none', 'discountValue', 0)));
  select error_code into v_error
  from public.finalize_invoice(v_finished, '00000000-0000-4000-8000-0000000000e3'::uuid, v_version);
  if v_error is distinct from 'REQUIRED_FIELDS_MISSING' then
    raise exception 'a missing seller company should be rejected, got: %', coalesce(v_error, 'no error');
  end if;
end
$$;

rollback;
