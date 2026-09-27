"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CircleCheck, ClockAlert, FileDown, FilePen, FilePlus2, FileText, LockKeyhole, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, Wallet } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { PaymentStatusPill, RecordPaymentDialog, SettlementCell } from "@/components/invoice-settlement"
import { MoneyText } from "@/components/money-text"
import { useConfirm } from "@/components/confirm-dialog"
import { RowActions, type RowAction } from "@/components/row-actions"
import { buttonVariants } from "@/components/ui/button"
import { resolveBillToParty, calculateSettlement, formatMoney, parsePaymentAmount, type PaymentMethod } from "@/lib/invoice/types"
import type { InvoiceSort } from "@/lib/invoice/sort"

type InvoiceRecord = {
  id: string
  invoice_number: string | null
  lifecycle_status: "draft" | "finalized" | "trashed"
  issue_date: string
  due_date: string
  payment_status: "unpaid" | "partial" | "paid" | "overdue"
  total_amount: number
  amount_paid?: number | null
  /** Date of the most recent recorded payment, from the ledger. Null when unpaid. */
  paidOn: string | null
  customer_snapshot: { companyName?: string; name?: string }
}

type Filters = {
  q: string
  paymentStatus: "all" | "unpaid" | "partial" | "paid" | "overdue"
  // Not a stored status: whether the invoice still carries a balance.
  balance: "all" | "outstanding" | "settled"
  sort: InvoiceSort
  issueFrom: string
  issueTo: string
  dueFrom: string
  dueTo: string
  minTotal: string
  maxTotal: string
}

type HistoryTotals = {
  outstanding: number
  overdue: number
  overdueCount: number
  received: number
}

type Action = "payment_status" | "trash" | "reissue_balance"

// The dialog is opened from a row, so it carries the invoice it is settling
// rather than re-fetching, which keeps the amount on screen in step with the
// balance the user was just looking at.
type PaymentTarget = {
  id: string
  invoiceNumber: string | null
  total: number
  paid: number
  balance: number
  customer: string
}

type RecordedPayment = {
  amount: number
  id: string
  method: string
  note: string
  receivedOn: string
  reference: string
}

const defaultFilters: Filters = {
  q: "",
  paymentStatus: "all",
  balance: "all",
  sort: "newest",
  issueFrom: "",
  issueTo: "",
  dueFrom: "",
  dueTo: "",
  minTotal: "",
  maxTotal: "",
}

const date = (value: string) => {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

// Identifies which invoice a prompt refers to. "Move this invoice to Trash?" is
// ambiguous when several rows are on screen.
function InvoiceSummary({ invoice }: { invoice: InvoiceRecord }) {
  return <div className="space-y-1">
    <div className="flex justify-between gap-4"><span>Invoice</span><span className="font-medium text-foreground">{invoice.invoice_number ?? "Draft"}</span></div>
    <div className="flex justify-between gap-4"><span>Customer</span><span className="font-medium text-foreground">{resolveBillToParty(invoice.customer_snapshot, { heading: "Customer", contact: "" }).heading}</span></div>
    <div className="flex justify-between gap-4"><span>Total</span><span className="font-medium text-foreground">{formatMoney(invoice.total_amount)}</span></div>
  </div>
}

// Shows the arithmetic for a re-raise, so the amount is agreed before the click
// rather than discovered afterwards.
function ReissueSummary({ invoice }: { invoice: InvoiceRecord }) {
  const settlement = calculateSettlement(invoice.total_amount, invoice.amount_paid)
  return <div className="space-y-1">
    <div className="flex justify-between gap-4"><span>Invoice total</span><span className="font-medium text-foreground">{formatMoney(settlement.total)}</span></div>
    {settlement.paid > 0 && <div className="flex justify-between gap-4"><span>Already received</span><span className="font-medium text-foreground">{formatMoney(settlement.paid)}</span></div>}
    <div className="flex justify-between gap-4 border-t border-border pt-1"><span>New invoice for</span><span className="font-semibold text-foreground">{formatMoney(Math.max(0, settlement.balance))}</span></div>
  </div>
}

/** Which actions a row offers, and which of them stay visible outside the menu. */
function buildInvoiceActions(
  invoice: InvoiceRecord,
  settlement: ReturnType<typeof calculateSettlement>,
  busy: boolean,
  openPaymentDialog: (target: InvoiceRecord) => void,
  performAction: (target: InvoiceRecord, action: Action, value?: InvoiceRecord["payment_status"]) => void | Promise<void>
): RowAction[] {
  const editHref = `/?draft=${encodeURIComponent(invoice.id)}`
  const isDraft = invoice.lifecycle_status === "draft"

  // Edit lives in the menu rather than on the row: with Record payment now in the
  // Status column, a visible Edit button was the only thing keeping the Actions
  // column busy, and opening a finalized invoice is not the action a seller
  // reaches for most often.
  const actions: RowAction[] = isDraft
    ? [{ href: editHref, icon: FilePen, label: "Open draft", primary: true }]
    : [{ href: editHref, icon: FilePen, label: "Edit" }]

  if (!isDraft && !settlement.isSettled && !settlement.isPartiallyPaid) {
    actions.push({ icon: CircleCheck, label: "Mark paid", onSelect: () => void performAction(invoice, "payment_status", "paid") })
  }

  // Only offered when money is genuinely still owed. A settled or overpaid
  // invoice has no balance to raise, and offering it there would only produce an
  // error.
  if (!isDraft && settlement.balance > 0) {
    actions.push({ icon: FilePlus2, label: `Re-raise ${formatMoney(settlement.balance)}`, onSelect: () => void performAction(invoice, "reissue_balance") })
  }

  // "Overdue" is the one status the seller decides rather than the ledger, so
  // dropping the status dropdown would have made it unreachable. It moves here
  // instead. It is hidden once the invoice is settled, because calling money
  // owed that has been received overdue is simply wrong.
  if (!isDraft && !settlement.isSettled && invoice.payment_status !== "overdue") {
    actions.push({ icon: ClockAlert, label: "Mark as overdue", onSelect: () => void performAction(invoice, "payment_status", "overdue") })
  }

  if (!isDraft) {
    actions.push(
      { href: `${editHref}&download=PDF`, icon: FileDown, label: "Download PDF", target: "_blank" },
      { href: `${editHref}&download=DOCX`, icon: FileDown, label: "Download DOCX", target: "_blank" }
    )
  }

  actions.push({ destructive: true, icon: Trash2, label: "Move to Trash", onSelect: () => void performAction(invoice, "trash") })

  // While a request is in flight, mark the row inert so a second click cannot
  // fire a duplicate request against the same invoice.
  return busy ? actions.map((action) => ({ ...action, disabled: true })) : actions
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
  const [totals, setTotals] = useState<HistoryTotals | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(null)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const [paymentReference, setPaymentReference] = useState("")
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentError, setPaymentError] = useState("")
  const [recordedPayments, setRecordedPayments] = useState<RecordedPayment[]>([])
  const [removingPaymentId, setRemovingPaymentId] = useState<string | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      const isDefault = (key === "paymentStatus" || key === "balance") && value === "all"
      if (value && !isDefault && !(key === "sort" && value === "newest")) params.set(key, value)
    })
    return params.toString()
  }, [filters])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/invoices${queryString ? `?${queryString}` : ""}`, { signal: controller.signal }).then(async (response) => {
        const result = await response.json() as { invoices?: InvoiceRecord[]; totals?: HistoryTotals; error?: string }
        if (!response.ok) throw new Error(result.error ?? "Invoice history could not be loaded.")
        setInvoices(result.invoices ?? [])
        setTotals(result.totals ?? null)
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
    // The prompts name the invoice, because "Move this invoice to Trash?" is
    // ambiguous when several rows are on screen and only one is being acted on.
    const label = invoice.invoice_number ? `invoice ${invoice.invoice_number}` : "this draft"

    if (action === "trash" && !await confirm({
      title: `Move ${label} to Trash?`,
      description: "You can restore it later, and nothing is deleted until you remove it permanently.",
      confirmLabel: "Move to Trash",
      destructive: true,
      body: <InvoiceSummary invoice={invoice} />,
    })) return

    if (action === "reissue_balance" && !await confirm({
      title: "Raise a new invoice for the balance?",
      description: "A new draft is created for the amount still owed. The original stays exactly as it is, and the two are linked.",
      confirmLabel: "Raise invoice",
      body: <ReissueSummary invoice={invoice} />,
    })) return

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
      // Re-raise creates a fresh draft, so the seller lands in the editor to
      // review it rather than back on a list with one more unexplained row.
      if (action === "reissue_balance" && result.id) {
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
  // Pre-fills the outstanding balance so the overwhelmingly common case, paying
  // off the rest in one go, is a single confirmation with no typing.
  const openPaymentDialog = (invoice: InvoiceRecord) => {
    const settlement = calculateSettlement(invoice.total_amount, invoice.amount_paid)
    setPaymentTarget({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      total: settlement.total,
      paid: settlement.paid,
      balance: settlement.balance,
      customer: resolveBillToParty(invoice.customer_snapshot, { heading: "Customer", contact: "" }).heading,
    })
    setPaymentAmount(settlement.balance > 0 ? String(settlement.balance) : "")
    setPaymentMethod("cash")
    setPaymentReference("")
    setPaymentError("")
    setRecordedPayments([])
    void loadRecordedPayments(invoice.id)
  }

  // The ledger is loaded on open so the seller can audit what was already
  // received and correct an entry, rather than the money being write-only.
  const loadRecordedPayments = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/payments?invoiceId=${encodeURIComponent(invoiceId)}`, { cache: "no-store" })
      const result = await response.json() as { payments?: RecordedPayment[]; error?: string }
      if (response.ok) setRecordedPayments(result.payments ?? [])
    } catch {
      // A failed ledger read must not block recording a new payment.
    }
  }

  const removeRecordedPayment = async (paymentId: string) => {
    const amount = recordedPayments.find((payment) => payment.id === paymentId)?.amount
    if (!await confirm({
      title: "Remove this payment?",
      description: "It is deleted from the ledger and the balance and status are recalculated. This cannot be undone.",
      confirmLabel: "Remove payment",
      destructive: true,
      body: <p>{amount === undefined ? "The recorded payment" : formatMoney(amount)} will be removed from this invoice.</p>,
    })) return
    setRemovingPaymentId(paymentId)
    setPaymentError("")
    try {
      const response = await fetch("/api/invoices/payments", {
        body: JSON.stringify({ paymentId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      })
      const result = await response.json() as { amountPaid?: number; balance?: number; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Payment could not be removed.")
      // The dialog keeps its own copy of the balance, so it is re-derived here from
      // the response. Left stale, deleting the last payment would still show the
      // old "Balance due" and prefill the old amount, and a one-tap save would
      // record money the invoice no longer needs.
      if (paymentTarget && typeof result.amountPaid === "number" && typeof result.balance === "number") {
        setPaymentTarget({ ...paymentTarget, paid: result.amountPaid, balance: result.balance })
        setPaymentAmount(result.balance > 0 ? String(result.balance) : "")
      }
      if (paymentTarget) await loadRecordedPayments(paymentTarget.id)
      setRetry((value) => value + 1)
    } catch (requestError: unknown) {
      setPaymentError(requestError instanceof Error ? requestError.message : "Payment could not be removed.")
    } finally {
      setRemovingPaymentId(null)
    }
  }

  const closePaymentDialog = () => {
    if (paymentSaving) return
    setPaymentTarget(null)
    setPaymentError("")
  }

  const recordPayment = async () => {
    if (!paymentTarget) return
    // Number("") is 0, so an empty field would pass a bare integer check and post
    // a zero payment. The shared parser rejects blank and decimal input.
    const amount = parsePaymentAmount(paymentAmount)
    if (amount === null) {
      setPaymentError("Enter a payment amount greater than zero.")
      return
    }

    setPaymentSaving(true)
    setPaymentError("")
    try {
      const response = await fetch("/api/invoices/payments", {
        body: JSON.stringify({ amount, invoiceId: paymentTarget.id, method: paymentMethod, reference: paymentReference }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const result = await response.json() as { balance?: number; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Payment could not be recorded.")
      // Refresh both the ledger and the row totals, so the dialog and the list
      // reflect the new balance without the seller reopening anything.
      await loadRecordedPayments(paymentTarget.id)
      setPaymentTarget(null)
      setRetry((value) => value + 1)
    } catch (requestError: unknown) {
      setPaymentError(requestError instanceof Error ? requestError.message : "Payment could not be recorded.")
    } finally {
      setPaymentSaving(false)
    }
  }

  const hasFilters = queryString.length > 0
  // Only narrowing filters hide the totals. `sort` is a pure reorder, so choosing
  // "Oldest issue date" must not make the outstanding figure disappear.
  const hasNarrowingFilters = [filters.q, filters.paymentStatus, filters.balance, filters.issueFrom, filters.issueTo, filters.dueFrom, filters.dueTo, filters.minTotal, filters.maxTotal].some(Boolean)
  const hasAdvancedFilters = [filters.issueFrom, filters.issueTo, filters.dueFrom, filters.dueTo, filters.minTotal, filters.maxTotal].some(Boolean)
  const requiresAuthentication = error.toLowerCase().includes("authentication") || error.toLowerCase().includes("sign in")

  return <main className="min-h-screen bg-transparent text-foreground">
    <WorkspaceHeader backHref="/" active="invoices" />

    <div className="workspace-page">
      <WorkspacePageHeader
        compact
        eyebrow="Workspace"
        title="Invoice history"
        actions={hasFilters ? <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground/80 shadow-sm transition hover:border-primary/35 hover:bg-muted" type="button" onClick={resetFilters}><RotateCcw size={15} />Clear filters</button> : undefined}
      />

      {!requiresAuthentication && <section className="mb-4 surface px-3 py-3" aria-label="Invoice history filters">
        {/* One row of controls instead of a heading plus a labelled grid. The seller
            opens this page to read the list, and the old layout spent roughly 190px
            of the viewport on four fields before the first invoice appeared. Labels
            stay in the accessibility tree via sr-only. */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_150px_160px_180px_auto]">
          <label className="relative block">
            <span className="sr-only">Search by invoice number or customer</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input className="field h-9 pl-9 text-sm" placeholder="Invoice number or customer" value={filters.q} onChange={(event) => updateFilter("q", event.target.value)} />
          </label>
          <label className="block">
            <span className="sr-only">Payment status</span>
            <select aria-label="Payment status" className="field h-9 text-sm" value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value as Filters["paymentStatus"])}><option value="all">All statuses</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select>
          </label>
          <label className="block">
            <span className="sr-only">Balance</span>
            <select aria-label="Balance" className="field h-9 text-sm" value={filters.balance} onChange={(event) => updateFilter("balance", event.target.value as Filters["balance"])}><option value="all">Any balance</option><option value="outstanding">Money still owed</option><option value="settled">Settled</option></select>
          </label>
          <label className="block">
            <span className="sr-only">Sort by</span>
            <select aria-label="Sort by" className="field h-9 text-sm" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value as Filters["sort"])}><option value="newest">Newest issue date</option><option value="oldest">Oldest issue date</option><option value="balance_high">Largest balance first</option><option value="balance_low">Smallest balance first</option><option value="amount_high">Highest amount</option><option value="amount_low">Lowest amount</option><option value="due_soon">Nearest due date</option><option value="due_late">Latest due date</option><option value="number_asc">Invoice number A–Z</option><option value="number_desc">Invoice number Z–A</option><option value="paid_newest">Paid date, newest first</option><option value="paid_oldest">Paid date, oldest first</option></select>
          </label>
          <button aria-expanded={showAdvanced} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground" type="button" onClick={() => setShowAdvanced((current) => !current)}>
            <SlidersHorizontal size={14} />{showAdvanced ? "Hide" : "More"}{hasAdvancedFilters ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </button>
        </div>
        {showAdvanced && <div className="mt-3 border-t border-border/80 pt-3">
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

      {loading && <div className="surface p-8 text-sm text-muted-foreground">Loading invoice history⬦</div>}
      {error && !requiresAuthentication && <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-5 text-sm text-destructive"><p>{error}</p><button className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-400/40 bg-card px-3 font-medium text-destructive hover:border-rose-400" type="button" onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1) }}>Try again</button></div>}
      {!loading && requiresAuthentication && <div className="surface flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-primary"><LockKeyhole size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Your invoice history is private</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Sign in to view saved drafts, update payment status, download finalized invoices, and keep every record in one place.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link className={buttonVariants()} href="/auth/login">Sign in to continue</Link><Link className={buttonVariants({ variant: "outline" })} href="/">Create a guest invoice</Link></div></div>}
      {actionError && <div className="mb-5 rounded-lg border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-destructive" role="alert">{actionError}</div>}
      {/* The outstanding figure is the number a seller opens the page to see, so it
          leads the list. It is hidden while a filter is narrowing the view,
          because a total over a subset would read as the whole picture. Each tile
          puts the figure and its label on one line, which is roughly half the
          height of the stacked version and keeps the first invoice near the fold. */}
      {!loading && !error && totals && !hasNarrowingFilters && <dl className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="surface flex items-baseline justify-between gap-3 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">Outstanding</dt>
          <dd className={`money font-heading text-lg font-medium ${totals.outstanding > 0 ? "text-foreground" : "text-muted-foreground"}`}><MoneyText text={formatMoney(totals.outstanding)} /></dd>
        </div>
        <div className="surface flex items-baseline justify-between gap-3 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">Past due</dt>
          <dd className="font-heading text-lg font-medium">{totals.overdueCount > 0 ? <button aria-label={`Show the ${totals.overdueCount} invoice${totals.overdueCount === 1 ? "" : "s"} past due`} className="underline-offset-4 hover:underline" onClick={() => updateFilter("balance", "outstanding")} type="button">{totals.overdueCount} overdue · <MoneyText text={formatMoney(totals.overdue)} /></button> : "None overdue"}</dd>
        </div>
        <div className="surface flex items-baseline justify-between gap-3 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">Received</dt>
          <dd className="money font-heading text-lg font-medium text-emerald-800"><MoneyText text={formatMoney(totals.received)} /></dd>
        </div>
      </dl>}
      {!loading && !error && invoices.length === 0 && <div className="surface flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"><FileText size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">{hasFilters ? "No invoices match these filters" : "No saved invoices yet"}</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{hasFilters ? "Try broadening your search or clearing one of the filters." : "Create your first invoice to start a dependable, searchable history."}</p>{hasFilters ? <button className="mt-5 inline-flex h-9 items-center rounded-lg border border-border bg-muted/60 px-3 text-sm font-medium shadow-sm hover:border-primary/40" type="button" onClick={resetFilters}>Clear filters</button> : <Link className={`${buttonVariants()} mt-5`} href="/"><Plus data-icon="inline-start" />Create invoice</Link>}</div>}
      {!loading && !error && invoices.length > 0 && <>
        <div className="overflow-hidden surface" aria-busy={loading}>
          <div className="flex items-center justify-between border-b border-border/80 px-5 py-3"><h2 className="text-sm font-semibold">All invoices <span className="font-normal text-muted-foreground">· {invoices.length} {invoices.length === 1 ? "record" : "records"}</span></h2>{hasFilters && <button className="text-xs font-semibold text-primary hover:underline" type="button" onClick={resetFilters}>Reset view</button>}</div>
          <div className="data-table-header hidden grid-cols-[minmax(96px,0.7fr)_minmax(130px,1.1fr)_minmax(96px,0.5fr)_136px_118px_92px_52px] gap-3 px-5 py-3 lg:grid"><span>Invoice</span><span>Customer</span><span>Issue date</span><span>Status</span><span className="text-right">Balance</span><span>Paid</span><span className="text-right">Actions</span></div>
          {invoices.map((invoice) => { const settlement = calculateSettlement(invoice.total_amount, invoice.amount_paid); return <div key={invoice.id} className="grid gap-3 border-t border-border/60 px-5 py-4 transition-colors first:border-t-0 hover:bg-muted/25 lg:grid-cols-[minmax(96px,0.7fr)_minmax(130px,1.1fr)_minmax(96px,0.5fr)_136px_118px_92px_52px] lg:items-center lg:gap-3">
            <div><p className="text-sm font-semibold">{invoice.invoice_number ?? "Draft"}</p><p className="text-xs text-muted-foreground lg:hidden">{date(invoice.issue_date)}</p></div>
            <div><p className="text-sm">{resolveBillToParty(invoice.customer_snapshot, { heading: "Customer name", contact: "" }).heading}</p>{invoice.customer_snapshot?.companyName && invoice.customer_snapshot?.name && <p className="text-xs text-muted-foreground">{invoice.customer_snapshot.name}</p>}</div>
            <p className="hidden text-sm text-muted-foreground lg:block">{date(invoice.issue_date)}</p>
            {/* Status carries the money action, because recording a payment is what
                moves the status: record_invoice_payment derives paid/partial/unpaid
                from the ledger. The old dropdown only existed to let the seller
                override that, and the one status the ledger cannot derive —
                overdue — now lives in the row's menu instead. */}
            <div className="flex flex-col items-start gap-1.5">
              {invoice.lifecycle_status === "draft"
                ? <span className="inline-flex rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-mono uppercase text-foreground/80">Draft</span>
                : <>
                  <PaymentStatusPill isOverpaid={settlement.isOverpaid} status={invoice.payment_status} />
                  {/* An overpaid invoice still has to be correctable: the Remove
                      control only exists inside this dialog, and an overpayment is a
                      credit the seller needs to refund or re-apply. Gating on
                      !isSettled would hide it, because an overpayment is settled by
                      definition. */}
                  {(!settlement.isSettled || settlement.isOverpaid) && <button className="inline-flex min-h-8 max-w-full items-center gap-1 whitespace-nowrap rounded-lg border border-primary/30 bg-primary/5 px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60" disabled={busyId === invoice.id} onClick={() => openPaymentDialog(invoice)} type="button">
                    <Wallet className="size-3.5 shrink-0" />{settlement.isOverpaid ? "Manage payments" : "Record payment"}
                  </button>}
                </>}
            </div>
            <SettlementCell amountPaid={invoice.amount_paid} isDraft={invoice.lifecycle_status !== "finalized"} total={invoice.total_amount} />
            {/* When the money actually arrived, taken from the most recent ledger
                row. A draft has no settlement and an unpaid invoice has no
                payments, so both show a dash rather than a misleading date. */}
            <div className="text-sm text-muted-foreground">{invoice.paidOn ? date(invoice.paidOn) : <span className="text-muted-foreground/60">—</span>}</div>
            <RowActions
              actions={buildInvoiceActions(invoice, settlement, busyId === invoice.id, openPaymentDialog, performAction)}
              label={invoice.invoice_number ?? "draft"}
            />
          </div> })}
        </div>
      </>}

      {paymentTarget && <RecordPaymentDialog
        amount={paymentAmount}
        balance={paymentTarget.balance}
        customer={paymentTarget.customer}
        error={paymentError}
        invoiceNumber={paymentTarget.invoiceNumber}
        method={paymentMethod}
        onAmountChange={setPaymentAmount}
        onClose={closePaymentDialog}
        onMethodChange={setPaymentMethod}
        onReferenceChange={setPaymentReference}
        onRemove={(id) => void removeRecordedPayment(id)}
        onSubmit={() => void recordPayment()}
        paid={paymentTarget.paid}
        payments={recordedPayments}
        reference={paymentReference}
        removingId={removingPaymentId}
        saving={paymentSaving}
        total={paymentTarget.total}
      />}

      {confirmDialog}
    </div>
  </main>
}
