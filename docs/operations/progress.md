# Invoice project progress log

> Durable handoff for work that was in progress when the previous session ran out of context. Update this file after every meaningful investigation, code change, or validation run. Do not rely on chat history as the task list.

## Snapshot

- **Checkpoint date:** 2026-09-22
- **Branch:** `main`
- **Base commit:** `acd4d89` (`Harden beta invoice workflow`)
- **Working tree:** contains the uncommitted changes listed below, plus the targeted fixes made during this continuation; no commit was created.
- **Supabase test target:** `invoice-studio` (`sqbpvpwroyrabfixfgkg`) is active and has migrations `0001`–`0026` applied. Treat it as the disposable beta/test project; do not assume it is production.
- **Important limitation:** the previous chat context is not available in this session. The task list below is reconstructed from the working tree, recent commits, the implementation plan, and the existing operational documentation.

## Latest invoice-page profile workflow

- [x] Seller profile loading now re-checks the current browser session before requesting `/api/seller-profile`, avoiding the auth-state race that made the button appear broken.
- [x] Customer loading now re-fetches `/api/customers` instead of relying on a stale first-load cache.
- [x] Invoice page now provides **Save as profile** for seller details and **Save customer/Update saved customer** for buyer details.
- [x] Customer POST is idempotent for an existing company/contact pair, so autosave-created customers do not fail when explicitly saved.
- [x] Omitted optional website fields are preserved when saving from the invoice page; dedicated settings pages can still explicitly update or clear them.
- [x] E2E coverage verifies the new seller/customer load-save controls are visible, and the full 12-test browser suite passes.
- [x] Added the Next.js 16 root `proxy.ts` so Supabase SSR can refresh auth cookies before profile/customer requests.
- [x] Fixed the signed-in autosave loop that was posting incomplete invoices and returning `400 Invoice data is invalid.`; autosave now waits until required fields and line items are complete. Profile/customer GETs also use `no-store` to avoid stale loads.
- [x] Added visible seller/customer action status feedback near the top of the invoice page so authentication, loading, success, and API errors are no longer silent.
- [x] Replaced the non-functional inline load behavior with right-side seller/customer drawers; each opens immediately, shows loading/empty/error/available states, and provides an explicit Use this profile/customer action.
- [x] Fixed the root click bug: seller/customer buttons were using `onClick={() => void loadSellerProfile}`-style handlers, which returned function references without invoking them; all handlers now call the functions.
- [x] Invoice-page auth state now changes from Guest mode to Signed in when the Supabase session resolves, including accounts without an email label; guests no longer see saved-profile or logo-upload controls.
- [x] Added private invoice-page company-logo upload/remove UI with preview, file validation messaging, real upload progress, and finalized-invoice protection using `/api/seller-logo`.
- [x] Fixed React hydration error `#418` by making invoice date fields render deterministic empty values during SSR/hydration, then initializing Dhaka dates after mount.
- [x] Made logo upload feedback persistent for fast files: selected filename state, visible 8–95% upload phase, finalizing phase, minimum visible duration, and durable success/error messages.
- [x] Seller profiles now retain the selected logo asset; loading a seller profile restores its logo while automatic current-logo loading remains enabled for new invoices.
- [x] Save as profile now requires a company name and seller name in both the invoice UI and the server API; blank seller profiles are rejected.
- [x] Invoice documents carry the selected logo asset ID, and finalization snapshots that valid workspace-owned asset so the finalized invoice matches the preview.
- [x] Serialized authenticated invoice autosaves so overlapping requests cannot reuse one draft version; queued latest changes now save after the active request, and finalization waits for pending autosave work.
- [x] Replaced the browser-native finalization confirmation with an accessible in-app confirmation dialog that supports Cancel, backdrop click, Escape, focus management, and finalization progress feedback.
- [x] Hardened PDF/DOCX export layout: logo dimensions preserve intrinsic aspect ratio, near-empty trailing overflow no longer creates a blank page, DOCX uses an A4 page with zero outer margins, and the preview shows an estimated export page count.
- [x] Replaced invoice-level discount editing with per-item fixed BDT or percentage discounts while retaining legacy invoice-level fallback for old documents; the editor keeps original amounts for calculation while preview/PDF/DOCX show description, price, discount, and net amount plus the total discount summary.
- [x] Removed the discount-reason/note idea completely. Reusable invoice notes remain available as the separate notes section.
- [x] Made the multi-column invoice preview responsive at narrow widths so mobile descriptions do not collapse into one-character lines and mobile PDF/DOCX exports remain reliable.

## Reconstructed unfinished work

### P0 — Verify and finish the uncommitted beta-hardening slice

These changes are present but not yet committed and should be treated as one reviewable workstream:

- [ ] **Admin allowlist UI and API**
  - `app/admin/allowlist/page.tsx`
  - `app/admin/allowlist/allowlist-manager.tsx`
  - `app/api/admin/allowlist/route.ts`
  - Confirm active-admin authorization, safe error responses, add/remove behavior, and purge-status refresh behavior.
- [ ] **Account purge worker**
  - `app/api/internal/purge/route.ts`
  - `lib/supabase/admin.ts`
  - Confirm cron authentication, service-role-only server boundary, bounded claims, retries/reclaimed jobs, storage cleanup, workspace deletion, Auth-user deletion, and non-PII errors.
  - Fixed a purge ordering hazard by deleting workspace invoices before the workspace cascade can delete historical logo assets.
- [x] **Health endpoint**
  - `app/api/health/route.ts`
  - Confirmed build/runtime compatibility; deployment smoke verification remains in the deployment checklist below.
- [x] Database migrations
  - `supabase/migrations/0018_admin_account_workflows.sql`
  - `supabase/migrations/0019_restrict_direct_invoice_writes.sql`
  - `supabase/migrations/0020_harden_trigger_permissions_and_purge_index.sql`
  - `supabase/migrations/0021_scope_purge_job_read_policies.sql`
  - `supabase/migrations/0022_consolidate_purge_job_read_policy.sql`
  - `supabase/migrations/0023_link_seller_profile_logo.sql`
  - `supabase/migrations/0024_saved_invoice_libraries.sql`
  - `supabase/migrations/0025_line_item_discounts.sql`
  - `supabase/migrations/0026_fix_line_discount_rpc.sql`
  - Migrations `0001`–`0026` are applied to the active `invoice-studio` test target. Live authenticated RPC/purge behavior still needs test credentials and disposable execution.
- [x] **Export reliability**
  - `lib/invoice/export.ts`
  - `app/page.tsx`
  - Confirm CSS `lab()`/`oklch()` normalization works in browser capture, shadows do not create export failures, and PDF/DOCX downloads still work for guest and authenticated flows.
  - Strengthened the clone sanitization to rewrite stylesheet text, inline styles, document roots, and `lab()`/`oklab()`/`oklch()` values before `html2canvas` parses CSS.
  - Verified guest PDF and DOCX downloads in all configured Playwright viewports.
- [x] **Automated validation infrastructure**
  - `vitest.config.mts`
  - `tests/unit/validation.test.ts`
  - `tests/supabase/rls.test.ts`
  - `tests/supabase/rls-smoke.sql`
  - `tests/supabase/run-sql-smoke.mjs`
  - `tests/e2e/guest.spec.ts`
  - `playwright.config.ts`
  - `package.json`, `package-lock.json`, `.gitignore`, `README.md`
  - Local suites pass and opt-in Supabase tests skip safely without credentials; live Supabase assertions remain unchecked until a dedicated test project is configured.

### P1 — Local validation gates

- [x] Run `npm run test:unit` — 9 tests passed.
- [x] Run `npm run test` — 6 tests passed; 2 Supabase tests skipped without configuration.
- [x] Run `npm run lint` — passed.
- [x] Run `npx tsc --noEmit` — passed.
- [x] Run `npm run build` — passed; all application and API routes compiled.
- [x] Install Chromium if needed with `npx playwright install chromium`, then run `npm run test:e2e` — 24 tests passed across mobile-320, mobile-375, and desktop, including per-item discounts and PDF/DOCX exports.
- [x] Review failures and fix issues caused by this workstream — export sanitization and related hardening findings were fixed.
- [x] Run `git diff --check` and inspect the final diff — passed; only intended uncommitted work remains.

### P1 — Supabase test-project validation

Only run against a dedicated non-production test project with a test account and the publishable key:

- [x] Apply migrations `0018`, `0019`, and `0020` after the existing migration chain on `invoice-studio`.
- [x] Set `SUPABASE_TEST_URL` and `SUPABASE_TEST_PUBLISHABLE_KEY` for the anonymous live check; `.env.local` does not contain `SUPABASE_TEST_EMAIL` or `SUPABASE_TEST_PASSWORD`.
- [ ] Run `npm run test:supabase` and record the authenticated result here; the anonymous portion now accepts the intentional helper permission denial.
- [ ] If SQL smoke is needed, explicitly set `SUPABASE_SQL_SMOKE=1` and `SUPABASE_DB_URL`, then run `npm run test:supabase:sql` with `psql` available.
- [x] Run Supabase Security Advisor and Performance Advisor after applying migrations; trigger-only API warnings are resolved and the overlapping purge-job policy warning is resolved. Remaining findings are documented below.

### P1 — Deployment/configuration actions that code cannot complete

- [ ] Configure Vercel server-only `SUPABASE_SERVICE_ROLE_KEY` — blocked because the service-role secret is not available in this workspace.
- [ ] Configure a long random server-only `CRON_SECRET` — not configured yet.
- [ ] Configure the scheduler to `POST /api/internal/purge` every 5–15 minutes with the cron secret — blocked until `CRON_SECRET` is configured.
- [x] Confirm the Vercel Preview environment contains `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_APP_URL`.
- [ ] Enable Supabase Auth leaked-password protection in the Dashboard; this cannot be enabled through the migration. Advisor remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- [x] Deploy a Vercel preview and check `/api/health` before production promotion; current preview is `https://invoice-8cci1ftug-istiaq-s-org.vercel.app` and health returned `status: ok`.
- [ ] Complete preview smoke checks: guest export and health are locally verified; sign-in, authenticated draft save, finalization, history, and admin allowlist/purge status require the missing server/test credentials.
- [x] Record deployment URL, deployment ID, commit SHA, migration names, and UTC verification time for the latest preview; the latest deployment is `dpl_4JLZUGqKTAYh8DU2axiEBxBhS9qQ`, the health version is `acd4d89817672b53b8936ceab8132117ab9f8439`, and migrations `0018`–`0023` are applied to `invoice-studio`.

## Plan-level acceptance gaps still to close

These items are carried forward from `docs/plans/2026-09-21-invoice-generator-plan.md`. They are intentionally not marked complete based only on static code inspection or local guest tests.

### Release acceptance

- [x] Guest PDF and exact-layout DOCX download path — covered by the 6-test Playwright suite.
- [x] Verify guest state is not persisted after refresh/close — added to the Playwright suite; database-row absence still needs a live database assertion.
- [ ] Verify invite-only signup for approved and denied emails in a disposable Supabase project.
- [ ] Verify email/password and Google identities resolve to one account; configure and test Google provider if it is part of this beta.
- [ ] Run live cross-account RLS checks, including authenticated direct-write denial and helper/RPC permissions; the anonymous live check passes, authenticated execution awaits test credentials.
- [x] Local seller/buyer/line-item and discount validation tests pass; still verify server/RPC behavior against the migrated database.
- [x] Local BDT calculations and percentage rounding tests pass; add/execute database calculation and boundary cases where applicable.
- [ ] Verify draft autosave, stale-version conflicts, retry states, and disabled-session behavior with two authenticated sessions.
- [ ] Verify finalization idempotency, unique numbering, and consumed-number gaps under retries/concurrency.
- [ ] Verify finalized editing keeps the number and revise-as-new creates an unnumbered draft.
- [ ] Verify seller/customer/template/logo snapshots remain stable after later profile/template changes.
- [ ] Verify history search/filter/sort, Trash, restore, and permanent-delete workflows against a real test database.
- [ ] Build and run canonical-renderer visual fixtures for English, Bangla/mixed scripts, long invoices, repeated headers, logos, hidden fields, and multi-page output.
- [ ] Verify desktop/tablet/mobile authenticated workflows beyond the guest homepage smoke test.
- [ ] Execute destructive admin removal and full account purge, including private storage cleanup and Auth-user deletion, on disposable data.
- [ ] Review Vercel/Supabase logs for absence of invoice PII, credentials, tokens, and confirmation links.
- [ ] Confirm Vercel Hobby/private-beta limits, paid-overage settings, and public signup restrictions.

### Integration/security/visual test work not yet present or not yet executed

- [ ] Add or execute disposable-environment integration coverage for identity linking, first-admin race safety, disabled sessions, purge, private storage, draft conflicts, customer sync, finalization idempotency, number races, Trash restore, and export authorization.
- [ ] Add security coverage for cross-workspace IDs, unauthorized admin routes, stale sessions after removal, XSS/template injection, invalid file signatures, storage path traversal, duplicate finalization, account-deletion targeting, and PII leakage.
- [ ] Add visual regression fixtures comparing live preview, PDF page images, and DOCX-rendered page images with controlled rasterization tolerance.

### Beta launch sequence actions

- [x] Deploy a protected Vercel preview — ready at https://invoice-j834ibfy7-istiaq-s-org.vercel.app (deployment `dpl_6RyPS3Wi4Z4cS2aFZ524gV1DE9jK`).
- [ ] Apply migrations `0001` through `0019` to a private Singapore Supabase project.
- [ ] Add the first approved email and create the initial admin account.
- [ ] Test admin removal on a disposable account.
- [ ] Test complete account purge and storage cleanup.
- [ ] Run export fixtures and live RLS/security tests.
- [ ] Verify guest exports do not create database rows.
- [ ] Test drafts, finalization, editing, Trash, and restore.
- [ ] Review logs for invoice PII.
- [ ] Confirm free-tier limits and paid overages are disabled.
- [ ] Invite testers gradually and keep public signup/commercial launch disabled.

## Current advisor findings after migrations `0020`–`0026`

- **Resolved:** trigger-only `SECURITY DEFINER` functions are no longer executable by `anon` or `authenticated`.
- **Resolved:** overlapping `account_purge_jobs` read policies are consolidated.
- **Intentional INFO:** RLS is enabled without policies on `private.invoice_finalization_requests` and `public.number_reservations`; both are server/RPC-owned tables and do not expose client rows.
  - Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- **Intentional INFO:** 16 indexes are unused because this beta database has very low traffic/data volume; reassess after real usage before removing indexes.
  - Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index
- **Intentional WARN:** authenticated users can execute validated `SECURITY DEFINER` RPCs because the application calls these RPCs through authenticated sessions. Each RPC performs workspace/role validation.
  - Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- **Unresolved dashboard WARN:** leaked-password protection is disabled; enable it in Supabase Auth settings.
  - Remediation reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Decisions and constraints

- Do not expose `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET` to browser code or `NEXT_PUBLIC_*` variables.
- Do not use a service-role key for Supabase API security tests.
- Do not apply destructive migrations to production without explicit review and a backup/rollback plan.
- Do not modify or revert unrelated user changes.
- Keep the task log current; after each completed item, change `[ ]` to `[x]` and add the command/result under the validation history.

## Validation history

| Date | Command/action | Result | Follow-up |
|---|---|---|---|
| 2026-09-21 | Repository inspection and reconstruction | Working tree contained the beta-hardening changes listed above; this became the initial handoff checkpoint | Run local validation gates |
| 2026-09-21 | `npm run test:unit`, `npm run test`, `npm run lint`, `git diff --check` | Passed; Supabase tests were skipped because no `SUPABASE_TEST_*` variables were configured | Fix export/purge/admin findings, then rerun build and E2E |
| 2026-09-21 | Code review of uncommitted beta-hardening slice | Found browser export failure on unsupported CSS colors, purge/logo trigger ordering risk, inactive-admin counting bug, missing server-only guard, missing admin mutation origin defense, and Playwright server mismatch | Targeted fixes applied; run validation again |
| 2026-09-21 | `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run test:supabase`, `npm run test:supabase:sql` | Build, type-check, lint, and local tests passed. Supabase API and SQL suites safely skipped because no explicit test-project variables were configured. | Configure a disposable Supabase test project for live RLS/RPC/purge validation |
| 2026-09-21 | `npm run test:e2e` before export fix | Failed 3 export tests with html2canvas unsupported `lab` parsing; homepage tests passed | Investigated clone document roots and unsupported `oklab`/`lab` values |
| 2026-09-21 | `npm run test:e2e` after export fix | Passed 6/6 tests across mobile-320, mobile-375, and desktop; PDF and DOCX downloads emitted | Keep export checkbox complete; no browser regression remains |
| 2026-09-21 | Tightened `tests/supabase/rls.test.ts` direct-write probes and reran type-check, lint, test, diff check, and build | All local checks passed; live Supabase assertions remain skipped without an explicit disposable project | Run live RLS/admin/purge validation before beta |
| 2026-09-21 | Applied `0020_harden_trigger_permissions_and_purge_index` to `invoice-studio` | Applied successfully; trigger-only functions no longer have API execute grants and the purge-job allowlist foreign key is indexed | Refresh advisors and run live RLS checks |
| 2026-09-21 | Live anonymous RLS test before fixture adjustment | Protected queries returned expected `42501` helper-permission denials, but the fixture treated them as failures | Updated anonymous API/SQL fixtures to accept intentional permission denial without changing database permissions |
| 2026-09-21 | Live anonymous `npm run test:supabase` with the `invoice-studio` publishable key | Passed 1 anonymous test; authenticated test skipped because no test email/password is configured | Supply a dedicated test account to run authenticated RLS/RPC/purge coverage |
| 2026-09-21 | Applied migrations `0021_scope_purge_job_read_policies` and `0022_consolidate_purge_job_read_policy` | Applied successfully; performance advisor no longer reports overlapping purge-job policies | Remaining advisor findings are intentional RPC grants, no-policy internal tables, and low-volume unused indexes |
| 2026-09-21 | Vercel Preview deployment | Final workspace redeployed and ready at https://invoice-kkxmsvjmz-istiaq-s-org.vercel.app; only public Supabase variables are configured | Add `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` before enabling purge/cron smoke tests |
| 2026-09-21 | Expanded `npm run test:e2e` | Passed 12/12 tests across mobile-320, mobile-375, and desktop, including guest reload data loss, health response, PDF, and DOCX | Authenticated preview smoke tests still require credentials |
| 2026-09-21 | Re-ran live anonymous `npm run test:supabase` after migrations `0021`–`0022` | Passed 1/1 runnable test; authenticated test remains skipped only because test email/password are unavailable | Supply dedicated authenticated test credentials |
| 2026-09-21 | Invoice-page seller/customer profile workflow | Added auth-race-safe loading, seller save, customer save/update, idempotent customer POST, and optional-field preservation | Run authenticated preview smoke test when credentials are available |
| 2026-09-21 | Final feature validation | `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, and `npm run test:e2e` passed; E2E result 12/12 | Redeploy current workspace preview |
| 2026-09-21 | Final feature preview deployment | Ready at https://invoice-j834ibfy7-istiaq-s-org.vercel.app (deployment `dpl_6RyPS3Wi4Z4cS2aFZ524gV1DE9jK`) | Authenticated profile actions still need a signed-in preview smoke test |
| 2026-09-21 | Added Next.js 16 root `proxy.ts` and reran local validation | `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, and `git diff --check` passed; E2E result 12/12; build recognized `ƒ Proxy (Middleware)` | Redeploy current workspace preview and run authenticated profile smoke test |
| 2026-09-21 | Validated incomplete-autosave fix | `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, and `git diff --check` passed; E2E result 12/12 | Redeploy current workspace preview |
| 2026-09-21 | Redeployed current workspace to Vercel Preview and checked health | Ready deployment `dpl_32ncLhDf8bbHVTUi4pEVQatHiWMS` at `https://invoice-cji8gx7yi-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok` and version `acd4d89817672b53b8936ceab8132117ab9f8439`; unauthenticated `/api/seller-profile` and `/api/customers` correctly returned `401 Authentication is required.` | Sign in and smoke-test seller/customer save and load actions; configure missing server-only secrets before purge testing |
| 2026-09-21 | Deployed incomplete-autosave fix to Vercel Preview | Ready deployment `dpl_ASEK2ZJZTqQSRU9pFDhJU3YL37N3` at `https://invoice-k2hw3kjd7-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok`; unauthenticated profile/customer requests returned the expected `401` | Hard-refresh the preview, sign in, and verify seller/customer load and save actions |
| 2026-09-21 | Deployed visible profile/customer status-feedback build | Ready deployment `dpl_GEVxoQ9XmXV3xEnDC2piAuiH8iAe` at `https://invoice-h1gmacox6-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok`; unauthenticated profile/customer requests returned the expected `401` | Hard-refresh this preview, sign in, click Load saved profile, and report the visible `Seller:` status if it still fails |
| 2026-09-21 | Deployed final button-row status-feedback build | Ready deployment `dpl_Gih1VJn6LmELBVXKzWmZDQh7ragt` at `https://invoice-orqf33sy8-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok`; unauthenticated profile/customer requests returned the expected `401` | Hard-refresh this preview, sign in, and use the seller/customer status shown beside each action button |
| 2026-09-21 | Deployed working profile/customer drawer build | Ready deployment `dpl_BQvn4LgYYbTPL7eXLjYv1PHWWcsU` at `https://invoice-35ezszz4x-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok`; unauthenticated profile/customer requests returned the expected `401` | Hard-refresh this preview, sign in, and verify the drawer lists saved seller/customer records |
| 2026-09-21 | Deployed auth-state and invoice-logo build | Ready deployment `dpl_Foeb9K3SLhKJm2ivV1mLSjdHQZ4t` at `https://invoice-o9oe2djby-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok`; unauthenticated profile/customer requests returned the expected `401` | Hard-refresh this preview, sign in, verify `Signed in` status, upload a logo, and confirm it appears in the invoice preview |
| 2026-09-22 | Deployed hydration-safe logo upload build | Ready deployment `dpl_HJid8inWTGRcMnRLp5rM7cMPVucD` at `https://invoice-jb97isd7a-istiaq-s-org.vercel.app`; `/api/health` returned `status: ok`; unauthenticated logo/profile requests correctly returned `401` | Hard-refresh this preview, sign in, and retry logo upload; verify no React hydration error appears |
| 2026-09-22 | Validated persistent logo upload feedback | TypeScript, lint, build, diff check, and Playwright 15/15 passed | Deploy final upload-feedback build |
| 2026-09-22 | Deployed persistent logo upload-feedback build | Ready Vercel Preview `https://invoice-kmmixfakm-istiaq-s-org.vercel.app` with deployment `dpl_A2pYmiVYhMRpkNQebwpetPXFj82S`; `/api/health` returned `status: ok`; unauthenticated `/api/seller-profile`, `/api/customers`, and `/api/seller-logo` each returned the expected `401 Authentication is required.` | Hard-refresh the preview with `Ctrl + Shift + R`; authenticated logo upload still needs manual smoke testing because no test credentials are available |
| 2026-09-22 | Diagnosed and fixed repeated invoice `409` responses | Overlapping autosave requests reused the same draft version after React effect cleanup; autosaves are now serialized, the newest state is queued, returned versions are always retained, and finalization waits for pending saves | Test the new preview with an authenticated account |
| 2026-09-22 | Deployed autosave conflict fix | Ready Vercel Preview `https://invoice-fd9jho56b-istiaq-s-org.vercel.app` with deployment `dpl_5kZ7ES7pBSW7zHpUFWvF3oW3jicv`; `/api/health` returned `status: ok`; unauthenticated `POST /api/invoices/drafts` and `POST /api/invoices/finalize` returned the expected `401 Authentication is required.` | Hard-refresh the preview with `Ctrl + Shift + R`; sign in and verify draft autosave and finalization no longer produce repeated 409 responses |
| 2026-09-22 | Published final autosave error-state adjustment | Focused TypeScript, lint, unit tests (6/6), and `git diff --check` passed; failed autosaves now clear the pending-finalization lock while retaining conflict/error status | Use the latest preview below |
| 2026-09-22 | Deployed final autosave fix | Ready Vercel Preview `https://invoice-2gj8w7ezr-istiaq-s-org.vercel.app` with deployment `dpl_9qFFZ25UM3YJcr3wHgjyaSpg95ZK`; `/api/health` returned `status: ok` | Hard-refresh the preview with `Ctrl + Shift + R`; sign in and verify autosave/finalization behavior |
| 2026-09-22 | Added seller-profile logo association and invoice logo snapshot selection | Applied migration `0023_link_seller_profile_logo` to `invoice-studio`; TypeScript, lint, build, unit tests 6/6, Playwright 15/15, and advisor refresh completed; profile API returns the associated logo preview and invoice finalization prefers a valid workspace-owned logo ID from the canonical document | Authenticated profile/logo/finalization smoke test still requires workspace credentials |
| 2026-09-22 | Deployed profile-linked logo behavior | Ready Vercel Preview `https://invoice-h4h1epu5s-istiaq-s-org.vercel.app` with deployment `dpl_CsQVpmpb6ayWSGtQugujzjXqwkum`; `/api/health` returned `status: ok`; existing security/performance advisor findings remain documented and the new index is unused only because beta data volume is low | Hard-refresh the preview with `Ctrl + Shift + R`; sign in, save the seller profile with a logo, then load/apply the profile and verify the logo is restored |
| 2026-09-22 | Added empty seller-profile validation | Invoice UI now blocks Save as profile when company name or seller name is blank; API schema rejects the same invalid payload; TypeScript, lint, build, unit tests 6/6, Playwright 15/15, and `git diff --check` passed | Use the latest preview below |
| 2026-09-22 | Deployed final seller-profile validation | Ready Vercel Preview `https://invoice-254whmakw-istiaq-s-org.vercel.app` with deployment `dpl_4D2fiGLv1tAAGWBnZRf4eSCRRdox`; `/api/health` returned `status: ok`; unauthenticated `GET /api/seller-profile` returned the expected `401 Authentication is required.` | Hard-refresh the preview with `Ctrl + Shift + R`; verify blank Save as profile shows an inline validation message and sends no save request |
| 2026-09-22 | Sanitized invoice finalization confirmation | Replaced `window.confirm` with a branded accessible dialog; TypeScript, lint, build, unit tests 6/6, and Playwright 15/15 passed | Use the latest preview below and verify Cancel, Escape, backdrop click, and Finalize invoice behavior |
| 2026-09-22 | Deployed sanitized finalization dialog | Ready Vercel Preview `https://invoice-bqyjb3vpg-istiaq-s-org.vercel.app` with deployment `dpl_BCrUFKQNrtiyeyV2kNvjhLzwaDr3`; `/api/health` returned `status: ok` | Hard-refresh the preview with `Ctrl + Shift + R`; finalize an invoice to use the new in-app dialog |
| 2026-09-22 | Fixed PDF/DOCX logo and pagination layout | Preserved logo aspect ratio, trimmed only near-page-height trailing overflow, switched DOCX output to A4 zero-margin sections with zero paragraph spacing, and added live `PDF/DOCX estimate: N page(s)` preview feedback; TypeScript, lint, build, unit tests 6/6, Playwright 15/15, and diff check passed | Test both downloads with a real logo and confirm the page count matches the output |
| 2026-09-22 | Deployed export layout fix | Ready Vercel Preview `https://invoice-8cci1ftug-istiaq-s-org.vercel.app` with deployment `dpl_4JLZUGqKTAYh8DU2axiEBxBhS9qQ`; `/api/health` returned `status: ok` | Hard-refresh the preview with `Ctrl + Shift + R`; verify logo proportions, page count, and PDF/DOCX page output |
| 2026-09-22 | Researched and planned invoice customization/library work | Added `docs/plans/2026-09-22-invoice-customization-library-plan.md` covering quantity-column presentation, optional discount reasons, workspace-scoped reusable items/notes, compact layout work, migration/API/RLS design, export fixtures, and validation/deployment gates; no application code or database migration was changed | Review product decisions in Section 3 before implementation; use the plan as the next workstream |
| 2026-09-22 | Implemented invoice customization and reusable libraries | Added quantity-column presentation toggle with legacy default compatibility, optional discount reasons, compact preview spacing, reusable item/note API routes and UI drawers, styled note-save dialog, soft-delete library tables, and migration `0024_saved_invoice_libraries` | Authenticated library workflows still need a signed-in manual/integration smoke test because no test credentials are configured |
| 2026-09-22 | Validated customization/library slice | Beta migration applied successfully to `invoice-studio` as `20260922142432_saved_invoice_libraries`; security/performance advisors refreshed; TypeScript, lint, build, unit tests 8/8, guest E2E 24/24, diagnostics, and diff check passed; new guest API checks return `401` | Deploy a Preview for authenticated item/note save/load and finalized-invoice smoke testing |
| 2026-09-22 | Deployed customization/library Preview | Ready at `https://invoice-i759fh0ck-istiaq-s-org.vercel.app` with deployment `dpl_Ec6c1qkcBwfRbtfqTRp8RSsQfYqs`; direct Preview deployment completed without commit/push | Sign in and test item/note save-load, quantity persistence, discount reasons, and authenticated finalization/export behavior |
| 2026-09-22 | Updated discount-reason layout and redeployed Preview | Discount reason now uses the open space beside the discount amount in the canonical summary row; focused Playwright test passed 3/3 viewports, lint, TypeScript, and diff check passed; Ready Preview: `https://invoice-c6pa5wepw-istiaq-s-org.vercel.app` (`dpl_AbjErvU69SSH77h4gV6ysBERdKp9`) | Superseded by per-item discounts; the discount-reason feature was later removed |
| 2026-09-21 | Added visible profile/customer status feedback and validated | TypeScript, lint, unit tests, build, E2E 12/12, and diff check passed | Deploy latest status-feedback build and inspect the visible result after clicking Load saved profile |
| 2026-09-22 | Implemented per-item discounts and removed discount reasons | Added fixed BDT and percentage discounts per line, editor original/discount/net calculations, export discount/net display, total discount summary, legacy fallback handling, responsive preview column sizing, and updated unit/E2E coverage | Apply the latest Preview to authenticated draft/finalization smoke testing when credentials are available |
| 2026-09-22 | Applied database migrations `0025_line_item_discounts` and `0026_fix_line_discount_rpc` | Beta project `sqbpvpwroyrabfixfgkg` reports both migrations applied; invoice lines contain discount type/input, original amount, and discount amount columns; corrected the finalized-invoice overflow return path; security/performance advisor findings remain the documented intentional/internal warnings | Run authenticated RPC boundary and finalization tests with a dedicated test account |
| 2026-09-22 | Final local validation for per-item discounts | `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:unit` (9/9), `npm run test:e2e` (24/24 across 3 viewports), and `git diff --check` passed; only the known Next.js `--localstorage-file` warning appeared during build/E2E | Authenticated smoke testing remains blocked by missing test credentials |
| 2026-09-22 | Deployed per-item discount Preview | Preview `https://invoice-79jrxqjcd-istiaq-s-org.vercel.app`, deployment `dpl_2aopF7KhuprpYA6GDFrJvMWuLkze`; Vercel inspect initially reported `Building` | Wait for Vercel to finish processing, then test per-item fixed/percentage discounts, quantity toggle, reusable libraries, page estimate, and both exports |
| 2026-09-23 | Removed the Original column from invoice exports | Canonical preview/PDF/DOCX item columns are now Description, optional Qty, Price, Discount, and Amount; focused export/layout tests passed 6/6 and the full Playwright suite passed 24/24 | Test the refreshed Preview and confirm the compact table is preferable |
| 2026-09-23 | Deployed Original-column removal Preview | Ready at `https://invoice-mrewoosqq-istiaq-s-org.vercel.app` with deployment `dpl_AFeG5Trm3ZvcMbD5nwU4wuW3iPyV`; Vercel inspect confirmed `Ready` | Test the compact export table and confirm PDF/DOCX output |
| 2026-09-21 | Implemented profile/customer slide-over drawers and fixed click invocation | Targeted Playwright drawer test passed 3/3 across mobile-320, mobile-375, and desktop; the prior test failure proved the handlers were not invoked | Run full validation and deploy the corrected drawer build |
| 2026-09-21 | Full validation after drawer/click fix | TypeScript, lint, unit tests, build, diff check, and Playwright 15/15 passed; drawer regression passed in all three configured viewports | Deploy the verified build and test authenticated saved profiles |
| 2026-09-21 | Validated auth-state, guest gating, and invoice logo UI | TypeScript, lint, unit tests, build, diff check, and Playwright 15/15 passed; guest test confirms saved-profile and upload controls are hidden | Deploy Preview and test signed-in session label, logo upload progress, and logo preview |
| 2026-09-22 | Investigated React `#418` during logo upload | Identified date values generated during render as a hydration mismatch risk; changed initial dates to deterministic empty values and added a no-page-error E2E assertion; targeted and full E2E suites passed | Deploy hydration-safe upload build |
| 2026-09-21 | Investigated reported profile-button issue from browser console | Found `/api/invoices/drafts` was being called while the invoice was incomplete; the server correctly returned `400`, but the autosave error obscured the profile action. Added an `incomplete` guard and no-store profile/customer loads. | Deploy and verify the corrected preview |
| 2026-09-24 | Requeued the mobile invoice flow after the 0px luxury redesign | `app/page.tsx` renders a six-step mobile flow (`Details`, `From`, `Bill to`, `Items`, `Notes`, `Preview`) with a fixed bottom action bar below `lg`; the pre-stepper Playwright spec therefore failed 5/8 on `mobile-320` and `mobile-375` because preview and off-step panels are `display:none`. | Update the E2E spec to drive the stepper instead of assuming a single-page form |
| 2026-09-24 | Made the guest E2E spec step-aware and added a stepper accessibility hook | Added `usesSteppedFlow`/`openStep`/`previewPanel` helpers, added `aria-current="step"` to the active step button in `app/page.tsx`, scoped export locators to the `Invoice preview` region (the mobile bottom bar duplicates `Download PDF`), and moved line-item value assertions to the always-present mobile card inputs (`#description-1`, `#price-1`). | Re-run all three Playwright projects |
| 2026-09-24 | `npx playwright test` full suite | 24/24 passed in a single run (8 tests × `mobile-320`, `mobile-375`, `desktop`), including per-item discounts and the PDF/DOCX download path. | No browser regression remains; manual visual smoke test is still recommended |
| 2026-09-24 | `npm test`, `npx tsc --noEmit`, `npx eslint app components lib tests`, `git diff --check`, `npm run build` | All passed; 9 unit tests passed with 2 Supabase tests skipped, the Next.js production build compiled all 24 routes, and `git diff --check` reported no whitespace errors after removing a trailing blank line in `app/globals.css`. | Record the validation and keep the tree ready to commit |
| 2026-09-24 | Verified the 0px design system across `app`, `components`, and `lib` | Regex audit for `rounded-(?!none)`, `border-radius`, and `borderRadius` returned zero matches; `--radius: 0px` is set in `app/globals.css`, every component uses `rounded-none`, and `:where(a, button, input, select, textarea):focus-visible` provides a global 2px focus outline so the new mobile step buttons are keyboard-visible. | None; the design system is internally consistent |

## Context-window protection protocol

1. Use this file as the canonical task state.
2. Work in small slices: inspect, edit, validate, then update this log.
3. Prefer targeted reads and focused commands over dumping large files or full diffs.
4. Before a long validation or handoff, update the checklist and validation history.
5. If context becomes constrained, stop after updating this file with the exact next command and unresolved issue.
6. Never claim a task is complete until its checkbox and validation result are recorded here.
