"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

/**
 * Width is the caller's decision, not this component's.
 *
 * This button is used in two shapes: inline in a header's control row, where it
 * must size to its label, and stacked in the mobile dropdown menu, where it
 * fills the column. It used to hardcode `w-full ... lg:w-auto`, which is correct
 * for the dropdown and for the desktop nav but wrong for the invoice page's
 * header, where the button is inline at every width — so below `lg` it demanded
 * 100% of a flex container whose width its own content helped determine. That
 * resolved to 318px on a 320px screen and pushed the document to 691px wide,
 * which is a horizontal scroll on every phone. The default is now `auto`, and
 * only the dropdown opts into `w-full`.
 */
export function SignOutButton({ className, compact = false }: { className?: string; compact?: boolean } = {}) {
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

  // `compact` drops the visible label below `sm` and leaves it for assistive
  // tech. The invoice page header shows this button at every width, and at 320px
  // the logo plus three labelled controls need 452px in a 288px box, so the
  // labels are what has to give. The dropdown and the desktop nav keep the label:
  // there is room, and a lone icon in a menu reads worse than a word.
  return <Button className={cn("min-h-10 justify-start", className)} variant="ghost" size="sm" type="button" disabled={loading} onClick={() => void signOut}><LogOut data-icon="inline-start" /><span className={compact ? "sr-only sm:not-sr-only" : undefined}>{loading ? "Signing out…" : "Sign out"}</span></Button>
}
