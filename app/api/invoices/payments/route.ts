import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// Amounts are bigint in Postgres and the ledger is an audit trail, so a payment
// is never silently coerced: it must be a positive whole number of currency units.
const recordSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().int().positive("Enter a payment amount greater than zero.").max(9_223_372_036_854_775_807),
  method: z.enum(["cash", "bank", "mobile", "card", "other"]),
  reference: z.string().trim().max(200).optional(),
  receivedOn: z.string().date().optional(),
  note: z.string().trim().max(1_000).optional(),
})

const deleteSchema = z.object({ paymentId: z.string().uuid() })

type PaymentResult = {
  result_invoice_id: string | null
  result_amount_paid: number | null
  result_balance: number | null
  result_status: string | null
}

// The ledger behind an invoice, so a seller can audit what was received and
// correct an entry made in error. Read-only; writes go through the two RPCs.
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const invoiceId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("invoiceId"))
  if (!invoiceId.success) return NextResponse.json({ error: "Invoice ID is invalid." }, { status: 400 })

  // RLS scopes the read to the caller's own workspace, so no explicit check is
  // needed here; a row belonging to another workspace simply is not returned.
  const { data, error } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, amount, method, reference, received_on, note")
    .eq("invoice_id", invoiceId.data)
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: "Payments could not be loaded." }, { status: 500 })

  return NextResponse.json({
    payments: (data ?? []).map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoice_id,
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.reference,
      receivedOn: payment.received_on,
      note: payment.note,
    })),
  }, { headers: { "cache-control": "no-store" } })
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const parsed = recordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payment details are invalid." }, { status: 400 })
  }

  const { invoiceId, amount, method, reference, receivedOn, note } = parsed.data
  const { data, error } = await supabase.rpc("record_invoice_payment", {
    p_amount: amount,
    p_invoice_id: invoiceId,
    p_method: method,
    p_note: note ?? "",
    p_received_on: receivedOn ?? null,
    p_reference: reference ?? "",
  })

  if (error) return NextResponse.json({ error: "Payment could not be recorded." }, { status: 500 })

  const result = (Array.isArray(data) ? data[0] : data) as PaymentResult | null
  if (!result) return NextResponse.json({ error: "Payment could not be recorded." }, { status: 500 })
  // The RPC echoes the invoice id back on every path, so the null amount is what
  // marks a rejection. Checking the id would report success for a refused write.
  if (result.result_amount_paid === null) {
    return NextResponse.json({ error: "Only a finalized invoice can take a payment." }, { status: 409 })
  }

  return NextResponse.json({
    amountPaid: Number(result.result_amount_paid ?? 0),
    balance: Number(result.result_balance ?? 0),
    paymentStatus: result.result_status,
  })
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Payment ID is invalid." }, { status: 400 })

  const { data, error } = await supabase.rpc("delete_invoice_payment", { p_payment_id: parsed.data.paymentId })
  if (error) return NextResponse.json({ error: "Payment could not be removed." }, { status: 500 })

  const result = (Array.isArray(data) ? data[0] : data) as PaymentResult | null
  if (!result?.result_invoice_id) return NextResponse.json({ error: "Payment could not be removed." }, { status: 404 })

  return NextResponse.json({
    amountPaid: Number(result.result_amount_paid ?? 0),
    balance: Number(result.result_balance ?? 0),
    paymentStatus: result.result_status,
  })
}
