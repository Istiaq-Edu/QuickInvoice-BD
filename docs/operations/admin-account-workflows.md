# Admin account workflows

## Database setup

Apply migrations `0018_admin_account_workflows.sql` through `0022_consolidate_purge_job_read_policy.sql` after migrations `0001` through `0017` in the Supabase SQL editor or through the normal migration pipeline. Together, these migrations:

- restricts allowlist writes to admin RPCs;
- makes the first-admin trigger decision advisory-lock protected;
- keeps profile and allowlist identity fields immutable;
- disables an existing account and queues its workspace for purge in one transaction; and
- preserves purge job status after workspace deletion;
- restricts direct invoice and invoice-line writes to validated RPCs;
- removes API execute grants from trigger-only functions;
- indexes purge-job allowlist references; and
- scopes/consolidates purge-job read policies for authenticated users.

The first Auth user created for an approved allowlist entry becomes the first admin. Do not manually edit `profiles.is_admin` from the browser or expose a database/service credential to a client.

## Server environment

Set these as server-side environment variables in the hosting dashboard. Never prefix either secret with `NEXT_PUBLIC_`:

- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key used only by the purge route.
- `CRON_SECRET`: a long random value used to authenticate the worker.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are still required for the normal application client. If the service-role key is absent, the worker intentionally returns HTTP 503 with a configuration message; it does not fall back to the publishable key.

## Cron setup

The purge worker is scheduled in this repository by `vercel.json`:

```json
{ "crons": [{ "path": "/api/internal/purge", "schedule": "0 3 * * *" }] }
```

This runs daily at 03:00 UTC. Vercel Cron issues a **GET** request and supplies the `Authorization: Bearer $CRON_SECRET` header automatically, so the route accepts both `GET` and `POST`. Confirm the schedule at **Project → Settings → Crons**; Vercel reads `vercel.json` at build time, so schedule changes require a redeploy.

The daily cadence is a consequence of the Vercel Hobby plan, which permits at most one cron invocation per day. The worker claims a bounded batch, uses row locks so overlapping runs do not process the same job, retries failed jobs, and reclaims jobs left running for more than 15 minutes — so a daily schedule is sufficient for the beta workload.

The route also accepts a manual `POST` with the same header, which is useful for draining a queue without waiting for the next run. Never call this route from the admin browser page and never put `CRON_SECRET` in client JavaScript.

## Operating the allowlist

Open `/admin/allowlist` while signed in as an active administrator. Adding an email approves future signup. Removing an entry is irreversible for the existing account: the account profile and workspace are disabled immediately, private logo objects are removed by the worker, workspace data is deleted, and the Auth user is deleted. The last administrator cannot be removed.

The page displays pending, running, failed, and complete purge states. A failed job stores only a non-PII error code and will be retried by the worker. Use **Refresh status** after the configured cron has run.
