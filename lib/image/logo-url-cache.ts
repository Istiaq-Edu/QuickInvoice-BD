/**
 * Keeps the signed logo URL a tab already holds instead of re-downloading the
 * image on every page load.
 *
 * The bucket is private, so the browser only ever sees short-lived signed URLs
 * and the API mints a new one on every read. Each signature is a different URL,
 * which means the browser's own cache never matches and the image is fetched
 * again on every reload, even though the bytes are identical and the object is
 * stored with a one-year cache header.
 *
 * The fix is to remember the URL we used, and keep using it while it is valid.
 * A cached URL is only ever handed back after the server has confirmed it still
 * belongs to the logo the app is about to show: a different asset id means a
 * different file, so the cache is bypassed. That ordering matters, because the
 * cache is stored per tab rather than per user, and a shared browser must never
 * be able to render another account's logo.
 */

export type LogoImagePayload = {
  id?: string | null
  url?: string | null
  expiresAt?: string | null
}

export type CachedLogoUrl = {
  assetId: string
  url: string
  expiresAt: string
}

const STORAGE_KEY = "qi.seller-logo-url.v1"

/**
 * Reuse stops this long before the signature actually expires, so a URL is
 * never handed to the browser in the window where it is about to be rejected.
 */
const REUSE_MARGIN_MS = 10 * 60 * 1000

function storage(): Storage | null {
  // Server render, and browsers that block storage outright, both mean there is
  // simply nothing to reuse. Never let that break rendering the logo.
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function isFresh(expiresAt: string, now: number) {
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(expiry)) return false
  return expiry - now > REUSE_MARGIN_MS
}

export function readCachedLogoUrl(): CachedLogoUrl | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const { assetId, url, expiresAt } = parsed as Record<string, unknown>
    if (typeof assetId !== "string" || typeof url !== "string" || typeof expiresAt !== "string") return null
    return { assetId, url, expiresAt }
  } catch {
    // Corrupt or unreadable entry: drop it and fall back to the fresh URL.
    clearCachedLogoUrl()
    return null
  }
}

export function writeCachedLogoUrl(entry: CachedLogoUrl) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Quota or private mode. The next load just signs a fresh URL again.
  }
}

export function clearCachedLogoUrl() {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

/**
 * Returns the image URL to display for a freshly loaded logo and keeps the
 * cache in step with it. Pure apart from that bookkeeping, which is why the
 * caller only has to run it on the account logo response.
 *
 * A cached URL wins only when it belongs to the same asset and is still well
 * inside its lifetime. When it is reused the entry is deliberately left
 * untouched: its stored expiry reflects the actual signature, and overwriting
 * it with the newly reported one would claim validity that was never granted.
 */
export function resolveLogoImageUrl(logo: LogoImagePayload | null | undefined, now = Date.now()) {
  const cached = readCachedLogoUrl()
  const assetId = logo?.id ?? null
  const url = logo?.url ?? null

  if (!assetId && !url) {
    clearCachedLogoUrl()
    return null
  }

  if (cached && cached.assetId === assetId && isFresh(cached.expiresAt, now)) {
    return cached.url
  }

  if (assetId && url && logo?.expiresAt && isFresh(logo.expiresAt, now)) {
    writeCachedLogoUrl({ assetId, url, expiresAt: logo.expiresAt })
    return url
  }

  return url
}
