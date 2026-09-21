import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { calculateTotals, invoiceDraftSaveSchema } from "@/lib/invoice/validation"
import type { InvoiceDraft } from "@/lib/invoice/types"

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = invoiceDraftSaveSchema.safeParse(body?.invoice)
  if (!parsed.success) return NextResponse.json({ error: "Invoice data is invalid.", issues: parsed.error.flatten() }, { status: 400 })

  const { data: profile, error: profileError } = await supabase.from("profiles").select("workspace_id").eq("user_id", authData.user.id).single()
  if (profileError || !profile) return NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 })

  const invoice = parsed.data
  const normalizedInvoice: InvoiceDraft = {
    ...invoice,
    discountValue: typeof invoice.discountValue === "number" ? invoice.discountValue : 0,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: typeof line.quantity === "number" ? line.quantity : 1,
      unitPrice: typeof line.unitPrice === "number" ? line.unitPrice : 0,
    })),
  }
  const totals = calculateTotals(normalizedInvoice)
  const document = { schemaVersion: 1, ...invoice, totals }
  const snapshot = {
    companyName: invoice.sellerCompanyName,
    name: invoice.sellerName,
    email: invoice.sellerEmail ?? "",
    phone: invoice.sellerPhone ?? "",
    address: invoice.sellerAddress ?? "",
  }
  const customerSnapshot = {
    companyName: invoice.buyerCompanyName,
    name: invoice.buyerName,
    email: invoice.buyerEmail ?? "",
    phone: invoice.buyerPhone ?? "",
    address: invoice.buyerAddress ?? "",
  }

  const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : null
  const expectedVersion = typeof body?.version === "number" ? body.version : null

  if (invoiceId && expectedVersion === null) {
    return NextResponse.json({ error: "A draft version is required when updating a draft." }, { status: 400 })
  }

  if (invoiceId) {
    const query = supabase.from("invoices").update({
      canonical_document: document,
      seller_snapshot: snapshot,
      customer_snapshot: customerSnapshot,
      issue_date: invoice.issueDate,
      due_date: invoice.dueDate,
      payment_status: invoice.paymentStatus,
      discount_type: invoice.discountType,
      discount_input_value: normalizedInvoice.discountValue,
      subtotal_amount: totals.subtotal,
      discount_amount: totals.discountAmount,
      total_amount: totals.total,
      version: (expectedVersion ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", invoiceId).eq("workspace_id", profile.workspace_id).eq("lifecycle_status", "draft")

    const guarded = query.eq("version", expectedVersion)
    const { data, error } = await guarded.select("id, version").maybeSingle()
    if (error) return NextResponse.json({ error: "Draft could not be saved." }, { status: 500 })
    if (!data) return NextResponse.json({ error: "Draft changed elsewhere.", code: "VERSION_CONFLICT" }, { status: 409 })

    await supabase.from("invoice_lines").delete().eq("invoice_id", invoiceId)
    const { error: lineError } = await supabase.from("invoice_lines").insert(normalizedInvoice.lines.map((line, position) => ({
      invoice_id: invoiceId,
      position,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.quantity * line.unitPrice,
    })))
    if (lineError) return NextResponse.json({ error: "Draft lines could not be saved." }, { status: 500 })
    return NextResponse.json({ id: data.id, version: data.version })
  }

  const { data, error } = await supabase.from("invoices").insert({
    workspace_id: profile.workspace_id,
    lifecycle_status: "draft",
    issue_date: invoice.issueDate,
    due_date: invoice.dueDate,
    payment_status: invoice.paymentStatus,
    discount_type: invoice.discountType,
    discount_input_value: normalizedInvoice.discountValue,
    subtotal_amount: totals.subtotal,
    discount_amount: totals.discountAmount,
    total_amount: totals.total,
    canonical_document: document,
    seller_snapshot: snapshot,
    customer_snapshot: customerSnapshot,
  }).select("id, version").single()

  if (error || !data) return NextResponse.json({ error: "Draft could not be created." }, { status: 500 })
  const { error: lineError } = await supabase.from("invoice_lines").insert(normalizedInvoice.lines.map((line, position) => ({
    invoice_id: data.id,
    position,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.quantity * line.unitPrice,
  })))
  if (lineError) return NextResponse.json({ error: "Draft lines could not be saved." }, { status: 500 })

  return NextResponse.json({ id: data.id, version: data.version }, { status: 201 })
}
