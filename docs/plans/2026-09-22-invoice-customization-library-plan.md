# Invoice customization and reusable library plan

**Date:** 2026-09-22
**Status:** Research-verified implementation plan; not yet implemented
**Scope:** Quantity-column presentation, discount reason, reusable items/notes, and more efficient export layout

## 1. Goal and success criteria

Improve the invoice editor without changing existing money calculations or finalized-invoice behavior:

1. Let the user show or hide the **Quantity** column on the rendered invoice.
2. Let the user enter an optional **discount reason** that is shown beside the discount when applicable.
3. Let authenticated users save and reuse item descriptions/prices and note templates.
4. Use the A4 preview space more efficiently while keeping text readable and keeping PDF/DOCX page counts reliable.
5. Keep all new account data isolated to the current workspace and preserve guest exports.

The work is complete only when:

- Existing invoices and templates load with safe backward-compatible defaults.
- Hidden quantity changes presentation only; quantity remains available for editing, calculation, autosave, finalization, and historical snapshots.
- Discount reasons, items, and notes survive draft load and finalized-invoice reload where applicable.
- Reusable content never silently replaces existing invoice content.
- UI page estimates match the actual generated page count for the export fixtures.
- Guest controls remain usable without creating database rows.
- Unauthenticated and cross-workspace access is denied.

## 2. Research and verified design basis

The following authoritative references were reviewed before planning:

- [MDN `object-fit`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit): `contain` preserves an image's intrinsic aspect ratio, while `fill` can stretch it. The existing logo fix should remain unchanged.
- [MDN `@page`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@page): print page size and margins must be explicit. This remains relevant even though the current export path uses canvas slicing rather than browser print.
- [`docx` `SectionProperties`](https://docx.js.org/api/classes/SectionProperties.html) and [`ImageRun`](https://docx.js.org/api/classes/ImageRun.html): DOCX page dimensions are twips and image transformations require explicit dimensions. The current A4, zero-margin, image-based DOCX strategy should be retained for visual parity.
- [Stripe invoice line item object](https://docs.stripe.com/api/invoice-line-item/object): invoice lines keep description, quantity, unit pricing, and amount as separate concepts. This supports hiding quantity visually while retaining it for calculation.
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): value validity belongs in database constraints where practical; foreign keys preserve tenant relationships; cross-table rules should not be implemented as ordinary `CHECK` constraints.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): exposed workspace-owned tables need RLS, explicit policies, appropriate grants, and tests for both allowed and denied access.
- Intuit's official discount guidance was also reviewed through its search result at [QuickBooks discount guidance](https://quickbooks.intuit.com/learn-support/en-us/help-article/service-items/add-discount-invoice-sales-receipt-quickbooks/L3VyP6cwJ_US_en_US). It supports giving a discount a descriptive name/reason. The direct article fetch was unavailable, so this is supporting context rather than the sole basis for the design.

### Research conclusions

- Quantity is a presentation/template setting, not a calculation setting.
- A discount reason should be plain text, optional, and rendered near the discount rather than moved into general notes.
- Reusable items should store description and default unit price, not invoice-specific quantity.
- Reusable notes should have a title and body so users can distinguish templates safely.
- The canonical preview must remain the single source for PDF and DOCX output.

## 3. Product decisions for implementation

These decisions should be treated as the implementation contract unless product review changes them before coding:

- `showQuantityColumn` is stored in the workspace template and defaults to `true` for existing data.
- The control is visible in the Items section because that is where users expect it; it may also be shown in the Customize panel, but both controls must update the same state.
- Hiding the quantity column hides it from the invoice preview, PDF, and DOCX. It does not remove quantity inputs from the editor or quantity from canonical data.
- Discount reason is optional plain text with a 1,000-character limit after trimming.
- Discount reason is available when a discount type is selected, but it renders only when the calculated discount is greater than zero and the reason is non-empty. Empty or zero-value discount reasons never create an empty label in exports.
- Saved items contain `description` and `default_unit_price`; quantity is always invoice-specific and starts at `1` when an item is added.
- Saved notes contain `title` and `body`; the existing combined notes/payment-terms field remains one field in this release.
- Applying a saved item appends a line. It never replaces all current lines.
- Loading a saved note offers explicit `Replace notes` and `Append to notes` actions. There is no silent replacement.
- Duplicate item descriptions and duplicate note titles are allowed, with a non-blocking warning or clear wording; no silent overwrite or uniqueness collision is introduced.
- Library controls are account-only. Guests can use the quantity toggle and discount reason locally and export them, but cannot save/load library records.
- New library data is workspace-scoped and soft-deleted so accidental deletion can be handled consistently with the existing customer directory pattern.

## 4. Current extension points

The implementation should extend these existing paths rather than introduce a parallel invoice model:

- `app/page.tsx`: form state, template controls, item rows/cards, discount controls, notes, live preview, page estimate, autosave payload, and profile-style drawers.
- `lib/invoice/types.ts`: `TemplateSettings`, `InvoiceDraft`, and canonical field types.
- `lib/invoice/validation.ts`: template defaults, invoice schemas, discount-reason limits, and backward-compatible parsing.
- `app/api/template/route.ts`: template defaults, GET normalization, and PUT validation.
- `app/api/invoices/drafts/route.ts`, `app/api/invoices/update/route.ts`, `app/api/invoices/finalize/route.ts`, and `app/api/invoices/detail/route.ts`: canonical persistence, validation, load, and finalized snapshots.
- `lib/invoice/export.ts`: shared canvas capture, page splitting, PDF/DOCX generation, and page-count estimation.
- `supabase/migrations/`: next migration after `0023_link_seller_profile_logo.sql`.
- `tests/unit/validation.test.ts`, `tests/e2e/guest.spec.ts`, and the existing Supabase RLS fixtures.

## 5. Phased implementation checklist

### Phase 0 — Confirm product decisions and acceptance fixtures

- [ ] Confirm the decisions in Section 3, especially whether discount reason should render only for a positive calculated discount.
- [ ] Define fixture invoices before implementation:
  - one short invoice with quantity shown;
  - the same invoice with quantity hidden;
  - fixed and percentage discounts with reasons;
  - long item descriptions and long notes;
  - logo with a non-square aspect ratio;
  - enough lines to span two pages;
  - Bangla/mixed-script content.
- [ ] Record that the current export is image-based: DOCX is intentionally not line-editable.
- [ ] Confirm no production migration is allowed; database work targets only beta project `sqbpvpwroyrabfixfgkg` after review.

**Gate:** no schema or UI implementation begins until quantity semantics, discount rendering, and note replace/append behavior are unambiguous.

### Phase 1 — Extend canonical types, validation, and compatibility

- [ ] Add `showQuantityColumn: boolean` to `TemplateSettings` in `lib/invoice/types.ts`.
- [ ] Add `discountReason?: string` or a normalized string field to `InvoiceDraft` and persisted document types.
- [ ] Add `showQuantityColumn: true` to client and server template defaults.
- [ ] Update `templateSettingsSchema` and `app/api/template/route.ts` so older JSON settings missing the new key are merged with defaults instead of being rejected or losing existing settings.
- [ ] Decide and document the template schema version bump (recommended: version `2`).
- [ ] Add a dedicated discount-reason schema with trim and max length `1_000`; preserve empty string as the normalized value.
- [ ] Add the new field to draft-save, finalization, update, and detail/load validation paths.
- [ ] Ensure old canonical documents load as:
  - `showQuantityColumn: true`;
  - `discountReason: ""`.
- [ ] Keep `quantity` required in valid line data and keep `calculateTotals` unchanged.
- [ ] Ensure finalization snapshots include the template setting and discount reason so later template changes do not alter historical invoices.

**Gate:** unit tests prove old payloads still parse, new payloads round-trip, invalid reason lengths fail, and totals are identical with quantity shown or hidden.

### Phase 2 — Quantity-column presentation toggle

- [ ] Add a `Show quantity column` checkbox in the Items section of `app/page.tsx`.
- [ ] Keep the value in `templateSettings`; do not create a second invoice-only visibility state.
- [ ] If the Customize panel also exposes the setting, make it a second control bound to the same state.
- [ ] Update the desktop preview grid classes dynamically:
  - shown: description / quantity / price / amount;
  - hidden: description / price / amount.
- [ ] Update the preview header and every rendered line consistently; do not leave an empty quantity track.
- [ ] Update mobile preview rendering so the quantity value is hidden from the rendered invoice when disabled, while the editable mobile line card still has a Quantity input.
- [ ] Keep desktop and mobile editor inputs for quantity. Add helper text explaining that quantity still affects the amount even when the invoice column is hidden.
- [ ] Ensure the setting is included in autosave and is restored by draft/detail loading.
- [ ] Ensure finalized invoice snapshots use the selected setting and do not change when the workspace template later changes.
- [ ] Recalculate the page estimate whenever the setting changes.
- [ ] Keep the quantity column visible by default for existing users and old finalized documents.

**Gate:** a quantity-hidden fixture visibly has no quantity column in preview, PDF, or DOCX; line amount remains `quantity × unit price`; no blank grid space remains.

### Phase 3 — Optional discount reason

- [ ] Add a labeled optional input or textarea directly below/alongside the discount controls in the Items section.
- [ ] Show a character counter or concise limit message near the field if practical; reject over-limit values on the server regardless of client behavior.
- [ ] Preserve the reason when the discount type changes, but render it only under the positive-discount rule in Section 3.
- [ ] Render the reason directly under the discount summary row in the canonical preview with a compact, readable style.
- [ ] Include it automatically in PDF/DOCX because both exports capture the canonical preview.
- [ ] Include it in draft autosave, draft load, finalization, finalized detail load, and revise-as-new behavior.
- [ ] Avoid displaying `Discount reason` when there is no active discount or the reason is blank.
- [ ] Treat the field as plain text and preserve line breaks safely; do not inject HTML.

**Gate:** test no-discount, zero-value discount, fixed discount, percentage discount, blank reason, maximum-length reason, over-limit reason, and multilingual reason cases.

### Phase 4 — Workspace reusable-items library

#### Database migration

- [ ] Add a migration after `0023`, recommended name `0024_add_saved_items_and_notes.sql` if both tables are shipped together.
- [ ] Create `public.saved_items` with:
  - `id uuid primary key default gen_random_uuid()`;
  - `workspace_id uuid not null references public.workspaces(id) on delete cascade`;
  - `description text not null`;
  - `default_unit_price integer not null default 0`;
  - `created_at`, `updated_at` timestamps;
  - `deleted_at timestamptz` for soft deletion;
  - checks that the description is non-blank and the price is non-negative.
- [ ] Add workspace/updated indexes and a search-supporting index where query volume justifies it.
- [ ] Do not add a uniqueness constraint on description or description/price.
- [ ] Enable RLS, add workspace-member policies, and add explicit grants consistent with the existing tenant tables.
- [ ] Verify policy filters use `public.current_workspace_id()` and prevent cross-workspace reads/writes.

#### API

- [ ] Add `app/api/items/route.ts` with authenticated GET, POST, PATCH, and DELETE behavior, or split dynamic ID routes only if the existing routing style requires it.
- [ ] GET supports a trimmed search query and excludes soft-deleted rows.
- [ ] POST validates non-empty description and non-negative integer price; returns the created item.
- [ ] PATCH requires a UUID and workspace-owned non-deleted record; return `404` for another workspace or missing/deleted item without leaking its existence.
- [ ] DELETE soft-deletes the workspace-owned record and is idempotent from the UI perspective.
- [ ] Never create a saved item automatically during invoice autosave.
- [ ] Return safe, non-PII error messages.

#### Invoice UI

- [ ] Add `Load saved items` beside the Items heading for signed-in users.
- [ ] Add a mobile-friendly drawer/picker with loading, empty, search, error, and retry states.
- [ ] Add `Save item` beside each valid line in desktop and mobile editors.
- [ ] Seed the save dialog with the current description and unit price; never save quantity as catalog data.
- [ ] Add an explicit `Add to invoice` action to each saved item.
- [ ] Append a new line with quantity `1`, the saved description, and default price.
- [ ] Keep current unsaved lines and discount/notes untouched when adding an item.
- [ ] Hide account-only library controls for guests and provide a sign-in path consistent with existing profile controls.
- [ ] Refresh the picker after create/update/delete without losing the current invoice state.

**Gate:** authenticated integration/E2E coverage saves an item, loads it, appends it with quantity `1`, edits the invoice quantity independently, and verifies another workspace cannot access its ID.

### Phase 5 — Workspace reusable-notes library

#### Database and API

- [ ] Create `public.note_templates` with:
  - `id uuid primary key default gen_random_uuid()`;
  - `workspace_id uuid not null references public.workspaces(id) on delete cascade`;
  - `title text not null` with a bounded length, recommended `200`;
  - `body text not null` with the existing notes limit, recommended `10_000`;
  - `created_at`, `updated_at`, and `deleted_at`.
- [ ] Add non-blank checks for title/body as appropriate, workspace indexes, RLS policies, and explicit grants.
- [ ] Add `app/api/note-templates/route.ts` with authenticated list/search, create, update, and soft-delete operations.
- [ ] Validate all lengths and trim title/body server-side.
- [ ] Exclude deleted templates and prevent cross-workspace ID access.

#### Invoice UI and behavior

- [ ] Add `Load saved note` and `Save current note` actions to the Notes and payment terms section for authenticated users.
- [ ] Saving requires a non-empty body and asks for a title.
- [ ] The picker displays title, a safe short preview, updated time if useful, and explicit actions.
- [ ] Applying a template offers `Replace notes` and `Append to notes`.
- [ ] Append mode inserts a readable separator/newline and preserves the current note.
- [ ] Replace mode requires the explicit button; loading the drawer alone never mutates the invoice.
- [ ] Keep the existing `showNotes` visibility setting separate from saving/loading note content.
- [ ] Keep note-library actions hidden or sign-in-gated for guests.

**Gate:** tests cover save, list/search, replace, append, cancel, empty body, long body, deletion, and cross-workspace denial.

### Phase 6 — Use page space more efficiently

- [ ] Measure the current canonical preview before changing it. Record the vertical contribution of:
  - paper padding;
  - seller header padding/gap;
  - billing block padding;
  - item-section padding and row padding;
  - summary spacing;
  - the current notes top margin.
- [ ] Reduce repeated large vertical gaps conservatively in the canonical preview, particularly the current item-section spacing and notes margin, without shrinking body text below a readable threshold.
- [ ] Use compact, consistent spacing for discount reason text so it does not create unnecessary blank space.
- [ ] Avoid reducing logo dimensions or changing `object-contain`; the aspect-ratio fix is a correctness requirement.
- [ ] Avoid arbitrary negative margins and avoid separate PDF/DOCX layouts. The preview remains the single source of truth.
- [ ] Keep headings and table headers attached to their content as far as the current image-based renderer allows.
- [ ] Re-check `estimateExportPageCount` and `splitPages` together after layout changes. Any trailing-overflow tolerance must be shared, not independently tuned.
- [ ] Keep the existing A4 ratio, zero-margin DOCX section, and trailing-blank-page protection unless a fixture demonstrates a real mismatch.
- [ ] If compact spacing alone does not meet the goal, propose a separate user-visible density setting rather than silently making typography too small.
- [ ] Update the page indicator wording if needed to clearly say `Estimated PDF/DOCX pages: N` and retain singular/plural correctness.

**Gate:** one-page fixtures remain one page, compact changes reclaim measurable vertical space, multi-page fixtures have no blank trailing page, and PDF/DOCX page counts match the estimate.

### Phase 7 — Testing and verification matrix

#### Unit and schema tests

- [ ] `showQuantityColumn` defaults to `true` for missing/old template settings.
- [ ] New template settings parse and serialize correctly.
- [ ] Discount reason trims, accepts empty, rejects over-limit, and remains plain text.
- [ ] Existing total calculations and percentage rounding are unchanged.
- [ ] Item schema rejects blank descriptions and negative/non-integer prices.
- [ ] Note schema rejects blank/over-limit titles and bodies.
- [ ] Saved item behavior does not persist quantity.
- [ ] Note append/replace helpers preserve expected text.

#### API and security tests

- [ ] Unauthenticated item/note/template mutations return `401`.
- [ ] Cross-workspace UUIDs return `404`/safe denial and never expose another tenant's data.
- [ ] RLS tests cover select, insert, update, and delete for both new tables.
- [ ] Invalid IDs, lengths, prices, blank values, and deleted records are rejected.
- [ ] Library endpoints never return invoice/customer PII beyond the requested reusable content.
- [ ] Supabase advisors are refreshed after the migration; any intentional low-volume unused-index finding is documented.

#### Guest E2E tests

- [ ] Quantity toggle is available locally and changes the preview without sign-in.
- [ ] Discount reason appears in preview/export only when applicable.
- [ ] Saved item/note controls are hidden or clearly sign-in-gated.
- [ ] Guest PDF and DOCX downloads still work and do not create invoice/library rows.
- [ ] Page estimate is visible on mobile and desktop.

#### Authenticated E2E/manual tests

- [ ] Save/load template with quantity shown and hidden.
- [ ] Save/load draft with discount reason and hidden quantity.
- [ ] Finalize, reload, and verify the snapshot remains stable after template changes.
- [ ] Save and append a reusable item; confirm quantity remains invoice-specific.
- [ ] Save a note; replace and append explicitly; cancel without mutation.
- [ ] Verify autosave serialization still avoids repeated `409` conflicts after library actions.
- [ ] Re-run seller/customer/logo workflows to detect regressions.
- [ ] Test desktop, tablet, 320px mobile, and 375px mobile layouts.

#### Export fixtures

- [ ] Logo with wide, tall, and transparent dimensions preserves aspect ratio.
- [ ] Quantity shown/hidden produces the expected column grid.
- [ ] Discount reason is positioned near the discount and does not create an orphaned label.
- [ ] Long item description and long note remain readable.
- [ ] Two or more pages contain no blank trailing page.
- [ ] Estimated page count equals generated PDF page count and DOCX rendered page count.
- [ ] English, Bangla, and mixed scripts render without clipping.
- [ ] PDF and DOCX remain visually aligned with the live preview.

### Phase 8 — Validation and deployment gates

Run these sequentially after each implementation slice and again before deployment:

```bash
npx tsc --noEmit
npm run lint
npm run test:unit
npm run build
npm run test:e2e
git diff --check
```

Then, only for the disposable beta target:

- [ ] Apply the reviewed migration to Supabase project `sqbpvpwroyrabfixfgkg`.
- [ ] Run the anonymous Supabase tests and authenticated tests when dedicated test credentials are available.
- [ ] Run SQL/RLS smoke tests when `SUPABASE_SQL_SMOKE=1` and a disposable database URL are explicitly configured.
- [ ] Refresh security and performance advisors and record findings in `docs/operations/progress.md`.
- [ ] Deploy a Vercel Preview only; do not promote to production.
- [ ] Inspect the deployment and verify `/api/health`.
- [ ] Run guest export smoke tests against the preview.
- [ ] Record deployment URL, deployment ID, migration name, test results, and any unavailable authenticated checks.

Recommended deployment commands from the existing workflow:

```bash
vercel deploy -y --no-wait --scope istiaq-s-org
vercel inspect <preview-url>
curl -fsS <preview-url>/api/health
```

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Old template JSON is rejected or loses settings | Merge normalized defaults before schema validation; add compatibility tests. |
| Hiding quantity accidentally changes totals | Keep quantity in `InvoiceLine`, validation, RPC inputs, and calculations; test both render modes. |
| Loading a reusable item overwrites invoice work | Append only; use explicit actions and preserve local state. |
| Loading a note overwrites text unexpectedly | Require explicit Replace or Append action. |
| Workspace data leaks through IDs | Derive workspace from the authenticated session, filter every query by workspace, and test cross-workspace IDs. |
| Extra fields increase export height and create blank pages | Measure spacing, keep one canonical renderer, and test estimate/split logic together. |
| Compact layout becomes hard to read | Set minimum readable typography/line-height and use measured spacing reductions rather than global scaling. |
| Autosave conflicts return after new state fields | Include new fields in the serialized request and rerun rapid-edit/finalization conflict tests. |
| Library tables become overbuilt for beta | Start with description/price and title/body only; defer SKU, categories, favorites, and bulk import. |

## 7. Definition of done

- [ ] All Phase 0–8 gates are either passed or explicitly documented as blocked by missing authenticated credentials.
- [ ] No production database or deployment was changed.
- [ ] `docs/operations/progress.md` records every migration, validation run, advisor result, and deployment.
- [ ] The final diff contains only the requested customization/library work and its tests/docs.
- [ ] No secrets, tokens, passwords, or service-role credentials are added to source, tests, logs, or documentation.
- [ ] The implementation is ready for a separate review before any commit or production promotion.
