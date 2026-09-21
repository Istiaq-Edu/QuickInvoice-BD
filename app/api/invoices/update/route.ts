import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { calculateTotals, invoiceDraftSchema } from "@/lib/invoice/validation"
import { syncCustomer } from "@/lib/invoice/customer-sync"

const requestSchema = z.object({
  invoiceId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  invoice: invoiceDraftSchema,
})

type UpdateResult = {
  result_invoice_id: string | null
  result_version: number | null
  error_code: string | null
}

const statusForError = (code: string) => {
  if (code === "AUTH_REQUIRED") return 401
  if (code === "INVOICE_NOT_FOUND" || code === "WORKSPACE_NOT_FOUND") return 404
  if (code === "VERSION_CONFLICT" || code === "NOT_FINALIZED") return 409
  return 422
}

const messageForError = (code: string) => {
  if (code === "VERSION_CONFLICT") return "This invoice changed elsewhere. Reload it before saving."
  if (code === "NOT_FINALIZED") return "Only finalized invoices can be edited here."
  if (code === "REQUIRED_FIELDS_MISSING") return "Complete the required seller and buyer fields first."
  if (code === "LINE_ITEMS_REQUIRED" || code.startsWith("LINE_ITEM")) return "Complete every line item before saving."
  if (code === "DISCOUNT_INVALID") return "Check the discount amount before saving."
  return "Invoice could not be saved."
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invoice update data is invalid." }, { status: 400 })

  const invoice = parsed.data.invoice
  const totals = calculateTotals(invoice)
  const document = { schemaVersion: 1, ...invoice, totals }
  const { data, error } = await supabase.rpc("update_finalized_invoice", {
    p_canonical: document,
    p_due_date: invoice.dueDate,
    p_expected_version: parsed.data.version,
    p_invoice_id: parsed.data.invoiceId,
    p_issue_date: invoice.issueDate,
    p_payment_status: invoice.paymentStatus,
  })

  if (error) return NextResponse.json({ error: "Invoice could not be saved." }, { status: 500 })
  const result = (Array.isArray(data) ? data[0] : data) as UpdateResult | null
  if (!result) return NextResponse.json({ error: "Invoice update returned no result." }, { status: 500 })
  if (result.error_code) return NextResponse.json({ code: result.error_code, error: messageForError(result.error_code) }, { status: statusForError(result.error_code) })
  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("user_id", authData.user.id).single()
  if (profile) await syncCustomer(supabase, profile.workspace_id, invoice)
  return NextResponse.json({ id: result.result_invoice_id, version: result.result_version })
}
