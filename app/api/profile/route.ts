import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
  }

  // Delegate to the database definition so this flag can never drift from the
  // RLS policies. The function requires an active profile *and* an active
  // workspace; the previous inline check inspected only profiles.status.
  const { data: isAdmin, error: adminError } = await supabase.rpc("current_profile_is_admin")

  if (adminError) {
    return NextResponse.json({ error: "Profile could not be loaded." }, { status: 500 })
  }

  return NextResponse.json({ isAdmin: isAdmin === true }, { headers: { "cache-control": "no-store" } })
}
