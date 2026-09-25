import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createSupabaseAdminClient = vi.fn()

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClient(),
}))

import { GET, POST } from "../../app/api/internal/logo-gc/route"

const CRON_SECRET = "test-cron-secret-value"
const originalEnv = { ...process.env }

type AdminStubOptions = {
  retired?: string[]
  pending?: Array<{ id: string; storage_path: string }>
  rpcError?: { message: string } | null
  listError?: { message: string } | null
  removeError?: { message: string } | null
}

/**
 * Records what the worker did to storage and to the table, because the ordering
 * between the two is the property that makes a sweep safe to retry.
 */
function adminStub(options: AdminStubOptions = {}) {
  const removed: string[][] = []
  const stamped: string[][] = []
  const storage = {
    from: vi.fn(() => ({
      remove: vi.fn(async (paths: string[]) => {
        removed.push(paths)
        return { error: options.removeError ?? null }
      }),
    })),
  }
  const admin = {
    rpc: vi.fn(async () => ({ data: options.retired ?? [], error: options.rpcError ?? null })),
    storage,
    from: vi.fn((table: string) => {
      if (table !== "logo_assets") throw new Error(`unexpected table ${table}`)
      const builder = {
        select: () => builder,
        not: () => builder,
        lt: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: options.pending ?? [], error: options.listError ?? null }),
        update: () => ({
          in: async (column: string, ids: string[]) => {
            if (column !== "id") throw new Error(`unexpected column ${column}`)
            stamped.push(ids)
            return { error: null }
          },
        }),
      }
      return builder
    }),
  }
  return { admin, removed, stamped }
}

function withHeaders(headers: Record<string, string>) {
  return new Request("https://example.test/api/internal/logo-gc", { method: "GET", headers })
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key"
  createSupabaseAdminClient.mockReset()
  createSupabaseAdminClient.mockReturnValue(adminStub().admin)
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("logo GC worker authentication", () => {
  it("returns 503 when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET
    const response = await GET(withHeaders({}))
    expect(response.status).toBe(503)
    expect(createSupabaseAdminClient).not.toHaveBeenCalled()
  })

  it("returns 503 when the service role key is unavailable", async () => {
    createSupabaseAdminClient.mockReturnValue(null)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(response.status).toBe(503)
  })

  it("returns 401 without credentials", async () => {
    const response = await GET(withHeaders({}))
    expect(response.status).toBe(401)
    expect(createSupabaseAdminClient).not.toHaveBeenCalled()
  })

  it("returns 401 for an incorrect secret of the same length", async () => {
    const response = await GET(withHeaders({ "x-cron-secret": "x".repeat(CRON_SECRET.length) }))
    expect(response.status).toBe(401)
  })

  it("accepts the cron bearer, the manual header and POST", async () => {
    expect((await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))).status).toBe(200)
    expect((await GET(withHeaders({ "x-cron-secret": CRON_SECRET }))).status).toBe(200)
    const posted = await POST(
      new Request("https://example.test/api/internal/logo-gc", { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    )
    expect(posted.status).toBe(200)
  })

describe("logo GC sweep", () => {
  it("retires first, then only removes objects that are already past the grace window", async () => {
    const stub = adminStub({ retired: ["a", "b"], pending: [{ id: "a", storage_path: "workspaces/w1/logos/a.png" }] })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ retired: 2, swept: 1, failed: [] })
    // Only the object listed as sweepable is removed, and it is removed before the
    // row is stamped, so a failure is retried on the next run instead of leaked.
    expect(stub.removed).toEqual([["workspaces/w1/logos/a.png"]])
    expect(stub.stamped).toEqual([["a"]])
  })

  it("does nothing destructive when there is nothing to sweep", async () => {
    const stub = adminStub({ retired: [], pending: [] })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(await response.json()).toMatchObject({ retired: 0, swept: 0, failed: [] })
    expect(stub.removed).toEqual([])
    expect(stub.stamped).toEqual([])
  })

  it("leaves an asset unstamped when its object cannot be removed", async () => {
    const stub = adminStub({
      retired: [],
      pending: [{ id: "a", storage_path: "workspaces/w1/logos/a.png" }],
      removeError: { message: "storage exploded" },
    })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(await response.json()).toMatchObject({ swept: 0, failed: ["storage_remove_failed"] })
    // The stamp is what stops the next run from retrying, so it must not be
    // written while the object is still in the bucket.
    expect(stub.stamped).toEqual([])
  })

  it("keeps sweeping after one asset fails", async () => {
    const stub = adminStub({
      retired: [],
      pending: [
        { id: "a", storage_path: "workspaces/w1/logos/a.png" },
        { id: "b", storage_path: "workspaces/w1/logos/b.png" },
      ],
    })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(await response.json()).toMatchObject({ swept: 2, failed: [] })
    expect(stub.stamped).toEqual([["a"], ["b"]])
  })

  it("passes the retention policy to the database", async () => {
    const stub = adminStub({ retired: [], pending: [] })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(stub.admin.rpc).toHaveBeenCalledWith("mark_unused_logo_assets", { p_retention_days: 30, p_limit: 500 })
  })

  it("fails loudly without leaking database detail when retiring fails", async () => {
    const stub = adminStub({ rpcError: { message: "relation logo_assets does not exist" } })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    const body = await response.text()
    expect(response.status).toBe(500)
    expect(body).not.toMatch(/relation logo_assets/)
  })

  it("removes nothing when sweepable assets cannot be listed", async () => {
    const stub = adminStub({ retired: ["a"], listError: { message: "permission denied" } })
    createSupabaseAdminClient.mockReturnValue(stub.admin)
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(response.status).toBe(500)
    expect(stub.removed).toEqual([])
  })
})

})
