# UI/UX & Design System Transformation Plan: Dark Precision Luxury (0px Sharp Geometry)

## 1. Executive Summary & Aesthetic Archetype

### 1.1 Aesthetic Archetype: Dark Precision Luxury
- **Philosophy**: Architectural precision, Swiss technical rigor, and obsidian depth. High-end financial machinery where every element is engineered with intention.
- **Form Language**: **Strict `0px` radius (razor-sharp corners)** across 100% of the UI (buttons, cards, inputs, dialogs, badges, avatars, drawer panels, popovers, and code tags).
- **Perimeter Edge Illumination**: Specular hairlines (`inset 0 1px 0 0 rgba(255,255,255,0.18)`), midnight obsidian surfaces (`#060a12`, `#0b1220`, `#0d1526`), and electric cyan/blue neon focus & hover glows (`#2e9be6`, `#38bdf8`).
- **Physical A4 Document Fidelity**: The live invoice preview (`#previewRef`) preserves a pristine white/ivory document surface with sharp `0px` edges and multi-stage ambient drop shadows (`0 30px 90px -20px rgba(0,0,0,0.85)`). This guarantees 100% pixel-faithful representation on paper printouts, PDF, and DOCX exports without breaking canvas export pipelines.

---

## 2. Complete Fresh-Eye Audit & Gap Analysis

Our fresh-eye audit revealed legacy styles across 11 files that must be systematically refactored:

| File | Legacy Rounded/Border Artifacts Identified | Planned 0px Luxury Replacement |
|---|---|---|
| `components/ui/button.tsx` | `rounded-lg`, `rounded-[min(var(--radius-md),10px)]`, `rounded-[min(var(--radius-md),12px)]`, `rounded-full` | `rounded-none`, sharp hairline highlights `shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]`, cyan glow hover |
| `components/workspace-header.tsx` | Round back-button icon (`rounded-full`), mobile dropdown menu (`rounded-xl`) | Squared icon container `size-8 rounded-none border border-white/12`, squared dropdown `rounded-none border border-white/15 bg-[#0b1220]` |
| `app/globals.css` | `.field` (`rounded-lg`), `.surface` (`rounded-2xl`), `.surface-soft` (`rounded-xl`), `.notice-*` (`rounded-lg`), `--radius*` variables | All `0px` / `rounded-none`, sharp focus ring `outline: 2px solid var(--ring); outline-offset: 2px` |
| `app/page.tsx` | Status pill (`rounded-full`), mobile steps (`rounded-full`), draft badge (`rounded-full`), saved item cards (`rounded-2xl`), line cards (`rounded-xl`), modal dialogs (`rounded-2xl`, `rounded-xl`, round warning icons) | Squared technical badges (`rounded-none font-mono text-[11px]`), squared step tabs, squared dialogs with cyan perimeter glow |
| `app/invoices/page.tsx` | Draft badge (`rounded-full`), payment select (`rounded-lg`), error/empty states (`rounded-2xl`, `rounded-xl`), action buttons (`rounded-lg`) | Monospace status tags with colored borders, sharp empty state frames, squared action button groups |

---

## 3. Mathematical Specifications & Token Architecture

### 3.1 CSS Theme Variables (`app/globals.css`)
```css
@theme {
  --color-brand-blue: #2e9be6;
  --color-brand-blue-hover: #268bd0;
  --color-brand-cyan: #38bdf8;
  --color-brand-emerald: #22b14c;
  --color-ink: #060a12;
  --color-panel: #0a1120;
  --color-surface-elevated: #0f192e;
}

:root {
  color-scheme: dark;
  --background: #060a12;
  --foreground: #f2f6fc;
  --card: #0b1220;
  --card-foreground: #f2f6fc;
  --popover: #0d1526;
  --popover-foreground: #f2f6fc;
  --primary: #2e9be6;
  --primary-foreground: #ffffff;
  --secondary: #121c30;
  --secondary-foreground: #e6edf7;
  --muted: #0d1526;
  --muted-foreground: #8b98ac;
  --accent: #14213a;
  --accent-foreground: #e6edf7;
  --destructive: #f43f5e;
  --border: rgb(255 255 255 / 0.09);
  --input: rgb(255 255 255 / 0.12);
  --ring: #2e9be6;

  /* Absolute 0px Radius Architecture */
  --radius: 0px;
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-xl: 0px;
  --radius-2xl: 0px;
  --radius-3xl: 0px;
  --radius-4xl: 0px;
}
```

### 3.2 Component Utility Classes Specification
1. **`.surface`**:
   - `rounded-none border border-white/[0.08] bg-[#0b1220] shadow-[0_8px_30px_rgb(0_0_0/0.4)]`
   - Inset hairline: `shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]`
2. **`.surface-soft`**:
   - `rounded-none border border-white/10 bg-white/[0.03]`
3. **`.field`**:
   - `min-h-10 w-full rounded-none border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500`
   - Focus: `focus:border-[#2e9be6] focus:bg-white/[0.07] focus:ring-1 focus:ring-[#2e9be6] focus:shadow-[0_0_15px_-2px_rgba(46,155,230,0.35)]`
4. **`.glass-header`**:
   - `border-b border-white/10 bg-[#070c18]/85 backdrop-blur-xl`

---

## 4. Phased Execution Specification

### Phase 1: Foundation, Tokens & Base Primitives
- **Files**: `app/globals.css`, `components/ui/button.tsx`, `components/brand-logo.tsx`, `components/sign-out-button.tsx`, `components/workspace-header.tsx`.
- **Tasks**:
  1. Update `app/globals.css`:
     - Overwrite CSS variables with 0px radius tokens.
     - Redefine `.surface`, `.surface-soft`, `.field`, `.glass-header`, `.notice-success`, `.notice-error`, and `.notice-info` with strict `rounded-none`.
  2. Refactor `components/ui/button.tsx`:
     - Remove all `rounded-lg`, `rounded-md`, `rounded-[...]`, replace with `rounded-none`.
     - Add subtle active press translate (`active:not-aria-[haspopup]:translate-y-[1px]`).
     - Default variant: `bg-[#2e9be6] text-white border border-[#2e9be6] font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_0_16px_-3px_rgba(46,155,230,0.45)] hover:bg-[#268bd0] hover:shadow-[0_0_24px_-2px_rgba(46,155,230,0.6)]`.
     - Outline variant: `border border-white/15 bg-white/[0.04] text-slate-200 hover:border-[#2e9be6]/60 hover:bg-white/[0.08] hover:text-white hover:shadow-[0_0_12px_-3px_rgba(46,155,230,0.3)]`.
  3. Refactor `components/workspace-header.tsx`:
     - Replace circular back button with `size-8 rounded-none border border-white/12 bg-white/[0.04] text-slate-300 hover:border-[#2e9be6]/50 hover:text-white`.
     - Replace round mobile menu dropdown with `rounded-none border border-white/15 bg-[#0b1220] shadow-2xl`.

### Phase 2: Main Invoice Generator & Workspace (`app/page.tsx`)
- **Files**: `app/page.tsx`.
- **Tasks**:
  1. Status & Session Header: Replace `rounded-full` badge with `rounded-none border border-white/12 bg-white/[0.04] font-mono text-xs px-2.5 py-1`. Status indicator: square `size-1.5 rounded-none bg-emerald-400 shadow-[0_0_8px_#34d399]`.
  2. Mobile Step Navigation: Square step buttons (`rounded-none border border-white/10 px-3 py-2 text-xs`), active tab highlighted with cyan border and glow.
  3. Section & Form Cards: Eliminate any lingering rounded corners on form wrappers and line item cards (`rounded-none border border-white/10 bg-white/[0.03]`).
  4. Dialogs & Drawers:
     - `NoteSaveDialog`: Squared modal `rounded-none border border-white/15 bg-[#0b1220] shadow-2xl`.
     - `FinalizeConfirmDialog`: Squared warning modal with square alert icon frame.

### Phase 3: Invoice History & Trash Workspace
- **Files**: `app/invoices/page.tsx`, `app/invoices/trash/page.tsx`.
- **Tasks**:
  1. Filter Bar & Clear Button: Squared inputs, `.field` styling, sharp "Clear filters" chip.
  2. Table Rows & Status Badges:
     - Replace round `rounded-full` draft badges with squared font-mono badges (`rounded-none border px-2 py-0.5 text-[11px] font-mono`).
     - Payment status selector: Squared `.field` select or custom technical badge.
  3. Action Triggers: Replace `rounded-lg` on inline action buttons (Edit, PDF, DOCX, Revise, Trash, Restore) with sharp zero-radius controls (`rounded-none hover:bg-white/[0.06] hover:text-white`).
  4. Empty States & Error Alerts: Convert dashed empty containers and alert banners to `rounded-none border border-white/10 bg-white/[0.02]` with crisp typography.

### Phase 4: Customer Directory & Seller Profile Settings
- **Files**: `app/customers/page.tsx`, `app/account/settings/page.tsx`.
- **Tasks**:
  1. Customer Monogram Avatars: Convert `rounded-xl` to sharp geometric monogram `size-10 rounded-none border border-white/15 bg-white/[0.06] font-mono text-sm font-bold`.
  2. Customer Form & Edit States: Squared cards, sharp borders, error notifications in `rounded-none`.
  3. Seller Settings & Logo Upload:
     - Header icon: Squared frame `size-10 rounded-none border border-white/12 bg-white/[0.06]`.
     - Logo dropzone: Squared dashed container `rounded-none border border-dashed border-white/20 bg-white/[0.02] hover:border-[#2e9be6]/60`.
     - File input button: Ensure `file:rounded-none` to eliminate OS default rounded file buttons.

### Phase 5: Authentication & Admin Allowlist
- **Files**: `app/auth/login/page.tsx`, `app/auth/signup/page.tsx`, `app/auth/reset-password/page.tsx`, `app/admin/allowlist/allowlist-manager.tsx`.
- **Tasks**:
  1. Auth Shell: Sharp obsidian surface `surface rounded-none border border-white/12 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8),0_0_30px_-5px_rgba(46,155,230,0.15)]`.
  2. Back navigation: Squared back button `rounded-none border border-white/10`.
  3. Admin Allowlist:
     - Shield icon frame: Squared `size-10 rounded-none border border-white/12`.

---

## 5. Verification Matrix & Edge Case Safeguards

### 5.1 Verification Protocol
1. **Unit Testing**: Run `npm test` (`vitest run tests/unit`) after each phase to ensure zero calculation or schema regressions.
2. **Production Build**: Run `npm run build` to verify Next.js 16 (Turbopack) passes static page generation for all 24 routes.
3. **Automated Rounded Corner Scan**: Run a PowerShell regex search across all TSX files to confirm `0` remaining instances of legacy `rounded-` utilities.
4. **Live Document Export Testing**: Generate and verify PDF and DOCX files for single-page and multi-page invoices to confirm `#previewRef` canvas renders cleanly without clipping, offsets, or missing borders.

### 5.2 Edge Cases Addressed
- **html2canvas Border Safety**: Keeping pure `0px` borders avoids anti-aliasing fuzziness in canvas rendering.
- **Form Autofill Overrides**: Dark mode input autofill background styles handled cleanly in CSS.
- **Mobile Touch Target Safety**: Even with `0px` razor-sharp corners, interactive button heights are strictly preserved at `h-10` (40px) or `h-11` (44px) with ample tap margins.

     - Status badges: Monospace tags `rounded-none font-mono text-[11px]`.
     - Setup aside callout: Squared card with sharp amber hairline border.
     - Code tags: Squared code elements `rounded-none bg-amber-400/15 px-1.5 py-0.5 font-mono text-xs`.

     - `SavedLibraryDrawer` & `ProfileDrawer`: Squared sliding drawer with sharp border `border-l border-white/10 bg-[#0b1220]`.
     - Saved items & notes list cards: Squared containers `rounded-none border border-white/10 bg-white/[0.02]`.
  5. Live A4 Preview Canvas: Keep white/ivory document surface clean and sharp (`rounded-none border border-slate-300 bg-white shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)]`). Ensure zero html2canvas export discrepancies.
  6. Sticky Mobile Action Dock: Squared bar with crisp top border `border-t border-white/12 bg-[#070c18]/90 backdrop-blur-xl`.

5. **`.badge-sharp`**:
   - `inline-flex items-center gap-1.5 rounded-none border px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider`
6. **`.invoice-paper`**:
   - `rounded-none border border-slate-300 bg-white p-6 sm:p-9 text-slate-900 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.05)]`
   - Aspect ratio: `1 / 1.414` (A4 standard)

| `app/invoices/trash/page.tsx` | Error box (`rounded-2xl`), empty state frame (`rounded-2xl border-dashed`), action buttons (`rounded-lg`) | Squared alert containers with hairline borders, squared action triggers |
| `app/customers/page.tsx` | Customer monogram avatar (`rounded-xl`), error alert (`rounded-lg`), edit/delete action triggers (`rounded-lg`) | Squared geometric monogram `rounded-none border border-white/15 font-mono`, squared action triggers |
| `app/account/settings/page.tsx` | Business icon wrapper (`rounded-xl`), logo upload frame (`rounded-xl border-dashed`), file picker trigger (`file:rounded-lg`) | Squared icon frame, sharp dashed upload area with hover glow, squared file input button |
| `app/admin/allowlist/allowlist-manager.tsx` | Shield icon (`rounded-xl`), status badges (`rounded-full`), worker code tags (`code.rounded`), setup aside box (`rounded-2xl`) | Squared shield frame, squared monospace status badges, squared code tags, squared callout card |
| `app/auth/login/page.tsx` & `signup/` & `reset-password/` | Background ambient blob (`rounded-full`), legacy input corners | Obsidian backdrop with radial blur, razor-sharp auth cards with cyan edge lighting |
| Invoice Canvas (`#previewRef`) | Minor border artifacts (`rounded-sm` inside preview wrapper) | Pure sharp `0px` boundary, clean white sheet, zero export engine regressions |
