do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_finalized_buyer_phone_check') then
    alter table public.invoices
      add constraint invoices_finalized_buyer_phone_check
      check (
        lifecycle_status <> 'finalized'
        or nullif(trim(coalesce(canonical_document->>'buyerPhone', '')), '') is not null
      ) not valid;
  end if;
end
$$;
