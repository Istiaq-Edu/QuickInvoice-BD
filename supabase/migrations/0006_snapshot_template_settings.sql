create or replace function public.snapshot_invoice_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle_status = 'finalized' then
    new.template_snapshot := coalesce(new.canonical_document->'templateSettings', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_invoice_template_before_update on public.invoices;
create trigger snapshot_invoice_template_before_update
before update of lifecycle_status, canonical_document on public.invoices
for each row
execute function public.snapshot_invoice_template();

revoke all on function public.snapshot_invoice_template() from public, anon, authenticated;
