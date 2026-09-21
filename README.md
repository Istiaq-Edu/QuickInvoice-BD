# Invoice Studio

Bangladesh-focused invoice generator built with Next.js, shadcn/ui, Tailwind CSS, and Supabase.

## Current implementation

- Responsive guest invoice editor with live A4 portrait preview
- BDT whole-number calculations and fixed/percentage discounts
- English interface with Bangla-capable text entry
- Responsive desktop/tablet/mobile line-item editing
- Browser-side PDF and image-based DOCX exports from the live preview; production/server-side renderer hardening remains
- Supabase browser/server client boundaries
- Initial PostgreSQL/RLS migration in `supabase/migrations/0001_invoice_foundation.sql`
- Invite-aware login, signup, password reset, and OAuth callback screens

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
