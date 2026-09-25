import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { AllowlistManager } from "@/app/admin/allowlist/allowlist-manager"

export const dynamic = "force-dynamic"

export default async function AdminAllowlistPage() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) redirect("/auth/login")

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) redirect("/auth/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, status")
    .eq("user_id", authData.user.id)
    .maybeSingle()

  if (!profile?.is_admin || profile.status !== "active") redirect("/")

  return <AllowlistManager currentEmail={authData.user.email ?? ""} />
}
