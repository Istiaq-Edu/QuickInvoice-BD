import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const requestSchema = z.object({
  invoiceId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  version: z.number().int().nonnegative(),
})

type FinalizationResult = {
  result_invoice_id: string | null
  result_invoice_number: string | null
  result_sequence_value: number | null
  result_version: number | null
  replayed: boolean
  error_code: string | null
}

const statusForError = (code: string) => {
  if (code === "AUTH_REQUIRED") return 401
  if (code === "INVOICE_NOT_FOUND" || code === "WORKSPACE_NOT_FOUND") return 404
  if (["VERSION_CONFLICT", "ALREADY_FINALIZED", "IDEMPOTENCY_MISMATCH"].includes(code)) return 409
  return 422
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Finalization request is invalid." }, { status: 400 })

  const { data, error } = await supabase.rpc("finalize_invoice", {
    p_expected_version: parsed.data.version,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_invoice_id: parsed.data.invoiceId,
  })

  if (error) return NextResponse.json({ error: "Invoice could not be finalized." }, { status: 500 })

  const result = (Array.isArray(data) ? data[0] : data) as FinalizationResult | null
  if (!result) return NextResponse.json({ error: "Invoice finalization returned no result." }, { status: 500 })
  if (result.error_code) {
    const status = statusForError(result.error_code)
    const message = result.error_code === "VERSION_CONFLICT"
      ? "This draft changed elsewhere. Reload it before finalizing."
      : result.error_code === "ALREADY_FINALIZED"
        ? "This invoice is already finalized."
        : result.error_code === "REQUIRED_FIELDS_MISSING"
          ? "Complete the required seller and buyer fields first."
          : result.error_code === "LINE_ITEMS_REQUIRED" || result.error_code.startsWith("LINE_ITEM")
            ? "Complete every line item before finalizing."
            : result.error_code === "DISCOUNT_INVALID"
              ? "Check the discount amount before finalizing."
              : "Invoice could not be finalized."
    return NextResponse.json({ code: result.error_code, error: message }, { status })
  }

  return NextResponse.json({
    id: result.result_invoice_id,
    invoiceNumber: result.result_invoice_number,
    replayed: result.replayed,
    sequenceValue: result.result_sequence_value,
    version: result.result_version,
  })
}
