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

## Account purge operations

Purge requires both `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` as server-only variables. A scheduler should POST to `/api/internal/purge` with `Authorization: Bearer <CRON_SECRET>`. Never call the purge endpoint from browser code.

The worker claims bounded jobs with row locks, removes private seller-logo objects, deletes workspace data, deletes the Auth user, and marks the allowlist entry purged. Failed jobs retain a non-PII error code and can be retried by the next worker run.

## Required dashboard action

The application cannot enable Supabase Auth leaked-password protection through a database migration. In Supabase Dashboard, open Authentication → Providers → Email → Password security and enable **Prevent use of leaked passwords**, then verify the Security Advisor warning clears. This may require the Pro plan or above according to Supabase documentation.
