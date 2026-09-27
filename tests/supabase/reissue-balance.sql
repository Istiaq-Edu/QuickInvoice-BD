-- Proves re-raising an outstanding balance, and the paid-stamp date.
--
-- The raised amount must be whatever is still owed at the moment of the raise,
-- not whatever the browser last saw, and the original invoice must be left
-- untouched so the customer keeps the document they already paid against.
begin;

insert into public.allowlist_entries (email_original, email_normalized, status)
values ('reissue@example.test', 'reissue@example.test', 'approved');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000a1', 'reissue@example.test');

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-0000000000a1';
  v_workspace uuid;
  v_draft uuid;
  v_invoice uuid;
  v_new uuid;
  v_version bigint;
  v_error text;
  v_amount bigint;
  v_balance bigint;
  v_paid bigint;
  v_doc jsonb;
  v_snapshot jsonb;
begin
  select p.workspace_id into v_workspace
  from public.profiles p join auth.users u on u.id = p.user_id
  where u.email = 'reissue@example.test';
  if v_workspace is null then
    raise exception 'fixture workspace was not created for the seeded user';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- The customer snapshot is deliberately different from the seller one: passing
  -- the seller for both made the customer carry the seller's identity and the
  -- draft save rejected it. Keeping them separate also mirrors real data.
  v_snapshot := jsonb_build_object('companyName', '', 'name', 'Rahim Uddin',
    'email', 'rahim@example.test', 'phone', '01800000000', 'address', 'Chattogram');
  v_doc := jsonb_build_object(
    'schemaVersion', 1,
    'sellerCompanyName', 'Acme', 'sellerName', 'Sam',
    'sellerEmail', 'sam@acme.test', 'sellerPhone', '01700000000', 'sellerAddress', 'Dhaka',
    'buyerCompanyName', '', 'buyerName', 'Rahim Uddin',
    'buyerEmail', 'rahim@example.test', 'buyerPhone', '01800000000', 'buyerAddress', 'Chattogram',
    'issueDate', '2026-09-26', 'dueDate', '2026-10-03',
    'discountType', 'none', 'discountValue', 0, 'paymentStatus', 'unpaid',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 1, 'unitPrice', 10000,
      'discountType', 'none', 'discountValue', 0)));


  select result_invoice_id, result_version, error_code into v_draft, v_version, v_error
  from public.save_invoice_draft(
    null, null, '2026-09-26'::date, '2026-10-03'::date, 'unpaid', 'none', 0,
    v_doc, v_snapshot, v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 1, 'unitPrice', 10000,
      'discountType', 'none', 'discountValue', 0)));
  -- Checked explicitly: without this the draft id stays null and the failure
  -- surfaces later as a misleading INVALID_REQUEST from finalization.
  if v_error is not null then raise exception 'could not save the fixture draft: %', v_error; end if;
  select error_code into v_error
  from public.finalize_invoice(v_draft, '00000000-0000-4000-8000-0000000000f1'::uuid, v_version);
  if v_error is not null then raise exception 'could not finalize the fixture: %', v_error; end if;
  v_invoice := v_draft;

  -- A brand new invoice that has been finalized but never paid still owes its
  -- full amount, so raising that balance is legitimate. What must never happen is
  -- a raise that ignores the payments already recorded, which is asserted below
  -- once 8000 has been received.

  -- Record 8000, then raise the remaining 2000.
  select result_amount_paid into v_paid
  from public.record_invoice_payment(v_invoice, 8000, 'cash', '', '2026-09-26'::date, '');
  if v_paid is distinct from 8000 then raise exception 'setup payment failed: %', v_paid; end if;

  select result_new_invoice_id, result_amount, error_code into v_new, v_amount, v_error
  from public.reissue_invoice_balance(v_invoice);
  if v_error is not null then raise exception 're-raise failed: %', v_error; end if;
  if v_amount is distinct from 2000 then
    raise exception 'the raised amount should be the 2000 outstanding, got %', v_amount;
  end if;

  -- The raised document must be internally consistent, or the printed invoice lies.
  select total_amount, subtotal_amount into v_amount, v_balance from public.invoices where id = v_new;
  if v_amount is distinct from 2000 or v_balance is distinct from 2000 then
    raise exception 'the raised invoice totals disagree: total % / subtotal %', v_amount, v_balance;
  end if;

  select canonical_document into v_doc from public.invoices where id = v_new;
  if v_doc->'carriedForward'->>'amount' is distinct from '2000' then
    raise exception 'the carried-forward snapshot is missing or wrong';
  end if;
  if v_doc->'carriedForward'->>'originalTotal' is distinct from '10000' then
    raise exception 'the carried-forward original total is wrong';
  end if;
  if v_doc->'carriedForward'->>'received' is distinct from '8000' then
    raise exception 'the carried-forward received amount is wrong';
  end if;
  if v_doc->'lines'->0->>'unitPrice' is distinct from '2000' then
    raise exception 'the balance line does not equal the balance';
  end if;

  -- It must start as a draft: raising is not the same as issuing.
  if (select lifecycle_status from public.invoices where id = v_new) <> 'draft' then
    raise exception 'the raised invoice should start as a draft';
  end if;
  if (select invoice_number from public.invoices where id = v_new) is not null then
    raise exception 'a draft must not carry an invoice number';
  end if;

  -- The link back to the original is what proves these are one engagement.
  if (select parent_invoice_id from public.invoices where id = v_new) is distinct from v_invoice then
    raise exception 'the raised invoice is not linked to its parent';
  end if;
  if (select count(*) from public.invoice_lines where invoice_id = v_new) <> 1 then
    raise exception 'the raised invoice should have exactly one balance line';
  end if;

  -- The original must be untouched: same total, same money received.
  if (select total_amount from public.invoices where id = v_invoice) is distinct from 10000 then
    raise exception 'the raise altered the original invoice total';
  end if;
  if (select amount_paid from public.invoices where id = v_invoice) is distinct from 8000 then
    raise exception 'the raise altered the original amount received';
  end if;

  -- Settling the original stamps the paid date and flips the status.
  select result_status into v_error
  from public.record_invoice_payment(v_invoice, 2000, 'bank', '', '2026-10-01'::date, '');
  if v_error is distinct from 'paid' then raise exception 'the invoice should be paid, got %', v_error; end if;
  if (select settled_on from public.invoices where id = v_invoice) is null then
    raise exception 'settled_on was not stamped when the invoice cleared';
  end if;

  -- Removing that payment must clear the stamp again, or a PAID date survives on
  -- an invoice that is no longer paid.
  select id into v_new
  from public.invoice_payments where invoice_id = v_invoice and amount = 2000;
  perform public.delete_invoice_payment(v_new);

  if (select settled_on from public.invoices where id = v_invoice) is not null then
    raise exception 'settled_on stayed set after the invoice stopped being paid';
  end if;
  if (select payment_status from public.invoices where id = v_invoice) is distinct from 'partial' then
    raise exception 'removing the final payment should return the invoice to partial';
  end if;

  -- Now the balance is 2000 again, so a further raise is possible. Settle it for
  -- real and confirm the guard finally refuses, proving there is no path to
  -- raise the same money twice.
  perform public.record_invoice_payment(v_invoice, 2000, 'bank', '', '2026-10-02'::date, '');
  select result_new_invoice_id, error_code into v_new, v_error
  from public.reissue_invoice_balance(v_invoice);
  if v_error is distinct from 'NOTHING_OUTSTANDING' then
    raise exception 'a settled invoice must refuse a further raise, got %', coalesce(v_error, 'no error');
  end if;
  if v_new is not null then
    raise exception 'a refused raise must not create an invoice';
  end if;

  -- And the count of raised invoices must not have grown from the refusal.
  if (select count(*) from public.invoices where parent_invoice_id = v_invoice) <> 1 then
    raise exception 'the refused raise created an extra invoice';
  end if;

  -- Raising the total of a settled invoice must drop the PAID date, otherwise the
  -- document is stamped paid while money is outstanding. The ledger still holds
  -- 10000, so a 20000 total makes this part paid rather than unpaid.
  select result_version, error_code into v_version, v_error
  from public.update_finalized_invoice(
    v_invoice, (select version from public.invoices where id = v_invoice),
    jsonb_set(v_doc, '{lines}', jsonb_build_array(jsonb_build_object(
      'description', 'Consulting', 'quantity', 1, 'unitPrice', 20000,
      'discountType', 'none', 'discountValue', 0))),
    '2026-09-26'::date, '2026-10-03'::date, 'unpaid');
  if v_error is not null then raise exception 'raising the total should be allowed: %', v_error; end if;

  if (select settled_on from public.invoices where id = v_invoice) is not null then
    raise exception 'settled_on survived raising the total above the amount received';
  end if;
  if (select payment_status from public.invoices where id = v_invoice) is distinct from 'partial' then
    raise exception 'raising the total above the amount received should return it to partial, got % (ledger %, amount_paid %)',
      (select payment_status from public.invoices where id = v_invoice),
      (select coalesce(sum(amount), 0) from public.invoice_payments where invoice_id = v_invoice),
      (select amount_paid from public.invoices where id = v_invoice);
  end if;

  -- 'partial' is derived, so the database must refuse it as a manual choice. The
  -- API route rejects it too, but the same token reaches PostgREST directly, so
  -- the RPC itself is the only real boundary.
  select error_code into v_error
  from public.update_invoice_payment_status(v_invoice, 'partial');
  if v_error is distinct from 'PARTIAL_IS_DERIVED' then
    raise exception 'manual partial should be refused, got %', coalesce(v_error, 'no error');
  end if;

  -- Marking paid must write a real ledger row, not just set the cached column.
  -- Otherwise the next payment recomputes amount_paid from the ledger and the
  -- recorded money silently disappears.
  select error_code into v_error
  from public.update_invoice_payment_status(v_invoice, 'paid');
  if v_error is not null then raise exception 'marking paid should be allowed: %', v_error; end if;

  if (select amount_paid from public.invoices where id = v_invoice)
     is distinct from (select coalesce(sum(amount), 0) from public.invoice_payments where invoice_id = v_invoice) then
    raise exception 'amount_paid no longer matches the ledger after marking paid';
  end if;
end
$$;

rollback;
