"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, FileText, Plus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"

type InvoiceRecord = {
  id: string
  invoice_number: string | null
  lifecycle_status: "draft" | "finalized" | "trashed"
  issue_date: string
  due_date: string
  payment_status: "unpaid" | "paid" | "overdue"
  total_amount: number
  customer_snapshot: { companyName?: string; name?: string }
}

const money = (value: number) => `৳${new Intl.NumberFormat("en-US").format(value)}`
const date = (value: string) => {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

export default function InvoiceHistoryPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    fetch("/api/invoices").then(async (response) => {
      const result = await response.json() as { invoices?: InvoiceRecord[]; error?: string }
      if (!active) return
      if (!response.ok) setError(result.error ?? "Invoice history could not be loaded.")
      else setInvoices(result.invoices ?? [])
      setLoading(false)
    }).catch(() => {
      if (active) {
        setError("Invoice history could not be loaded.")
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [])

  return <main className="min-h-screen bg-[#f7f8fa] text-slate-950"><header className="border-b border-slate-200/80 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6"><Link className="flex items-center gap-2 text-sm font-semibold" href="/"><ArrowLeft size={16} />Invoice Studio</Link><Link className={buttonVariants()} href="/"><Plus data-icon="inline-start" />New invoice</Link></div></header><div className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Invoice history</h1><p className="mt-2 text-sm text-slate-500">Your saved drafts and finalized invoices, newest first.</p></div>{loading && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading invoice history…</div>}{error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>}{!loading && !error && invoices.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><FileText className="mx-auto text-slate-400" /><h2 className="mt-4 font-semibold">No saved invoices yet</h2><p className="mt-2 text-sm text-slate-500">Create your first invoice to start your history.</p><Link className={`${buttonVariants()} mt-5`} href="/"><Plus data-icon="inline-start" />Create invoice</Link></div>}{!loading && !error && invoices.length > 0 && <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="hidden grid-cols-[1fr_1.4fr_150px_150px_130px] gap-4 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span>Status</span><span className="text-right">Total</span></div>{invoices.map((invoice) => <div key={invoice.id} className="grid gap-3 border-t border-slate-100 px-5 py-4 first:border-t-0 md:grid-cols-[1fr_1.4fr_150px_150px_130px] md:items-center md:gap-4"><div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-slate-500 md:hidden">{date(invoice.issue_date)}</p></div><div><p className="text-sm">{invoice.customer_snapshot?.companyName || "Customer company"}</p><p className="text-xs text-slate-500">{invoice.customer_snapshot?.name || "Customer name"}</p></div><p className="hidden text-sm text-slate-600 md:block">{date(invoice.issue_date)}</p><div><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">{invoice.lifecycle_status === "draft" ? "Draft" : invoice.payment_status}</span></div><p className="text-right text-sm font-semibold">{money(invoice.total_amount)}</p></div>)}</div>}</div></main>
}
