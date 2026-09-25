# Production operations runbook

This runbook covers the QuickInvoice-BD beta deployment on Vercel with Supabase.

## Pre-release checklist

1. Run `npm run lint`, `npm run test`, and `npm run build`.
2. Run `npm run test:e2e` after installing Chromium with `npx playwright install chromium`.
3. Apply pending Supabase migrations before deploying code that calls new RPCs.
4. Confirm the Vercel environment contains:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_APP_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only, required for purge)
   - `CRON_SECRET` (server-only, required for purge)
5. Confirm Supabase Auth email confirmation is enabled and leaked-password protection is enabled under Authentication → Providers → Email → Password security. Leaked-password protection is available on Supabase Pro and above.
6. Deploy a Vercel preview and verify `/api/health` before production promotion.

## Health and observability

The no-store health endpoint is:

```text
GET /api/health
```

A healthy response has HTTP 200 and `{"status":"ok"}`. The response includes `x-request-id` and the deployed commit SHA when Vercel provides `VERCEL_GIT_COMMIT_SHA`.

Monitor:

- Vercel deployment status and Function logs for 5xx responses, auth callback failures, purge failures, and export errors.
- Supabase Logs Explorer for `postgres_logs`, `function_edge_logs`, and API errors around the same UTC window.
- Supabase Security Advisor and Performance Advisor after every schema migration.
- `/admin/allowlist` for pending or failed purge jobs.

Do not log access tokens, confirmation links, service-role keys, invoice contents, or customer personal data. Error responses should expose a safe message and a request ID, not database details.

## Release procedure

1. Merge or push the reviewed commit only after preview QA passes.
2. Apply database migrations in order and verify the expected RPCs, policies, and indexes.
3. Deploy production from the known-good commit.
4. Check `/api/health`, sign-in, guest invoice export, authenticated draft save, finalization, history, and the admin page.
5. Record the deployment URL, commit SHA, migration name, and UTC verification time.

## Rollback procedure

### Application rollback

Use the Vercel deployment dashboard to promote the previous known-good deployment. This is preferred for application-only regressions because it does not undo database changes.

After rollback, verify `/api/health`, login, draft save, and finalization. Keep the database migration in place unless it is independently proven unsafe; newer code can usually be redeployed after the application fix.

### Database rollback

Migrations are forward-only in production. Do not manually delete migration history or run destructive rollback SQL against live data. If a migration is faulty:

1. Pause the affected feature or route.
2. Capture the migration error and affected request IDs.
3. Write a compensating migration that preserves existing data.
4. Apply it after review and rerun the relevant RLS/security smoke tests.
5. Recheck the application with a preview deployment.

### Incident response

1. Disable the affected admin/purge route or Vercel cron if it is unsafe.
2. Preserve logs and the deployment/migration identifiers.
3. Check Supabase project health and recent schema changes.
4. Use the last known-good Vercel deployment for customer-facing recovery.
5. If account purge is involved, stop the worker and inspect `account_purge_jobs` before retrying. Jobs are designed to be retried using non-PII error codes.
6. Document the root cause and follow-up test before restoring normal operation.

## Verifying migrations

There is no disposable beta or staging Supabase project, so migrations are never verified by applying them somewhere and hoping. `npm test` applies the entire chain to a real Postgres running in-process (PGlite, i.e. Postgres compiled to WebAssembly) with only the two Supabase-provided schemas stubbed, and asserts:

- every migration applies, in order, from `0001` to the newest;
- the columns and indexes the logo lifecycle depends on exist;
- `anon` and `authenticated` cannot execute `mark_unused_logo_assets`, and `service_role` can;
- the retention rules select the right rows. The fixture builds one asset per exclusion rule, then calls the function with a realistic window and with a zero-day window, so age protection and reference protection are each proven on their own, followed by a third call that must retire nothing;
- the draft sanitiser keeps a valid workspace logo reference, drops a malformed one, drops another workspace's asset, and leaves every other document field alone.

It needs no credentials and no network, takes about two seconds, and runs as part of `npm test`. Run it on its own with `npm run test:db`.

Two optional suites check the same invariants against a real Supabase project and are skipped unless their own credentials are provided: `npm run test:supabase` (RLS through the API) and `npm run test:supabase:sql` (privileges and catalog through `psql`). Use them before a production migration, not instead of the local gate.

Applying a migration to production is still a one-way door, so take a backup first: `mark_unused_logo_assets` only ever sets `deleted_at`, and the worker only ever deletes objects it has already marked, but a schema-level mistake is still worth a restore point.

## Account purge operations

Purge requires both `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` as server-only variables. Both are set to Production only on Vercel, and both must exist before the worker can run.

**Scheduled runs.** `vercel.json` declares a daily cron at `0 3 * * *` (03:00 UTC) pointing at `/api/internal/purge`. Vercel Cron issues a **GET** request and sets `Authorization: Bearer $CRON_SECRET` automatically, so the route exports both `GET` and `POST` against the same handler. Because Vercel only reads the cron definition at build time, changing `vercel.json` requires a redeploy to take effect.

**Manual runs and retries.** To process jobs without waiting for the schedule, send a POST with the secret from your own machine:

```bash
curl -X POST https://quickinvoice-bd.vercel.app/api/internal/purge \
  -H "Authorization: Bearer $CRON_SECRET"
```

Read the secret back out of the Vercel dashboard only when needed, and never commit it or paste it into an issue. Never call the purge endpoint from browser code.

If the response is `503`, the worker is not configured (missing secret or service role key). If it is `401`, the presented secret did not match.

The worker claims bounded jobs with row locks, removes private seller-logo objects, deletes workspace data, deletes the Auth user, and marks the allowlist entry purged. Failed jobs retain a non-PII error code and can be retried by the next worker run.

## Superseded logo retention

Logo uploads are append-only on purpose: a finalized invoice snapshots the asset it was issued with, so replacing a logo can never invalidate history. The cost is that every replacement leaves the old file in the `seller-logos` bucket, so retention is bounded by a second worker at `/api/internal/logo-gc`. It uses the same `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`, answers `GET` and `POST`, and is scheduled daily at `30 3 * * *`.

It runs in two phases so neither can destroy something still in use:

1. **Retire.** The database marks live assets that are older than the retention window, skipping the workspace's current logo, any logo a saved seller profile points at, and any logo an invoice references through either its finalization snapshot or its draft document. A marked asset is invisible to the app immediately, because every read filters `deleted_at is null`.
2. **Sweep.** After the grace window the worker deletes the object from the bucket and stamps `storage_purged_at`. The object is removed *before* the stamp, so a failed removal is retried on the next run instead of leaking the file. Rows are never hard deleted here; account purge still owns that.

The response reports `retired` and `swept` counts, and a `failed` list of non-PII error codes. A non-empty `failed` means at least one object could not be removed and will be retried on the next run. `503` and `401` mean the same thing as for the purge worker.

Tune the policy with server-only environment variables. All three are optional, and an unusable value falls back to the default:

| Variable | Default | Range | Effect |
| --- | --- | --- | --- |
| `LOGO_RETENTION_DAYS` | 30 | 1–3650 | How long a superseded logo stays selectable before it is retired. |
| `LOGO_SWEEP_GRACE_DAYS` | 7 | 0–365 | Extra margin between retiring an asset and deleting its file. |
| `LOGO_SWEEP_LIMIT` | 500 | 1–5000 | Assets retired and swept per run, so a first run cannot time out. |

Run it on demand with the same credential as the purge worker:

```bash
curl -X POST https://quickinvoice-bd.vercel.app/api/internal/logo-gc \
  -H "Authorization: Bearer $CRON_SECRET"
```

Uploading an image byte-for-byte identical to a logo the workspace already holds reuses the existing asset instead of writing a second object and row, so repeated re-uploads of the same file cost nothing.

## Required dashboard action

The application cannot enable Supabase Auth leaked-password protection through a database migration. In Supabase Dashboard, open Authentication → Providers → Email → Password security and enable **Prevent use of leaked passwords**, then verify the Security Advisor warning clears. This may require the Pro plan or above according to Supabase documentation.
