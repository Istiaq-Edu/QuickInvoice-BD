"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, FileText, Plus, RotateCcw, Search, SlidersHorizontal } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
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

type Filters = {
  q: string
  paymentStatus: "all" | "unpaid" | "paid" | "overdue"
  sort: "newest" | "oldest" | "amount_high" | "amount_low" | "due_soon" | "due_late" | "number_asc" | "number_desc"
  issueFrom: string
  issueTo: string
  dueFrom: string
  dueTo: string
  minTotal: string
  maxTotal: string
}

const defaultFilters: Filters = {
  q: "",
  paymentStatus: "all",
  sort: "newest",
  issueFrom: "",
  issueTo: "",
  dueFrom: "",
  dueTo: "",
  minTotal: "",
  maxTotal: "",
}

const money = (value: number) => `৳${new Intl.NumberFormat("en-US").format(Number(value) || 0)}`
const date = (value: string) => {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

export default function InvoiceHistoryPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value && !(key === "paymentStatus" && value === "all") && !(key === "sort" && value === "newest")) params.set(key, value)
    })
    return params.toString()
  }, [filters])

  useEffect(() => {
    const controller = new AbortController()

    fetch(`/api/invoices${queryString ? `?${queryString}` : ""}`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json() as { invoices?: InvoiceRecord[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Invoice history could not be loaded.")
      setInvoices(result.invoices ?? [])
      setLoading(false)
    }).catch((requestError: unknown) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return
      setError(requestError instanceof Error ? requestError.message : "Invoice history could not be loaded.")
      setLoading(false)
    })

    return () => controller.abort()
  }, [queryString, retry])

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setLoading(true)
    setError("")
    setFilters((current) => ({ ...current, [key]: value }))
  }
  const resetFilters = () => {
    setLoading(true)
    setError("")
    setFilters(defaultFilters)
  }
  const hasFilters = queryString.length > 0

  return <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
    <header className="border-b border-slate-200/80 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link className="flex items-center gap-2 text-sm font-semibold" href="/"><ArrowLeft size={16} /><BrandLogo /></Link>
        <Link className={buttonVariants()} href="/"><Plus data-icon="inline-start" />New invoice</Link>
      </div>
    </header>

    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Invoice history</h1>
          <p className="mt-2 text-sm text-slate-500">Search, filter, and sort your saved drafts and finalized invoices.</p>
        </div>
        {hasFilters && <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50" type="button" onClick={resetFilters}><RotateCcw size={15} />Clear filters</button>}
      </div>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Invoice history filters">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={16} />Find an invoice</div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_180px_220px]">
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Search</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className="field pl-9" placeholder="Invoice number or customer" value={filters.q} onChange={(event) => updateFilter("q", event.target.value)} /></span></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Payment status</span><select className="field" value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value as Filters["paymentStatus"])}><option value="all">All statuses</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Sort by</span><select className="field" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value as Filters["sort"])}><option value="newest">Newest issue date</option><option value="oldest">Oldest issue date</option><option value="amount_high">Highest amount</option><option value="amount_low">Lowest amount</option><option value="due_soon">Nearest due date</option><option value="due_late">Latest due date</option><option value="number_asc">Invoice number A–Z</option><option value="number_desc">Invoice number Z–A</option></select></label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Issue date from</span><input className="field" type="date" value={filters.issueFrom} onChange={(event) => updateFilter("issueFrom", event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Issue date to</span><input className="field" type="date" value={filters.issueTo} onChange={(event) => updateFilter("issueTo", event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Due date from</span><input className="field" type="date" value={filters.dueFrom} onChange={(event) => updateFilter("dueFrom", event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Due date to</span><input className="field" type="date" value={filters.dueTo} onChange={(event) => updateFilter("dueTo", event.target.value)} /></label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:max-w-md">
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Minimum total</span><input className="field" type="number" min={0} step={1} placeholder="৳0" value={filters.minTotal} onChange={(event) => updateFilter("minTotal", event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Maximum total</span><input className="field" type="number" min={0} step={1} placeholder="No limit" value={filters.maxTotal} onChange={(event) => updateFilter("maxTotal", event.target.value)} /></label>
        </div>
      </section>

      {loading && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading invoice history…</div>}
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700"><p>{error}</p><button className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-300 bg-white px-3 font-medium text-rose-700" type="button" onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1) }}>Try again</button></div>}
      {!loading && !error && invoices.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><FileText className="mx-auto text-slate-400" /><h2 className="mt-4 font-semibold">{hasFilters ? "No invoices match these filters" : "No saved invoices yet"}</h2><p className="mt-2 text-sm text-slate-500">{hasFilters ? "Try broadening your search or clearing one of the filters." : "Create your first invoice to start your history."}</p>{hasFilters ? <button className="mt-5 inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium shadow-sm" type="button" onClick={resetFilters}>Clear filters</button> : <Link className={`${buttonVariants()} mt-5`} href="/"><Plus data-icon="inline-start" />Create invoice</Link>}</div>}
      {!loading && !error && invoices.length > 0 && <>
        <p className="mb-3 text-xs text-slate-500">{invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}</p>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[1fr_1.4fr_150px_150px_130px] gap-4 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span>Status</span><span className="text-right">Total</span></div>
          {invoices.map((invoice) => <div key={invoice.id} className="grid gap-3 border-t border-slate-100 px-5 py-4 first:border-t-0 md:grid-cols-[1fr_1.4fr_150px_150px_130px] md:items-center md:gap-4"><div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-slate-500 md:hidden">{date(invoice.issue_date)}</p></div><div><p className="text-sm">{invoice.customer_snapshot?.companyName || "Customer company"}</p><p className="text-xs text-slate-500">{invoice.customer_snapshot?.name || "Customer name"}</p></div><p className="hidden text-sm text-slate-600 md:block">{date(invoice.issue_date)}</p><div><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">{invoice.lifecycle_status === "draft" ? "Draft" : invoice.payment_status}</span></div><p className="text-right text-sm font-semibold">{money(invoice.total_amount)}</p></div>)}
        </div>
      </>}
    </div>
  </main>
}
