import { beforeEach, describe, expect, it, vi } from "vitest"

const createSupabaseServerClient = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}))

import { POST } from "../../app/api/seller-logo/route"

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
const SIGNED_URL = "https://storage.test/signed/logo.png?token=abc"

// The route checks magic bytes, so the fixture has to start like a real PNG.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function logoBytes(seed: number) {
  const bytes = new Uint8Array(PNG_SIGNATURE.length + 8)
  bytes.set(PNG_SIGNATURE, 0)
  bytes.fill(seed, PNG_SIGNATURE.length)
  return bytes
}

type AssetRow = {
  id: string
  storage_path: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
}

type FakeState = {
  liveAsset: AssetRow | null
  inserted: Array<Record<string, unknown>>
  patched: Array<{ id: string; patch: Record<string, unknown> }>
  deleted: string[]
  uploads: string[]
  removals: string[]
  activated: string[]
  filters: string[]
  activateSucceeds: boolean
}

function newState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    liveAsset: null,
    inserted: [],
    patched: [],
    deleted: [],
    uploads: [],
    removals: [],
    activated: [],
    filters: [],
    activateSucceeds: true,
    ...overrides,
  }
}

function fakeSupabase(state: FakeState) {
  const record = (op: string) => state.filters.push(op)

  const table = (name: string) => {
    const builder: Record<string, unknown> = {
      select: (columns: string) => {
        record(`select ${name} ${columns}`)
        return builder
      },
      eq: (column: string, value: unknown) => {
        record(`eq ${name}.${column}=${String(value)}`)
        return builder
      },
      is: (column: string, value: unknown) => {
        record(`is ${name}.${column}=${String(value)}`)
        return builder
      },
      order: () => builder,
      limit: (count: number) => {
        record(`limit ${name} ${count}`)
        return builder
      },
      single: async () => (name === "profiles" ? { data: { workspace_id: WORKSPACE_ID }, error: null } : { data: null, error: null }),
      // The dedupe lookup and the dimension backfill both end here; the backfill
      // is the one preceded by an `eq` on logo_assets.id.
      maybeSingle: async () => {
        if (name !== "logo_assets" || !state.liveAsset) return { data: null, error: null }
        const backfill = state.patched.length > 0
        const row = state.liveAsset
        if (!backfill) return { data: row, error: null }
        return { data: { width: row.width, height: row.height }, error: null }
      },
      insert: async (row: Record<string, unknown>) => {
        record(`insert ${name}`)
        state.inserted.push(row)
        return { data: null, error: null }
      },
      update: (patch: Record<string, unknown>) => {
        record(`update ${name}`)
        return {
          eq: (_column: string, value: string) => {
            state.patched.push({ id: value, patch })
            return {
              select: () => ({
                maybeSingle: async () => ({ data: { width: patch.width ?? null, height: patch.height ?? null }, error: null }),
              }),
            }
          },
        }
      },
      delete: () => {
        record(`delete ${name}`)
        return {
          eq: (_column: string, value: string) => {
            state.deleted.push(value)
            return Promise.resolve({ data: null, error: null })
          },
        }
      },
    }
    return builder
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: table,
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploads.push(path)
          return { error: null }
        },
        remove: async (paths: string[]) => {
          state.removals.push(...paths)
          return { error: null }
        },
        createSignedUrl: async () => ({ data: { signedUrl: SIGNED_URL }, error: null }),
      }),
    },
    rpc: async (name: string, args: { p_logo_asset_id: string | null }) => {
      record(`rpc ${name}`)
      if (name !== "set_current_logo") return { data: null, error: null }
      if (args.p_logo_asset_id) state.activated.push(args.p_logo_asset_id)
      return { data: state.activateSucceeds, error: null }
    },
  }
}

let state: FakeState

function uploadRequest(file: File) {
  const form = new FormData()
  form.append("file", file)
  form.append("width", "800")
  form.append("height", "600")
  return new Request("https://example.test/api/seller-logo", { method: "POST", body: form })
}

const pngUpload = (seed = 1) => uploadRequest(new File([logoBytes(seed)], "logo.png", { type: "image/png" }))

const liveAsset = (overrides: Partial<AssetRow> = {}): AssetRow => ({
  id: "asset-1",
  storage_path: "workspaces/w1/logos/asset-1.png",
  mime_type: "image/png",
  byte_size: 16,
  width: 800,
  height: 600,
  ...overrides,
})

const withLiveAsset = (asset: AssetRow, activateSucceeds = true) => {
  state = newState({ liveAsset: asset, activateSucceeds })
  createSupabaseServerClient.mockImplementation(async () => fakeSupabase(state))
}

beforeEach(() => {
  state = newState()
  createSupabaseServerClient.mockReset()
  createSupabaseServerClient.mockImplementation(async () => fakeSupabase(state))
})

describe("seller logo upload", () => {
  it("stores a content hash of the bytes, not a size and mtime pair", async () => {
    const response = await POST(pngUpload())
    expect(response.status).toBe(201)
    expect(state.inserted[0].content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(String(state.inserted[0].content_hash)).not.toContain(":")
  })

  it("gives two different images two different assets", async () => {
    await POST(pngUpload(1))
    const firstHash = state.inserted[0].content_hash
    state.inserted = []
    await POST(pngUpload(2))
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0].content_hash).not.toBe(firstHash)
    expect(state.uploads).toHaveLength(2)
  })

  it("reuses the existing asset when the same image is uploaded again", async () => {
    withLiveAsset(liveAsset())
    const response = await POST(pngUpload())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.logo).toMatchObject({ id: "asset-1", url: SIGNED_URL, reused: true })
    // Nothing new is written: no object, no row, and the pointer moves back to the
    // asset the workspace already had.
    expect(state.uploads).toEqual([])
    expect(state.inserted).toEqual([])
    expect(state.activated).toEqual(["asset-1"])
  })

  it("only matches live assets, so a retired logo cannot be resurrected", async () => {
    await POST(pngUpload())
    expect(state.filters).toContain("is logo_assets.deleted_at=null")
  })

  it("fills in dimensions an earlier upload did not record", async () => {
    withLiveAsset(liveAsset({ width: null, height: null }))
    const response = await POST(pngUpload())
    expect(await response.json()).toMatchObject({ logo: { id: "asset-1", width: 800, height: 600 } })
    expect(state.patched).toHaveLength(1)
  })

  it("leaves recorded dimensions alone", async () => {
    withLiveAsset(liveAsset({ width: 1200, height: 900 }))
    const response = await POST(pngUpload())
    expect(await response.json()).toMatchObject({ logo: { width: 1200, height: 900 } })
    expect(state.patched).toEqual([])
  })

  it("reports a failed activation instead of silently reusing", async () => {
    withLiveAsset(liveAsset(), false)
    expect((await POST(pngUpload())).status).toBe(500)
  })
})


describe("seller logo upload failures", () => {
  it("cleans up the object when the row cannot be written", async () => {
    const working = fakeSupabase(state)
    createSupabaseServerClient.mockImplementation(async () => ({
      ...working,
      from: (name: string) => {
        if (name !== "logo_assets") return (working.from as (n: string) => unknown)(name)
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async () => ({ data: null, error: { message: "insert failed" } }),
        }
        return builder
      },
    }))

    const response = await POST(pngUpload())
    expect(response.status).toBe(500)
    // The uploaded object is rolled back rather than orphaned in the bucket.
    expect(state.removals).toHaveLength(1)
  })

  it("rejects a file whose contents are not the type it claims", async () => {
    const response = await POST(uploadRequest(new File([new Uint8Array([1, 2, 3, 4])], "logo.png", { type: "image/png" })))
    expect(response.status).toBe(400)
    expect(state.uploads).toEqual([])
  })

  it("rejects an unsupported image type before touching the bucket", async () => {
    const response = await POST(uploadRequest(new File([logoBytes(1)], "logo.gif", { type: "image/gif" })))
    expect(response.status).toBe(400)
    expect(state.uploads).toEqual([])
  })

  it("rejects an oversized file", async () => {
    const response = await POST(uploadRequest(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" })))
    expect(response.status).toBe(400)
    expect(state.uploads).toEqual([])
  })

  it("requires authentication", async () => {
    const working = fakeSupabase(state)
    createSupabaseServerClient.mockImplementation(async () => ({
      ...working,
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    }))
    expect((await POST(pngUpload())).status).toBe(401)
  })
})

