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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin, status")
    .eq("user_id", authData.user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: "Profile could not be loaded." }, { status: 500 })
  }

  return NextResponse.json(
    { isAdmin: profile?.is_admin === true && profile.status === "active" },
    { headers: { "cache-control": "no-store" } },
  )
}
