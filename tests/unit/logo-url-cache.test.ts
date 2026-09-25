import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { clearCachedLogoUrl, readCachedLogoUrl, resolveLogoImageUrl, writeCachedLogoUrl } from "@/lib/image/logo-url-cache"

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, value) }
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function installStorage(implementation: Storage | null) {
  Object.defineProperty(globalThis, "window", {
    value: { sessionStorage: implementation },
    configurable: true,
    writable: true,
  })
}

const fresh = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString()

beforeEach(() => {
  installStorage(new MemoryStorage())
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
})

describe("logo url cache", () => {
  it("round-trips an entry", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/one", expiresAt: fresh(5) })
    expect(readCachedLogoUrl()).toMatchObject({ assetId: "asset-1", url: "https://signed/one" })
  })

  it("ignores a corrupt entry instead of throwing", () => {
    const store = new MemoryStorage()
    installStorage(store)
    store.setItem("qi.seller-logo-url.v1", "{not json")
    expect(readCachedLogoUrl()).toBeNull()
    expect(store.getItem("qi.seller-logo-url.v1")).toBeNull()
  })

  it("ignores an entry with the wrong shape", () => {
    const store = new MemoryStorage()
    installStorage(store)
    store.setItem("qi.seller-logo-url.v1", JSON.stringify({ assetId: 7, url: "https://signed/one" }))
    expect(readCachedLogoUrl()).toBeNull()
  })

  it("survives storage being unavailable", () => {
    installStorage(null)
    expect(() => writeCachedLogoUrl({ assetId: "a", url: "u", expiresAt: fresh(1) })).not.toThrow()
    expect(readCachedLogoUrl()).toBeNull()
    expect(resolveLogoImageUrl({ id: "a", url: "u", expiresAt: fresh(1) })).toBe("u")
  })

  it("survives a storage that throws on write", () => {
    installStorage({
      getItem: () => null,
      setItem: () => { throw new Error("quota") },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage)
    expect(() => writeCachedLogoUrl({ assetId: "a", url: "u", expiresAt: fresh(1) })).not.toThrow()
  })

  it("reuses a still-valid URL for the same asset", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/first", expiresAt: fresh(5) })
    const resolved = resolveLogoImageUrl({ id: "asset-1", url: "https://signed/second", expiresAt: fresh(6) })
    expect(resolved).toBe("https://signed/first")
  })

  it("uses the new URL when the asset changed", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/first", expiresAt: fresh(5) })
    const resolved = resolveLogoImageUrl({ id: "asset-2", url: "https://signed/second", expiresAt: fresh(6) })
    expect(resolved).toBe("https://signed/second")
    expect(readCachedLogoUrl()).toMatchObject({ assetId: "asset-2", url: "https://signed/second" })
  })

  it("never reuses a URL that is about to expire", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/old", expiresAt: fresh(0.05) })
    expect(resolveLogoImageUrl({ id: "asset-1", url: "https://signed/new", expiresAt: fresh(5) })).toBe("https://signed/new")
  })

  it("does not extend a reused entry's expiry", () => {
    const expiry = fresh(1)
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/first", expiresAt: expiry })
    resolveLogoImageUrl({ id: "asset-1", url: "https://signed/second", expiresAt: fresh(6) })
    expect(readCachedLogoUrl()?.expiresAt).toBe(expiry)
  })

  it("clears the entry when the workspace has no logo", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/one", expiresAt: fresh(5) })
    expect(resolveLogoImageUrl(null)).toBeNull()
    expect(readCachedLogoUrl()).toBeNull()
  })

  it("prefers a valid cached URL when a fresh one is missing", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/first", expiresAt: fresh(5) })
    expect(resolveLogoImageUrl({ id: "asset-1", url: null })).toBe("https://signed/first")
  })

  it("returns null when there is nothing to show", () => {
    expect(resolveLogoImageUrl(undefined)).toBeNull()
    expect(resolveLogoImageUrl({ id: null, url: null })).toBeNull()
  })

  it("clears on request", () => {
    writeCachedLogoUrl({ assetId: "asset-1", url: "https://signed/one", expiresAt: fresh(5) })
    clearCachedLogoUrl()
    expect(readCachedLogoUrl()).toBeNull()
  })
})
