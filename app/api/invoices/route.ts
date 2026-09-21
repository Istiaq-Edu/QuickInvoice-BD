import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, lifecycle_status, issue_date, due_date, payment_status, total_amount, updated_at, customer_snapshot")
    .neq("lifecycle_status", "trashed")
    .order("issue_date", { ascending: false })
    .order("updated_at", { ascending: false })

  if (error) return NextResponse.json({ error: "Invoice history could not be loaded." }, { status: 500 })
  return NextResponse.json({ invoices: data ?? [] })
}
