"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FileDown, FileText, LockKeyhole, Plus, RotateCcw, Search, SlidersHorizontal } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
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

type Action = "revise" | "payment_status" | "trash"

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
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
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
    const timer = window.setTimeout(() => {
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
    }, filters.q ? 300 : 0)

    return () => { window.clearTimeout(timer); controller.abort() }
  }, [filters.q, queryString, retry])

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
  const performAction = async (invoice: InvoiceRecord, action: Action, paymentStatus?: InvoiceRecord["payment_status"]) => {
    if (action === "revise" && !window.confirm("Create a new draft from this finalized invoice? The original invoice will stay unchanged.")) return
    if (action === "trash" && !window.confirm("Move this invoice to Trash? You can restore it later.")) return

    setBusyId(invoice.id)
    setActionError("")
    try {
      const response = await fetch("/api/invoices/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, invoiceId: invoice.id, paymentStatus }),
      })
      const result = await response.json() as { id?: string; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Invoice action could not be completed.")
      if (action === "revise" && result.id) {
        router.push(`/?draft=${encodeURIComponent(result.id)}`)
        return
      }
      setRetry((value) => value + 1)
    } catch (requestError: unknown) {
      setActionError(requestError instanceof Error ? requestError.message : "Invoice action could not be completed.")
    } finally {
      setBusyId(null)
    }
  }
  const hasFilters = queryString.length > 0
  const hasAdvancedFilters = [filters.issueFrom, filters.issueTo, filters.dueFrom, filters.dueTo, filters.minTotal, filters.maxTotal].some(Boolean)
  const requiresAuthentication = error.toLowerCase().includes("authentication") || error.toLowerCase().includes("sign in")

  return <main className="min-h-screen bg-transparent text-foreground">
    <WorkspaceHeader backHref="/" active="invoices" />

    <div className="workspace-page">
      <WorkspacePageHeader
        eyebrow="Workspace"
        title="Invoice history"
        description="A reliable record of every draft, finalized invoice, and payment state."
        actions={hasFilters ? <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground/80 shadow-sm transition hover:border-primary/35 hover:bg-muted" type="button" onClick={resetFilters}><RotateCcw size={15} />Clear filters</button> : undefined}
      />

      {!requiresAuthentication && <section className="mb-6 surface p-4 sm:p-5" aria-label="Invoice history filters">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="text-primary" size={16} />Find an invoice</div>
          <button aria-expanded={showAdvanced} className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground" type="button" onClick={() => setShowAdvanced((current) => !current)}>
            {showAdvanced ? "Hide advanced" : "More filters"}{hasAdvancedFilters ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </button>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_180px_220px]">
          <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Search</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input className="field pl-9" placeholder="Invoice number or customer" value={filters.q} onChange={(event) => updateFilter("q", event.target.value)} /></span></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Payment status</span><select className="field" value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value as Filters["paymentStatus"])}><option value="all">All statuses</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></label>
          <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Sort by</span><select className="field" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value as Filters["sort"])}><option value="newest">Newest issue date</option><option value="oldest">Oldest issue date</option><option value="amount_high">Highest amount</option><option value="amount_low">Lowest amount</option><option value="due_soon">Nearest due date</option><option value="due_late">Latest due date</option><option value="number_asc">Invoice number A–Z</option><option value="number_desc">Invoice number Z–A</option></select></label>
        </div>
        {showAdvanced && <div className="mt-5 border-t border-border/80 pt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Issue date from</span><input className="field" type="date" value={filters.issueFrom} onChange={(event) => updateFilter("issueFrom", event.target.value)} /></label>
            <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Issue date to</span><input className="field" type="date" value={filters.issueTo} onChange={(event) => updateFilter("issueTo", event.target.value)} /></label>
            <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Due date from</span><input className="field" type="date" value={filters.dueFrom} onChange={(event) => updateFilter("dueFrom", event.target.value)} /></label>
            <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Due date to</span><input className="field" type="date" value={filters.dueTo} onChange={(event) => updateFilter("dueTo", event.target.value)} /></label>
          </div>
          <div className="mt-4 grid max-w-md gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Minimum total</span><input className="field" type="number" min={0} step={1} placeholder="৳0" value={filters.minTotal} onChange={(event) => updateFilter("minTotal", event.target.value)} /></label>
            <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Maximum total</span><input className="field" type="number" min={0} step={1} placeholder="No limit" value={filters.maxTotal} onChange={(event) => updateFilter("maxTotal", event.target.value)} /></label>
          </div>
        </div>}
      </section>}

      {loading && <div className="surface p-8 text-sm text-muted-foreground">Loading invoice history…</div>}
      {error && !requiresAuthentication && <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-5 text-sm text-destructive"><p>{error}</p><button className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-400/40 bg-card px-3 font-medium text-destructive hover:border-rose-400" type="button" onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1) }}>Try again</button></div>}
      {!loading && requiresAuthentication && <div className="surface flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-primary"><LockKeyhole size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Your invoice history is private</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Sign in to view saved drafts, update payment status, download finalized invoices, and keep every revision in one place.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link className={buttonVariants()} href="/auth/login">Sign in to continue</Link><Link className={buttonVariants({ variant: "outline" })} href="/">Create a guest invoice</Link></div></div>}
      {actionError && <div className="mb-5 rounded-lg border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-destructive" role="alert">{actionError}</div>}
      {!loading && !error && invoices.length === 0 && <div className="surface flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"><FileText size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">{hasFilters ? "No invoices match these filters" : "No saved invoices yet"}</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{hasFilters ? "Try broadening your search or clearing one of the filters." : "Create your first invoice to start a dependable, searchable history."}</p>{hasFilters ? <button className="mt-5 inline-flex h-9 items-center rounded-lg border border-border bg-muted/60 px-3 text-sm font-medium shadow-sm hover:border-primary/40" type="button" onClick={resetFilters}>Clear filters</button> : <Link className={`${buttonVariants()} mt-5`} href="/"><Plus data-icon="inline-start" />Create invoice</Link>}</div>}
      {!loading && !error && invoices.length > 0 && <>
        <div className="overflow-hidden surface" aria-busy={loading}>
          <div className="flex items-center justify-between border-b border-border/80 px-5 py-4"><div><h2 className="text-sm font-semibold">All invoices</h2><p className="mt-1 text-xs text-muted-foreground">{invoices.length} {invoices.length === 1 ? "record" : "records"} in this view</p></div>{hasFilters && <button className="text-xs font-semibold text-primary hover:underline" type="button" onClick={resetFilters}>Reset view</button>}</div>
          <div className="data-table-header hidden grid-cols-[minmax(120px,0.75fr)_minmax(180px,1.25fr)_110px_120px_100px_190px] gap-4 px-5 py-3 lg:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span>Status</span><span className="text-right">Total</span><span className="text-right">Actions</span></div>
          {invoices.map((invoice) => <div key={invoice.id} className="grid gap-3 border-t border-border/60 px-5 py-4 transition-colors first:border-t-0 hover:bg-muted/25 lg:grid-cols-[minmax(120px,0.75fr)_minmax(180px,1.25fr)_110px_120px_100px_190px] lg:items-center lg:gap-4">
            <div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-muted-foreground lg:hidden">{date(invoice.issue_date)}</p></div>
            <div><p className="text-sm">{invoice.customer_snapshot?.companyName || "Customer company"}</p><p className="text-xs text-muted-foreground">{invoice.customer_snapshot?.name || "Customer name"}</p></div>
            <p className="hidden text-sm text-muted-foreground lg:block">{date(invoice.issue_date)}</p>
            <div>{invoice.lifecycle_status === "draft" ? <span className="inline-flex rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-mono uppercase text-foreground/80">Draft</span> : <select className="h-8 rounded-lg border border-border bg-muted/60 px-2 text-xs font-medium capitalize text-foreground/80 focus:border-ring focus:outline-none" value={invoice.payment_status} disabled={busyId === invoice.id} onChange={(event) => void performAction(invoice, "payment_status", event.target.value as InvoiceRecord["payment_status"])}><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select>}</div>
            <p className="text-right text-sm font-semibold">{money(invoice.total_amount)}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {invoice.lifecycle_status === "draft" ? <Link className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-foreground/80 underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline" href={`/?draft=${encodeURIComponent(invoice.id)}`}>Open draft</Link> : <><Link className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-foreground/80 underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline" href={`/?draft=${encodeURIComponent(invoice.id)}`}>Edit</Link><Link className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-foreground/80 underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline" href={`/?draft=${encodeURIComponent(invoice.id)}&download=PDF`}><FileDown size={12} />PDF</Link><Link className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-foreground/80 underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline" href={`/?draft=${encodeURIComponent(invoice.id)}&download=DOCX`}><FileDown size={12} />DOCX</Link><button className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-foreground/80 underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline" type="button" disabled={busyId === invoice.id} onClick={() => void performAction(invoice, "revise")}>Revise</button></>}
              <button className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-destructive underline-offset-4 hover:bg-rose-500/10 hover:underline" type="button" disabled={busyId === invoice.id} onClick={() => void performAction(invoice, "trash")}>Move to Trash</button>
            </div>
          </div>)}
        </div>
      </>}
    </div>
  </main>
}
