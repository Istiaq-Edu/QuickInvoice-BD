# Invoice Studio

Bangladesh-focused invoice generator built with Next.js, shadcn/ui, Tailwind CSS, and Supabase.

## Current implementation

- Responsive guest invoice editor with live A4 portrait preview
- BDT whole-number calculations and fixed/percentage discounts
- Authenticated incomplete-draft autosave with optimistic version conflicts
- Authenticated invoice finalization with atomic numbering and idempotent retries
- Invoice history search, status/date/amount filters, sorting, editing, revising, and direct PDF/DOCX re-downloads
- English interface with Bangla-capable text entry
- Responsive desktop/tablet/mobile line-item editing
- Browser-side PDF and image-based DOCX exports from the live preview; production/server-side renderer hardening remains
- Supabase browser/server client boundaries
- Initial PostgreSQL/RLS migration in `supabase/migrations/0001_invoice_foundation.sql`
- Lifecycle hardening and RLS migrations in `supabase/migrations/0002_harden_invoice_lifecycle.sql` and `supabase/migrations/0003_enable_private_finalization_rls.sql`
- Atomic finalization RPC in `supabase/migrations/0004_finalize_invoices.sql`
- Draft loading, revise-as-new, payment status updates, and Trash lifecycle actions in `supabase/migrations/0005_invoice_lifecycle_actions.sql`
- Authenticated seller profile settings and private customer directory with automatic buyer syncing
- Bounded template settings for accent color, contact/address visibility, and notes
- Finalized invoices snapshot template settings through `supabase/migrations/0006_snapshot_template_settings.sql`
- Private seller logo upload and immutable finalized-logo snapshots through `supabase/migrations/0007_manage_seller_logo.sql` and `supabase/migrations/0008_preserve_logo_snapshot.sql`
- Invite-aware email/password login, signup, password reset, and confirmation callback screens

See [`docs/plans/2026-09-21-invoice-generator-plan.md`](docs/plans/2026-09-21-invoice-generator-plan.md) for the validated implementation plan.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The generator works without Supabase credentials. Auth and cloud persistence require:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for future server-only admin/purge workflows

Apply the migration to a private Singapore Supabase project before enabling beta accounts. Keep the service-role key server-only and do not commit `.env.local`.

## Validation

```bash
npm run lint
npm run build
```
