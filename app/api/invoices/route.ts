import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const sortValues = new Set(["newest", "oldest", "amount_high", "amount_low", "due_soon", "due_late", "number_asc", "number_desc"])
const paymentStatuses = new Set(["unpaid", "paid", "overdue"])

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
  const dateFilters = [issueFrom, issueTo, dueFrom, dueTo].filter(Boolean)

  if (!new Set(["active", "trash"]).has(view)) return NextResponse.json({ error: "Invoice view is invalid." }, { status: 400 })
  if (paymentStatus !== "all" && !paymentStatuses.has(paymentStatus)) {
    return NextResponse.json({ error: "Payment status filter is invalid." }, { status: 400 })
  }
  if (!sortValues.has(sort)) return NextResponse.json({ error: "Sort option is invalid." }, { status: 400 })
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
    .select("id, invoice_number, lifecycle_status, issue_date, due_date, payment_status, total_amount, updated_at, customer_snapshot")

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
  if (query) {
    invoices = invoices.filter((invoice) => {
      const customer = invoice.customer_snapshot as { companyName?: string; name?: string } | null
      return [invoice.invoice_number, customer?.companyName, customer?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
  }

  invoices.sort((left, right) => {
    if (sort === "oldest") return left.issue_date.localeCompare(right.issue_date)
    if (sort === "amount_high") return Number(right.total_amount) - Number(left.total_amount)
    if (sort === "amount_low") return Number(left.total_amount) - Number(right.total_amount)
    if (sort === "due_soon") return left.due_date.localeCompare(right.due_date)
    if (sort === "due_late") return right.due_date.localeCompare(left.due_date)
    if (sort === "number_asc") return (left.invoice_number ?? "").localeCompare(right.invoice_number ?? "", undefined, { numeric: true })
    if (sort === "number_desc") return (right.invoice_number ?? "").localeCompare(left.invoice_number ?? "", undefined, { numeric: true })
    return right.issue_date.localeCompare(left.issue_date) || right.updated_at.localeCompare(left.updated_at)
  })

  return NextResponse.json({ invoices })
}
