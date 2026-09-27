"use client"

import { useState } from "react"
import { CircleCheck, ClockAlert, FileDown, FilePen, FilePlus2, Trash2, Wallet } from "lucide-react"

import { RowActions, type RowAction } from "@/components/row-actions"
import { SettlementCell } from "@/components/invoice-settlement"
import { WorkspacePageHeader } from "@/components/workspace-page-header"

/**
 * Test fixture, not a feature.
 *
 * The invoice history that actually uses RowActions sits behind authentication, so
 * the only way to exercise the overflow menu in Playwright is to render the
 * component somewhere reachable. This mirrors the real finalized call site: Edit
 * lives in the menu rather than on the row, and a second row is pinned to the
 * busy state.
 *
 * It renders nothing in a production build so it cannot be mistaken for a page.
 * Delete this file and the "row actions menu" test together if the coverage is
 * ever considered not worth keeping.
 */
export default function RowActionsTestFixture() {
  const [log, setLog] = useState<string[]>([])

  const actions: RowAction[] = [
    { href: "/?draft=abc", icon: FilePen, label: "Edit" },
    { icon: CircleCheck, label: "Mark paid", onSelect: () => setLog((l) => [...l, "mark-paid"]) },
    { icon: FilePlus2, label: "Re-raise ৳1,000", onSelect: () => setLog((l) => [...l, "re-raise"]) },
    { icon: ClockAlert, label: "Mark as overdue", onSelect: () => setLog((l) => [...l, "overdue"]) },
    { href: "/?draft=abc&download=PDF", icon: FileDown, label: "Download PDF", target: "_blank" },
    { destructive: true, icon: Trash2, label: "Move to Trash", onSelect: () => setLog((l) => [...l, "trash"]) },
  ]

  if (process.env.NODE_ENV === "production") return null

  return <div className="p-10">
    <WorkspacePageHeader compact description="This description must not render in compact mode." eyebrow="Workspace" title="Compact header" />
    <WorkspacePageHeader description="This description must render in the default mode." eyebrow="Workspace" title="Default header" />

    <h2 className="mb-3 font-heading text-lg">Settlement states</h2>
    {/* A real table, because <span> directly inside <tr> is invalid nesting and
        React reports it as a hydration mismatch, which floods the E2E output with
        errors that look like application bugs. */}
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="data-table-header border-b border-border/80 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scenario</th>
          <th className="data-table-header border-b border-border/80 px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance cell</th>
        </tr>
      </thead>
      <tbody>
        {[
          ["Unpaid — ৳2,000, nothing received", { amountPaid: 0, isDraft: false, total: 2000 }],
          ["Part paid — ৳800 of ৳2,000 received", { amountPaid: 800, isDraft: false, total: 2000 }],
          ["Paid in full — ৳2,000 received", { amountPaid: 2000, isDraft: false, total: 2000 }],
          ["Overpaid — ৳2,500 received", { amountPaid: 2500, isDraft: false, total: 2000 }],
          ["Draft", { amountPaid: 0, isDraft: true, total: 2000 }],
        ].map(([label, props]) => (
          <tr className="border-b border-border/60" key={String(label)}>
            <td className="px-5 py-4 text-sm">{label as string}</td>
            <td className="px-5 py-4"><SettlementCell {...(props as { amountPaid: number; isDraft: boolean; total: number })} /></td>
          </tr>
        ))}
      </tbody>
    </table>

    <div id="row-idle">
      <RowActions actions={actions} label="INV-0001" />
      {/* Record payment lives in the Status column, not here. */}
      <button className="mt-4" id="record-payment" onClick={() => setLog((l) => [...l, "record-payment"])} type="button">
        <Wallet size={12} />Record payment
      </button>
    </div>
    <ul id="log">{log.map((entry) => <li key={entry}>{entry}</li>)}</ul>
    <div id="row-busy"><RowActions actions={actions.map((a) => ({ ...a, disabled: true }))} label="INV-BUSY" /></div>
  </div>
}
