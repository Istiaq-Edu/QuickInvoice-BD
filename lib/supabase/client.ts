import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { supabasePublishableKey, supabaseUrl } from "./config"

let browserClient: SupabaseClient | null = null

export function createSupabaseBrowserClient() {
  if (!supabaseUrl || !supabasePublishableKey) return null
  browserClient ??= createBrowserClient(supabaseUrl, supabasePublishableKey)
  return browserClient
}
