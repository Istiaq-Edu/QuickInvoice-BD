create index if not exists invoice_finalization_requests_invoice_idx
  on private.invoice_finalization_requests (invoice_id);

create index if not exists account_purge_jobs_requested_by_idx
  on public.account_purge_jobs (requested_by_user_id);

create index if not exists allowlist_entries_added_by_idx
  on public.allowlist_entries (added_by_user_id);

create index if not exists allowlist_entries_removed_by_idx
  on public.allowlist_entries (removed_by_user_id);

create index if not exists invoices_logo_asset_snapshot_idx
  on public.invoices (logo_asset_id_snapshot);

create index if not exists logo_assets_workspace_idx
  on public.logo_assets (workspace_id);

create index if not exists workspaces_current_logo_idx
  on public.workspaces (current_logo_asset_id);
