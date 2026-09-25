# QuickInvoice-BD

A Bangladesh-focused invoice editor with guest mode, authenticated workspaces, and PDF/DOCX export.

**Production:** [quickinvoice-bd.vercel.app](https://quickinvoice-bd.vercel.app)

## Features

- Invoice editor with live A4 preview, BDT totals, discounts, and template controls
- PDF and DOCX export
- Authenticated drafts, history, revisions, payment status, and trash
- Customer directory, seller profile, and private logo storage
- Saved items and note templates
- Supabase RLS, role-gated administration, and server-only account purge APIs

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Supabase · Vitest · Playwright · Vercel

## Local development

### Requirements

- Node.js 20+
- npm
- Supabase project for authentication and cloud persistence (optional for guest mode)

### Setup

```bash
git clone https://github.com/Istiaq-Edu/QuickInvoice-BD.git
cd QuickInvoice-BD
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Guest invoices and exports work without Supabase configuration. Authentication, saved data, and admin features require the variables below.

## Environment

Create `.env.local` from `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_` or commit it. The account-purge worker also requires a private `CRON_SECRET` in the deployment environment.

## Database

Apply the SQL files in `supabase/migrations` in numerical order through `0026_fix_line_discount_rpc.sql`. They define the invoice lifecycle, workspace isolation, saved libraries, seller branding, line-item discounts, and administrative workflows.

## Validation

```bash
npm run lint
npm test
npm run build
```

For browser tests, install Chromium once and run:

```bash
npx playwright install chromium
npm run test:e2e
```

Supabase integration tests are opt-in and require their dedicated test environment variables. No test or migration file contains production credentials.

## Deployment

The repository is connected to Vercel through GitHub. Pushes to `main` automatically deploy to production:

[https://quickinvoice-bd.vercel.app](https://quickinvoice-bd.vercel.app)

Other branches create preview deployments. Before enabling authenticated features, configure the Supabase variables in Vercel and apply all migrations through `0026`.

## Structure

```text
app/                 Pages, routes, and API handlers
components/          Shared UI and workspace components
lib/                 Invoice, export, and Supabase utilities
supabase/migrations/ Schema, RLS, and RPC migrations
tests/               Unit, Supabase, and Playwright tests
scripts/             Local visual QA helpers
```
