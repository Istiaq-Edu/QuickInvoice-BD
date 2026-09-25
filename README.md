# QuickInvoice-BD

A Bangladesh-focused invoice workspace for creating, managing, and exporting professional invoices. The app supports guest invoices, authenticated workspaces, live A4 previews, reusable customer/item data, and secure server-side administration.

**Production:** [quickinvoice-bd.vercel.app](https://quickinvoice-bd.vercel.app)

## Features

- Responsive invoice editor with live A4 portrait preview
- BDT whole-number calculations with fixed and percentage discounts
- Seller, customer, line-item, notes, and template controls
- PDF and DOCX exports
- Email/password authentication with private workspace data
- Draft autosave, finalization, history, revision, payment status, and trash workflows
- Saved customers, reusable items, and note templates
- Seller profile and private logo management
- Supabase row-level security, admin allowlist, and server-only account purge workflows

## Stack

- Next.js 16 and React 19
- TypeScript
- Tailwind CSS 4 and shadcn/ui
- Supabase Auth, PostgreSQL, Storage, and RLS
- Vitest and Playwright
- Vercel hosting

## Local development

### Requirements

- Node.js 20+
- npm
- A Supabase project for authentication and persistence

### Setup

```bash
git clone https://github.com/Istiaq-Edu/QuickInvoice-BD.git
cd QuickInvoice-BD
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Guest invoice creation and exports work without Supabase configuration. Authentication, cloud persistence, saved libraries, and admin features require the environment variables below.

## Environment variables

Create `.env.local` from `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it through a `NEXT_PUBLIC_` variable or commit it to the repository. The account-purge worker also requires a private `CRON_SECRET` in the deployment environment.

## Database

Apply the SQL migrations in `supabase/migrations` in numerical order, through `0026_fix_line_discount_rpc.sql`, before enabling authenticated beta features. The migrations define the invoice lifecycle, workspace isolation, saved libraries, seller branding, line-item discounts, and administrative workflows.

## Validation

Run the standard checks before publishing:

```bash
npm run lint
npm test
npm run build
```

Install the Playwright browser once, then run the end-to-end suite:

```bash
npx playwright install chromium
npm run test:e2e
```

The default test command skips Supabase integration tests unless the explicit test environment variables are configured. No test or migration file contains production credentials.

## Deployment

The repository is connected to Vercel through GitHub. A push to `main` automatically creates a production deployment at:

[https://quickinvoice-bd.vercel.app](https://quickinvoice-bd.vercel.app)

Before the first authenticated deployment, configure the Supabase variables in Vercel and apply all migrations through `0026`. Branches other than `main` create preview deployments.

## Project structure

```text
app/                 Next.js routes, pages, and API handlers
components/          Shared UI and workspace components
lib/                 Invoice, export, and Supabase utilities
supabase/migrations/ Database schema, RLS, and RPC migrations
tests/               Unit, Supabase, and Playwright tests
scripts/             Local visual QA helpers
```
