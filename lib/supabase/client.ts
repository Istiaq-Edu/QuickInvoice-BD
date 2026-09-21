import { createBrowserClient } from "@supabase/ssr"
import { supabasePublishableKey, supabaseUrl } from "./config"

export function createSupabaseBrowserClient() {
  if (!supabaseUrl || !supabasePublishableKey) return null
  return createBrowserClient(supabaseUrl, supabasePublishableKey)
}
