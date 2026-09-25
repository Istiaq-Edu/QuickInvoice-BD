import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Signed logo URLs are minted on every read across several routes. Centralising
 * the bucket and TTL keeps them from drifting apart, and a longer window means
 * fewer re-signs while the browser holds a still-valid URL.
 */
export const LOGO_BUCKET = "seller-logos"
export const LOGO_URL_TTL_SECONDS = 6 * 60 * 60

/**
 * ISO instant at which a URL signed for LOGO_URL_TTL_SECONDS stops working.
 * Sent alongside the URL so the browser can keep showing the image it already
 * downloaded instead of re-fetching it behind a freshly signed URL, which the
 * browser cache cannot match.
 */
export function logoUrlExpiresAt() {
  return new Date(Date.now() + LOGO_URL_TTL_SECONDS * 1000).toISOString()
}

/**
 * Content hash of the uploaded bytes. The column it fills is read back to
 * deduplicate re-uploads, so it has to identify the bytes and nothing else: the
 * previous value was a size plus mtime pair, which collides for two different
 * files that came from the same folder.
 */
export async function hashLogoBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

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
