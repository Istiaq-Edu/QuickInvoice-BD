-- Proves partial payment settlement against a real Postgres.
--
-- The reported case: an invoice for 10000 where the customer paid 8000. The
-- ledger in migration 0031 has to record that as a row, derive amount_paid and a
-- 'partial' status, and keep the balance consistent through edits and deletions.
-- Migration 0032 additionally refuses an edit that would drop the total below the
-- money already received. Every assertion drives the real RPCs and raises on an
-- unexpected result. Rolled back, so it is safe to run anywhere.
begin;

insert into public.allowlist_entries (email_original, email_normalized, status)
values ('settlement@example.test', 'settlement@example.test', 'approved');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000f0', 'settlement@example.test');

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-0000000000f0';
  v_workspace uuid;
  v_draft uuid;
  v_invoice uuid;
  v_canonical jsonb;
  v_snapshot jsonb;
  v_status text;
  v_paid bigint;
  v_balance bigint;
  v_version bigint;
  v_error text;
  v_payment uuid;
  v_lower jsonb;
begin
  select p.workspace_id into v_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'settlement@example.test';
  if v_workspace is null then
    raise exception 'fixture workspace was not created for the seeded user';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  v_canonical := jsonb_build_object(
    'schemaVersion', 1,
    'sellerCompanyName', 'Acme', 'sellerName', 'Sam',
    'sellerEmail', 'sam@acme.test', 'sellerPhone', '01700000000',
    'buyerCompanyName', '', 'buyerName', 'Rahim Uddin',
    'buyerEmail', 'rahim@example.test', 'buyerPhone', '01800000000',
    'issueDate', '2026-09-26', 'dueDate', '2026-10-03',
    'discountType', 'none', 'discountValue', 0, 'paymentStatus', 'unpaid',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 1, 'unitPrice', 10000,
      'discountType', 'none', 'discountValue', 0)));
  v_snapshot := jsonb_build_object('companyName', '', 'name', 'Rahim Uddin',
    'email', 'rahim@example.test', 'phone', '01800000000');

  -- A finalized invoice of 10000 with nothing received.
  select result_invoice_id, result_version into v_draft, v_version
  from public.save_invoice_draft(
    null, null, '2026-09-26'::date, '2026-10-03'::date, 'unpaid', 'none', 0,
    v_canonical, '{}'::jsonb, v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 1, 'unitPrice', 10000,
      'discountType', 'none', 'discountValue', 0)));
  select error_code into v_error
  from public.finalize_invoice(v_draft, '00000000-0000-4000-8000-0000000000f1'::uuid, v_version);
  if v_error is not null then
    raise exception 'could not finalize the fixture invoice: %', v_error;
  end if;
  v_invoice := v_draft;

  -- The headline case: pay 8000 of 10000.
  select result_amount_paid, result_balance, result_status into v_paid, v_balance, v_status
  from public.record_invoice_payment(
    v_invoice, 8000, 'cash', '', '2026-09-26'::date, 'first instalment');

  if v_paid is distinct from 8000 then
    raise exception 'amount_paid should be 8000, got %', v_paid;
  end if;
  if v_balance is distinct from 2000 then
    raise exception 'balance should be 2000, got %', v_balance;
  end if;
  if v_status is distinct from 'partial' then
    raise exception 'status should be partial, got %', v_status;
  end if;

  -- The cached column the list reads must agree with the ledger.
  if (select amount_paid from public.invoices where id = v_invoice) is distinct from 8000 then
    raise exception 'invoices.amount_paid did not track the payment';
  end if;

  -- A second instalment settles it and promotes the status.
  select result_amount_paid, result_balance, result_status into v_paid, v_balance, v_status
  from public.record_invoice_payment(
    v_invoice, 2000, 'bank', 'TXN-99', '2026-10-01'::date, '');

  if v_paid is distinct from 10000 or v_balance is distinct from 0 or v_status is distinct from 'paid' then
    raise exception 'the final instalment should settle the invoice, got %/%/%', v_paid, v_balance, v_status;
  end if;

  -- Overpayment is accepted and reported, never refused: the money arrived.
  select result_amount_paid, result_balance, result_status into v_paid, v_balance, v_status
  from public.record_invoice_payment(v_invoice, 500, 'cash', '', '2026-10-02'::date, '');

  if v_paid is distinct from 10500 or v_balance is distinct from -500 or v_status is distinct from 'paid' then
    raise exception 'overpayment should be accepted as a credit, got %/%/%', v_paid, v_balance, v_status;
  end if;

  -- Removing a payment must roll the totals and the status back.
  select id into v_payment
  from public.invoice_payments
  where invoice_id = v_invoice and amount = 500;

  select result_amount_paid, result_balance, result_status into v_paid, v_balance, v_status
  from public.delete_invoice_payment(v_payment);

  if v_paid is distinct from 10000 or v_balance is distinct from 0 or v_status is distinct from 'paid' then
    raise exception 'deleting the overpayment did not restore the balance, got %/%/%', v_paid, v_balance, v_status;
  end if;

  -- An invoice cannot be pushed back to unpaid while money is recorded: that
  -- would erase a payment that demonstrably arrived.
  select error_code into v_error
  from public.update_invoice_payment_status(v_invoice, 'unpaid');
  if v_error is distinct from 'PAYMENTS_RECORDED' then
    raise exception 'clearing a paid invoice to unpaid should be refused, got %', coalesce(v_error, 'no error');
  end if;

  -- Editing the total below the recorded payments is refused, so a settlement
  -- cannot be silently converted into an overpayment.
  v_lower := jsonb_set(v_canonical, '{lines}', jsonb_build_array(jsonb_build_object(
    'description', 'Consulting', 'quantity', 1, 'unitPrice', 5000,
    'discountType', 'none', 'discountValue', 0)));
  v_lower := jsonb_set(v_lower, '{dueDate}', '"2026-10-03"'::jsonb, true);

  select result_version, error_code into v_version, v_error
  from public.update_finalized_invoice(
    v_invoice, (select version from public.invoices where id = v_invoice),
    v_lower, '2026-09-26'::date, '2026-10-03'::date, 'paid');
  if v_error is distinct from 'PAYMENTS_EXCEED_NEW_TOTAL' then
    raise exception 'lowering the total below recorded payments should be refused, got %', coalesce(v_error, 'no error');
  end if;

  -- Raising the total is still allowed, so an understated invoice can be fixed.
  v_lower := jsonb_set(v_canonical, '{lines}', jsonb_build_array(jsonb_build_object(
    'description', 'Consulting', 'quantity', 1, 'unitPrice', 15000,
    'discountType', 'none', 'discountValue', 0)));
  v_lower := jsonb_set(v_lower, '{dueDate}', '"2026-10-03"'::jsonb, true);

  select result_version, error_code into v_version, v_error
  from public.update_finalized_invoice(
    v_invoice, (select version from public.invoices where id = v_invoice),
    v_lower, '2026-09-26'::date, '2026-10-03'::date, 'partial');
  if v_error is not null then
    raise exception 'raising the total should be allowed, got %', v_error;
  end if;
  if (select total_amount from public.invoices where id = v_invoice) is distinct from 15000 then
    raise exception 'the raised total was not stored';
  end if;
  if (select amount_paid from public.invoices where id = v_invoice) is distinct from 10000 then
    raise exception 'the recorded payments were lost when the total was raised';
  end if;
  -- 10000 received against a 15000 total is a part payment again, not a settled
  -- one, so the status follows the money rather than the old label.
  if (select payment_status from public.invoices where id = v_invoice) is distinct from 'partial' then
    raise exception 'a raised total with 10000 received should be partial, got %',
      (select payment_status from public.invoices where id = v_invoice);
  end if;

  -- A zero payment is refused; the RPC signals it with a null amount.
  select result_amount_paid into v_paid
  from public.record_invoice_payment(v_invoice, 0, 'cash', '', '2026-10-02'::date, '');
  if v_paid is not null then
    raise exception 'a zero payment should be refused';
  end if;

  -- A draft cannot take a payment, because there is nothing final to settle.
  -- The RPC echoes the invoice id back on rejection, so the null amount is the
  -- signal that nothing was recorded.
  select result_invoice_id, result_version into v_draft, v_version
  from public.save_invoice_draft(
    null, null, '2026-09-26'::date, '2026-10-03'::date, 'unpaid', 'none', 0,
    v_canonical, '{}'::jsonb, v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 1, 'unitPrice', 10000,
      'discountType', 'none', 'discountValue', 0)));
  select result_amount_paid into v_paid
  from public.record_invoice_payment(v_draft, 100, 'cash', '', '2026-09-26'::date, '');
  if v_paid is not null then
    raise exception 'a draft should not accept a payment';
  end if;
  if exists (select 1 from public.invoice_payments where invoice_id = v_draft) then
    raise exception 'a rejected payment must not leave a ledger row behind';
  end if;
end
$$;

rollback;
