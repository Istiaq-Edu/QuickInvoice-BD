"use client"


import Link from "next/link"
import { useEffect, useState } from "react"
import { LockKeyhole, RotateCcw, Trash2 } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { buttonVariants } from "@/components/ui/button"


type TrashedInvoice = {
  id: string
  invoice_number: string | null
  issue_date: string
  payment_status: "unpaid" | "paid" | "overdue"
  total_amount: number
  customer_snapshot: { companyName?: string; name?: string }
}

const money = (value: number) => `৳${new Intl.NumberFormat("en-US").format(Number(value) || 0)}`
const date = (value: string) => {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

export default function InvoiceTrashPage() {
  const [invoices, setInvoices] = useState<TrashedInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

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
    const confirmation = type === "restore"
      ? "Restore this invoice to history?"
      : "Permanently delete this invoice? This cannot be undone, and its invoice number will never be reused."
    if (!window.confirm(confirmation)) return

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

      {loading && <div className="surface p-8 text-sm text-muted-foreground">Loading Trash…</div>}
      {!loading && requiresAuthentication && <div className="surface flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-primary"><LockKeyhole size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Trash is part of your private workspace</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Sign in to review deleted invoices, restore records, or permanently remove their data.</p><Link className={`${buttonVariants()} mt-6`} href="/auth/login">Sign in to continue</Link></div>}
      {error && !requiresAuthentication && <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-5 text-sm text-destructive"><p>{error}</p><button className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-400/40 bg-card px-3 font-medium text-destructive hover:border-rose-400" type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1) }}>Try again</button></div>}
      {!loading && !error && invoices.length === 0 && <div className="surface flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"><Trash2 size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Trash is empty</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Invoices you move here will appear in this view until they are restored or permanently deleted.</p><Link className={`${buttonVariants({ variant: "outline" })} mt-6`} href="/invoices">Back to invoice history</Link></div>}
      {!loading && !error && invoices.length > 0 && <div className="overflow-hidden surface">
        <div className="data-table-header hidden grid-cols-[minmax(120px,0.8fr)_minmax(180px,1.2fr)_120px_110px_220px] gap-4 px-5 py-3 lg:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span className="text-right">Total</span><span className="text-right">Actions</span></div>
        {invoices.map((invoice) => <div key={invoice.id} className="grid gap-3 border-t border-border/60 px-5 py-4 transition-colors first:border-t-0 hover:bg-muted/25 lg:grid-cols-[minmax(120px,0.8fr)_minmax(180px,1.2fr)_120px_110px_220px] lg:items-center lg:gap-4">
          <div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-muted-foreground lg:hidden">{date(invoice.issue_date)}</p></div>
          <div><p className="text-sm">{invoice.customer_snapshot?.companyName || "Customer company"}</p><p className="text-xs text-muted-foreground">{invoice.customer_snapshot?.name || "Customer name"}</p></div>
          <p className="hidden text-sm text-muted-foreground lg:block">{date(invoice.issue_date)}</p>
          <p className="text-right text-sm font-semibold">{money(invoice.total_amount)}</p>
          <div className="flex flex-wrap justify-end gap-3"><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-foreground/80 underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline" type="button" disabled={busyId === invoice.id} onClick={() => void action(invoice, "restore")}><RotateCcw size={13} />Restore</button><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-destructive underline-offset-4 hover:bg-rose-500/10 hover:underline" type="button" disabled={busyId === invoice.id} onClick={() => void action(invoice, "permanently_delete")}><Trash2 size={13} />Delete permanently</button></div>
        </div>)}
      </div>}
    </div>
  </main>
}
