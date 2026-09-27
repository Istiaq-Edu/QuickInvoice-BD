import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { calculateSettlement } from "@/lib/invoice/types"
import { isInvoiceSort } from "@/lib/invoice/sort"

const paymentStatuses = new Set(["unpaid", "partial", "paid", "overdue"])
// "outstanding" is not a stored status: it is the set of invoices still carrying
// a balance, which is the question a seller actually asks once payments exist.
const balanceStates = new Set(["all", "outstanding", "settled"])

// "Out of pocket" is the number a seller actually opens the page to see, so the
// response carries it alongside the rows. Overpaid invoices contribute a negative
// balance, which correctly reduces the figure owed rather than inflating it.
function summarise<T extends { settlement: { balance: number; paid: number } | null; due_date: string }>(invoices: T[]) {
  // `overdue` counts money on invoices whose due date has already passed, which is
  // what the word means. Deriving it from "has a balance" instead produced two
  // cards showing the same money under different names.
  const today = new Date().toISOString().slice(0, 10)
  let outstanding = 0
  let received = 0
  let overdue = 0
  let overdueCount = 0

  for (const invoice of invoices) {
    const settlement = invoice.settlement
    if (!settlement) continue
    outstanding += settlement.balance
    received += settlement.paid
    if (settlement.balance > 0 && invoice.due_date < today) {
      overdue += settlement.balance
      overdueCount += 1
    }
  }

  return {
    // The derived settlement is a response detail, not a column, so it is
    // stripped back out and the row shape the table expects is preserved.
    invoices: invoices.map((invoice) => {
      const row = { ...invoice } as Record<string, unknown>
      delete row.settlement
      return row
    }),
    totals: { outstanding, received, overdue, overdueCount },
  }
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
  const view = searchParams.get("view") ?? "active"
  const paymentStatus = searchParams.get("paymentStatus") ?? "all"
  const sort = searchParams.get("sort") ?? "newest"
  const issueFrom = searchParams.get("issueFrom") ?? ""
  const issueTo = searchParams.get("issueTo") ?? ""
  const dueFrom = searchParams.get("dueFrom") ?? ""
  const dueTo = searchParams.get("dueTo") ?? ""
  const minTotalInput = searchParams.get("minTotal")
  const maxTotalInput = searchParams.get("maxTotal")
  const minTotal = minTotalInput ? Number(minTotalInput) : null
  const maxTotal = maxTotalInput ? Number(maxTotalInput) : null
  const balance = searchParams.get("balance") ?? "all"
  const dateFilters = [issueFrom, issueTo, dueFrom, dueTo].filter(Boolean)

  if (!new Set(["active", "trash"]).has(view)) return NextResponse.json({ error: "Invoice view is invalid." }, { status: 400 })
  if (paymentStatus !== "all" && !paymentStatuses.has(paymentStatus)) {
    return NextResponse.json({ error: "Payment status filter is invalid." }, { status: 400 })
  }
  if (!balanceStates.has(balance)) return NextResponse.json({ error: "Balance filter is invalid." }, { status: 400 })
  if (!isInvoiceSort(sort)) return NextResponse.json({ error: "Sort option is invalid." }, { status: 400 })
  if (dateFilters.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))) return NextResponse.json({ error: "Date filter is invalid." }, { status: 400 })
  if ((minTotalInput && (!Number.isSafeInteger(minTotal) || (minTotal ?? 0) < 0)) || (maxTotalInput && (!Number.isSafeInteger(maxTotal) || (maxTotal ?? 0) < 0))) {
    return NextResponse.json({ error: "Amount filter is invalid." }, { status: 400 })
  }
  if (minTotal !== null && maxTotal !== null && minTotal > maxTotal) return NextResponse.json({ error: "Minimum total cannot exceed maximum total." }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  let invoiceQuery = supabase
    .from("invoices")
    .select("id, invoice_number, lifecycle_status, issue_date, due_date, payment_status, total_amount, amount_paid, updated_at, customer_snapshot")

  if (view === "trash") invoiceQuery = invoiceQuery.eq("lifecycle_status", "trashed")
  else invoiceQuery = invoiceQuery.neq("lifecycle_status", "trashed")
  if (paymentStatus !== "all") invoiceQuery = invoiceQuery.eq("payment_status", paymentStatus)
  if (issueFrom) invoiceQuery = invoiceQuery.gte("issue_date", issueFrom)
  if (issueTo) invoiceQuery = invoiceQuery.lte("issue_date", issueTo)
  if (dueFrom) invoiceQuery = invoiceQuery.gte("due_date", dueFrom)
  if (dueTo) invoiceQuery = invoiceQuery.lte("due_date", dueTo)
  if (minTotal !== null) invoiceQuery = invoiceQuery.gte("total_amount", minTotal)
  if (maxTotal !== null) invoiceQuery = invoiceQuery.lte("total_amount", maxTotal)

  const { data, error } = await invoiceQuery
  if (error) return NextResponse.json({ error: "Invoice history could not be loaded." }, { status: 500 })

  let invoices = data ?? []

  // "Paid" needs the ledger, not a stored column: amount_paid is only a cache of
  // SUM(invoice_payments.amount), and nothing on the invoice row records when the
  // money actually arrived. One extra read for the page's invoices, reduced to a
  // single date per invoice here so the client never sees the payment rows.
  const invoiceIds = invoices.map((invoice) => invoice.id as string)
  const paidOnByInvoice = new Map<string, string>()
  if (invoiceIds.length > 0) {
    const { data: payments, error: paymentsError } = await supabase
      .from("invoice_payments")
      .select("invoice_id, received_on")
      .in("invoice_id", invoiceIds)
    if (paymentsError) return NextResponse.json({ error: "Invoice history could not be loaded." }, { status: 500 })
    for (const payment of payments ?? []) {
      const id = payment.invoice_id as string
      const receivedOn = payment.received_on as string | null
      if (!receivedOn) continue
      const current = paidOnByInvoice.get(id)
      // The ledger is the source of truth, so the most recent receipt wins even if
      // the rows arrive unordered.
      if (!current || receivedOn > current) paidOnByInvoice.set(id, receivedOn)
    }
  }
  if (query) {
    invoices = invoices.filter((invoice) => {
      const customer = invoice.customer_snapshot as { companyName?: string; name?: string } | null
      return [invoice.invoice_number, customer?.companyName, customer?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
  }

  // A draft has no settlement yet, so it is excluded from both balance states
  // rather than being counted as fully outstanding.
  const withSettlement = invoices.map((invoice) => ({
    ...invoice,
    paidOn: paidOnByInvoice.get(invoice.id as string) ?? null,
    settlement: invoice.lifecycle_status === "finalized"
      ? calculateSettlement(invoice.total_amount, invoice.amount_paid)
      : null,
  }))

  if (balance === "outstanding") {
    return NextResponse.json({ ...summarise(withSettlement.filter((invoice) => (invoice.settlement?.balance ?? 0) > 0)) })
  }
  if (balance === "settled") {
    return NextResponse.json({ ...summarise(withSettlement.filter((invoice) => invoice.settlement !== null && invoice.settlement.balance <= 0)) })
  }

  const sorted = [...withSettlement]

  sorted.sort((left, right) => {
    if (sort === "oldest") return left.issue_date.localeCompare(right.issue_date)
    if (sort === "amount_high") return Number(right.total_amount) - Number(left.total_amount)
    if (sort === "amount_low") return Number(left.total_amount) - Number(right.total_amount)
    // Outstanding money, not invoice size, is what a seller chases. Drafts sort
    // last because they carry no balance yet.
    if (sort === "balance_high") return (right.settlement?.balance ?? -1) - (left.settlement?.balance ?? -1)
    if (sort === "balance_low") return (left.settlement?.balance ?? -1) - (right.settlement?.balance ?? -1)
    if (sort === "due_soon") return left.due_date.localeCompare(right.due_date)
    if (sort === "due_late") return right.due_date.localeCompare(left.due_date)
    // Unpaid invoices carry no date, so they sort last in both directions rather
    // than clustering at one end as an empty string would.
    if (sort === "paid_newest" || sort === "paid_oldest") {
      const leftPaid = left.paidOn ?? null
      const rightPaid = right.paidOn ?? null
      if (leftPaid && rightPaid) return sort === "paid_newest" ? rightPaid.localeCompare(leftPaid) : leftPaid.localeCompare(rightPaid)
      if (leftPaid) return -1
      if (rightPaid) return 1
      return right.issue_date.localeCompare(left.issue_date)
    }
    if (sort === "number_asc") return (left.invoice_number ?? "").localeCompare(right.invoice_number ?? "", undefined, { numeric: true })
    if (sort === "number_desc") return (right.invoice_number ?? "").localeCompare(left.invoice_number ?? "", undefined, { numeric: true })
    return right.issue_date.localeCompare(left.issue_date) || right.updated_at.localeCompare(left.updated_at)
  })

  return NextResponse.json(summarise(sorted))
}
