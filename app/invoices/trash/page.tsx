"use client"


import { useEffect, useState } from "react"
import { RotateCcw, Trash2 } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"


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

  return <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
    <WorkspaceHeader backHref="/invoices" showTrash={false} />

    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Trash</h1>
        <p className="mt-2 text-sm text-slate-500">Deleted invoices stay here until you restore or permanently delete them.</p>
      </div>

      {loading && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading Trash…</div>}
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700"><p>{error}</p><button className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-300 bg-white px-3 font-medium text-rose-700" type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1) }}>Try again</button></div>}
      {!loading && !error && invoices.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Trash2 className="mx-auto text-slate-400" /><h2 className="mt-4 font-semibold">Trash is empty</h2><p className="mt-2 text-sm text-slate-500">Invoices you move here will appear in this view.</p></div>}
      {!loading && !error && invoices.length > 0 && <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="hidden grid-cols-[1fr_1.4fr_140px_120px_230px] gap-4 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span className="text-right">Total</span><span className="text-right">Actions</span></div>
        {invoices.map((invoice) => <div key={invoice.id} className="grid gap-3 border-t border-slate-100 px-5 py-4 first:border-t-0 md:grid-cols-[1fr_1.4fr_140px_120px_230px] md:items-center md:gap-4">
          <div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-slate-500 md:hidden">{date(invoice.issue_date)}</p></div>
          <div><p className="text-sm">{invoice.customer_snapshot?.companyName || "Customer company"}</p><p className="text-xs text-slate-500">{invoice.customer_snapshot?.name || "Customer name"}</p></div>
          <p className="hidden text-sm text-slate-600 md:block">{date(invoice.issue_date)}</p>
          <p className="text-right text-sm font-semibold">{money(invoice.total_amount)}</p>
          <div className="flex flex-wrap justify-end gap-3"><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 underline-offset-4 hover:bg-slate-50 hover:underline" type="button" disabled={busyId === invoice.id} onClick={() => void action(invoice, "restore")}><RotateCcw size={13} />Restore</button><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 underline-offset-4 hover:bg-rose-50 hover:underline" type="button" disabled={busyId === invoice.id} onClick={() => void action(invoice, "permanently_delete")}><Trash2 size={13} />Delete permanently</button></div>
        </div>)}
      </div>}
    </div>
  </main>
}
