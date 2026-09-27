"use client"


import Link from "next/link"
import { useEffect, useState } from "react"
import { LockKeyhole, RotateCcw, Trash2 } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { buttonVariants } from "@/components/ui/button"
import { resolveBillToParty, calculateSettlement, formatMoney } from "@/lib/invoice/types"
import { useConfirm } from "@/components/confirm-dialog"
import { RowActions, type RowAction } from "@/components/row-actions"


type TrashedInvoice = {
  id: string
  invoice_number: string | null
  issue_date: string
  payment_status: "unpaid" | "partial" | "paid" | "overdue"
  total_amount: number
  amount_paid?: number | null
  customer_snapshot: { companyName?: string; name?: string }
}

const date = (value: string) => {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

// Names the invoice a destructive prompt refers to, and surfaces any recorded
// payments so the seller knows money is about to be erased with it.
function TrashSummary({ invoice }: { invoice: TrashedInvoice }) {
  const settlement = calculateSettlement(invoice.total_amount, invoice.amount_paid)
  return <div className="space-y-1">
    <div className="flex justify-between gap-4"><span>Invoice</span><span className="font-medium text-foreground">{invoice.invoice_number ?? "Draft"}</span></div>
    <div className="flex justify-between gap-4"><span>Customer</span><span className="font-medium text-foreground">{resolveBillToParty(invoice.customer_snapshot, { heading: "Customer", contact: "" }).heading}</span></div>
    <div className="flex justify-between gap-4"><span>Total</span><span className="font-medium text-foreground">{formatMoney(settlement.total)}</span></div>
    {settlement.paid > 0 && <p className="border-t border-border pt-1 text-destructive">{formatMoney(settlement.paid)} of recorded payments will be deleted too.</p>}
  </div>
}

function trashRowActions(
  invoice: TrashedInvoice,
  busy: boolean,
  action: (target: TrashedInvoice, action: "restore" | "permanently_delete") => void
): RowAction[] {
  // There is deliberately no "Open" control here: the detail endpoint answers
  // 409 "Trashed invoices cannot be opened in the editor", so such a link would
  // only ever lead to an error page.
  return [
    { icon: RotateCcw, label: "Restore", onSelect: () => action(invoice, "restore"), primary: true, disabled: busy },
    { destructive: true, icon: Trash2, label: "Delete permanently", onSelect: () => action(invoice, "permanently_delete"), disabled: busy },
  ]
}

export default function InvoiceTrashPage() {
  const [invoices, setInvoices] = useState<TrashedInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const { confirm, dialog: confirmDialog } = useConfirm()

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/invoices?view=trash", { signal: controller.signal }).then(async (response) => {
      const result = await response.json() as { invoices?: TrashedInvoice[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Trash could not be loaded.")
      setInvoices(result.invoices ?? [])
      setLoading(false)
    }).catch((requestError: unknown) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return
      setError(requestError instanceof Error ? requestError.message : "Trash could not be loaded.")
      setLoading(false)
    })
    return () => controller.abort()
  }, [retry])

  const action = async (invoice: TrashedInvoice, type: "restore" | "permanently_delete") => {
    const label = invoice.invoice_number ? `invoice ${invoice.invoice_number}` : "this draft"
    const accepted = type === "restore"
      ? await confirm({
          title: "Restore to history?",
          description: "The invoice returns to your history and can be edited and settled again.",
          confirmLabel: "Restore",
          body: <TrashSummary invoice={invoice} />,
        })
      : await confirm({
          title: `Delete ${label} permanently?`,
          description: "This cannot be undone. The invoice, its line items and any recorded payments are erased, and the number is never reused.",
          confirmLabel: "Delete permanently",
          destructive: true,
          body: <TrashSummary invoice={invoice} />,
        })
    if (!accepted) return

    setBusyId(invoice.id)
    setError("")
    try {
      const response = await fetch("/api/invoices/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: type, invoiceId: invoice.id }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Trash action could not be completed.")
      setRetry((value) => value + 1)
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Trash action could not be completed.")
    } finally {
      setBusyId(null)
    }
  }

  const requiresAuthentication = error.toLowerCase().includes("authentication") || error.toLowerCase().includes("sign in")

  return <main className="min-h-screen bg-transparent text-foreground">
    <WorkspaceHeader backHref="/invoices" active="trash" showTrash={false} />

    <div className="workspace-page">
      <WorkspacePageHeader
        eyebrow="Workspace"
        title="Trash"
        description="Restore deleted invoices or permanently remove records that are no longer needed."
      />

      {loading && <div className="surface p-8 text-sm text-muted-foreground">Loading Trash⬦</div>}
      {!loading && requiresAuthentication && <div className="surface flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-primary"><LockKeyhole size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Trash is part of your private workspace</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Sign in to review deleted invoices, restore records, or permanently remove their data.</p><Link className={`${buttonVariants()} mt-6`} href="/auth/login">Sign in to continue</Link></div>}
      {error && !requiresAuthentication && <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-5 text-sm text-destructive"><p>{error}</p><button className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-400/40 bg-card px-3 font-medium text-destructive hover:border-rose-400" type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1) }}>Try again</button></div>}
      {!loading && !error && invoices.length === 0 && <div className="surface flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"><Trash2 size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Trash is empty</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Invoices you move here will appear in this view until they are restored or permanently deleted.</p><Link className={`${buttonVariants({ variant: "outline" })} mt-6`} href="/invoices">Back to invoice history</Link></div>}
      {!loading && !error && invoices.length > 0 && <div className="overflow-hidden surface">
        <div className="data-table-header hidden grid-cols-[minmax(110px,0.8fr)_minmax(160px,1.2fr)_112px_104px_150px] gap-4 px-5 py-3 lg:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span className="text-right">Total</span><span className="text-right">Actions</span></div>
        {invoices.map((invoice) => <div key={invoice.id} className="grid gap-3 border-t border-border/60 px-5 py-4 transition-colors first:border-t-0 hover:bg-muted/25 lg:grid-cols-[minmax(110px,0.8fr)_minmax(160px,1.2fr)_112px_104px_150px] lg:items-center lg:gap-4">
          <div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-muted-foreground lg:hidden">{date(invoice.issue_date)}</p></div>
          <div><p className="text-sm">{resolveBillToParty(invoice.customer_snapshot, { heading: "Customer name", contact: "" }).heading}</p>{invoice.customer_snapshot?.companyName && invoice.customer_snapshot?.name && <p className="text-xs text-muted-foreground">{invoice.customer_snapshot.name}</p>}</div>
          <p className="hidden text-sm text-muted-foreground lg:block">{date(invoice.issue_date)}</p>
          <div className="text-right"><p className="text-sm font-semibold">{formatMoney(invoice.total_amount)}</p>{(() => { const balance = calculateSettlement(invoice.total_amount, invoice.amount_paid).balance; if (invoice.amount_paid === 0) return null; return <p className="text-xs text-muted-foreground">{balance < 0 ? `${formatMoney(-balance)} credit` : `${formatMoney(balance)} left`}</p>; })()}</div>
          <RowActions actions={trashRowActions(invoice, busyId === invoice.id, action)} label={invoice.invoice_number ?? "draft"} />
        </div>)}
      </div>}
    </div>

    {confirmDialog}
  </main>
}
