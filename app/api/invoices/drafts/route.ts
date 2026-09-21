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

  const { data, error } = await supabase.rpc("save_invoice_draft", {
    p_canonical: document,
    p_customer_snapshot: customerSnapshot,
    p_discount_input_value: normalizedInvoice.discountValue,
    p_discount_type: invoice.discountType,
    p_due_date: invoice.dueDate,
    p_expected_version: expectedVersion,
    p_invoice_id: invoiceId,
    p_issue_date: invoice.issueDate,
    p_lines: normalizedInvoice.lines,
    p_payment_status: invoice.paymentStatus,
    p_seller_snapshot: snapshot,
  })

  if (error) return NextResponse.json({ error: "Draft could not be saved." }, { status: 500 })
  const result = (Array.isArray(data) ? data[0] : data) as { result_invoice_id: string | null; result_version: number | null; error_code: string | null } | null
  if (!result) return NextResponse.json({ error: "Draft save returned no result." }, { status: 500 })
  if (result.error_code) {
    const status = result.error_code === "VERSION_CONFLICT" ? 409 : result.error_code === "AUTH_REQUIRED" ? 401 : result.error_code === "INVOICE_NOT_FOUND" ? 404 : 422
    const message = result.error_code === "VERSION_CONFLICT" ? "Draft changed elsewhere." : result.error_code === "LINE_ITEMS_INVALID" || result.error_code.startsWith("LINE_ITEM") ? "Complete every line item before saving." : result.error_code === "DISCOUNT_INVALID" ? "Check the discount amount before saving." : "Draft could not be saved."
    return NextResponse.json({ error: message, code: result.error_code }, { status })
  }

  return NextResponse.json({ id: result.result_invoice_id, version: result.result_version }, { status: invoiceId ? 200 : 201 })
}
