import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { AllowlistManager } from "@/app/admin/allowlist/allowlist-manager"

export const dynamic = "force-dynamic"

export default async function AdminAllowlistPage() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) redirect("/auth/login")

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) redirect("/auth/login")

  // Single source of truth: the database function also requires an active
  // workspace, which a profiles-only check would miss.
  const { data: isAdmin } = await supabase.rpc("current_profile_is_admin")

  if (isAdmin !== true) redirect("/")

  return <AllowlistManager currentEmail={authData.user.email ?? ""} />
}
