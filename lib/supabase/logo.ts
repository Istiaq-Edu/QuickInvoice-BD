import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Signed logo URLs are minted on every read across several routes. Centralising
 * the bucket and TTL keeps them from drifting apart, and a longer window means
 * fewer re-signs while the browser holds a still-valid URL.
 */
export const LOGO_BUCKET = "seller-logos"
export const LOGO_URL_TTL_SECONDS = 6 * 60 * 60

export async function signLogoUrl(supabase: SupabaseClient, storagePath: string | null | undefined) {
  if (!storagePath) return null
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).createSignedUrl(storagePath, LOGO_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Resolves a logo asset to a signed URL, skipping assets that were soft deleted.
 * Returns null whenever the logo is missing so callers can fall back cleanly.
 */
export async function resolveLogoUrl(supabase: SupabaseClient, logoAssetId: string | null | undefined) {
  if (!logoAssetId) return null
  const { data: asset, error } = await supabase
    .from("logo_assets")
    .select("storage_path")
    .eq("id", logoAssetId)
    .is("deleted_at", null)
    .maybeSingle()
  if (error || !asset) return null
  return signLogoUrl(supabase, asset.storage_path)
}
