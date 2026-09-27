import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const requestSchema = z.object({
  action: z.enum(["revise", "payment_status", "trash", "restore", "permanently_delete", "reissue_balance"]),
  invoiceId: z.string().uuid(),
  paymentStatus: z.enum(["unpaid", "partial", "paid", "overdue"]).optional(),
}).superRefine((request, context) => {
  if (request.action === "payment_status" && !request.paymentStatus) {
    context.addIssue({ code: "custom", path: ["paymentStatus"], message: "Payment status is required." })
  }
  // "partial" is derived from the payment ledger, so it cannot be set by hand.
  // Choosing it without recording payments would show a state the books
  // disagree with, and the next sync would silently revert it.
  if (request.action === "payment_status" && request.paymentStatus === "partial") {
    context.addIssue({ code: "custom", path: ["paymentStatus"], message: "Record a payment to mark an invoice partially paid." })
  }
})

type ActionResult = {
  result_invoice_id?: string | null
  result_version?: number | null
  error_code?: string | null
}

const statusForError = (code: string) => {
  if (code === "AUTH_REQUIRED") return 401
  if (code === "INVOICE_NOT_FOUND" || code === "WORKSPACE_NOT_FOUND") return 404
  if (code === "NOT_FINALIZED") return 409
  return 422
}

const messageForError = (code: string) => {
  if (code === "NOT_FINALIZED") return "Only finalized invoices can be revised."
  if (code === "INVOICE_NOT_FOUND") return "That invoice could not be found."
  if (code === "WORKSPACE_NOT_FOUND") return "Your workspace could not be found."
  if (code === "AUTH_REQUIRED") return "Authentication is required."
  if (code === "PAYMENTS_RECORDED") return "This invoice has recorded payments. Remove them before marking it unpaid."
  if (code === "PAYMENTS_EXCEED_NEW_TOTAL") return "The recorded payments are more than this invoice's new total. Remove a payment or raise the total instead."
  if (code === "NOTHING_OUTSTANDING") return "This invoice is already settled in full, so there is no balance to re-raise."
  return "Invoice action could not be completed."
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invoice action is invalid." }, { status: 400 })

  const { action, invoiceId, paymentStatus } = parsed.data
  const rpc = action === "revise"
    ? supabase.rpc("revise_invoice", { p_invoice_id: invoiceId })
    : action === "reissue_balance"
      ? supabase.rpc("reissue_invoice_balance", { p_invoice_id: invoiceId })
    : action === "payment_status"
      ? supabase.rpc("update_invoice_payment_status", { p_invoice_id: invoiceId, p_payment_status: paymentStatus })
      : action === "trash"
        ? supabase.rpc("trash_invoice", { p_invoice_id: invoiceId })
        : action === "restore"
          ? supabase.rpc("restore_invoice", { p_invoice_id: invoiceId })
          : supabase.rpc("permanently_delete_invoice", { p_invoice_id: invoiceId })

  const { data, error } = await rpc
  if (error) return NextResponse.json({ error: "Invoice action could not be completed." }, { status: 500 })

  if (action === "permanently_delete") {
    const errorCode = typeof data === "string" ? data : null
    if (errorCode) return NextResponse.json({ code: errorCode, error: messageForError(errorCode) }, { status: statusForError(errorCode) })
    return NextResponse.json({ success: true })
  }

  // reissue_invoice_balance returns the new draft under a different column, so it
  // is read separately and the caller navigates straight into the editor.
  if (action === "reissue_balance") {
    const reissued = (Array.isArray(data) ? data[0] : data) as { result_new_invoice_id: string | null; result_amount: number | null; error_code: string | null } | null
    if (!reissued) return NextResponse.json({ error: "Invoice action returned no result." }, { status: 500 })
    if (reissued.error_code) return NextResponse.json({ code: reissued.error_code, error: messageForError(reissued.error_code) }, { status: statusForError(reissued.error_code) })
    return NextResponse.json({ id: reissued.result_new_invoice_id, amount: Number(reissued.result_amount ?? 0) })
  }

  const result = (Array.isArray(data) ? data[0] : data) as ActionResult | null
  if (!result) return NextResponse.json({ error: "Invoice action returned no result." }, { status: 500 })
  if (result.error_code) return NextResponse.json({ code: result.error_code, error: messageForError(result.error_code) }, { status: statusForError(result.error_code) })

  return NextResponse.json({
    id: result.result_invoice_id,
    version: result.result_version,
  })
}
