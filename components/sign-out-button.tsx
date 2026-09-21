"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export function SignOutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      router.push("/")
      return
    }
    setLoading(true)
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  return <Button variant="outline" size="sm" type="button" disabled={loading} onClick={() => void signOut}><LogOut data-icon="inline-start" />{loading ? "Signing out…" : "Sign out"}</Button>
}
