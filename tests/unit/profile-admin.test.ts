import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createSupabaseServerClient = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}))

import { GET } from "../../app/api/profile/route"

const AUTH_USER = { id: "user-1", email: "admin@example.com" }

function clientStub(overrides: Record<string, unknown> = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: AUTH_USER }, error: null }) },
    from: vi.fn(() => {
      throw new Error("/api/profile must not read the profiles table directly; drift guard")
    }),
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    ...overrides,
  }
}

beforeEach(() => {
  createSupabaseServerClient.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/profile", () => {
  it("returns 503 when Supabase is not configured", async () => {
    createSupabaseServerClient.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(503)
  })

  it("returns 401 for an unauthenticated visitor", async () => {
    createSupabaseServerClient.mockResolvedValue(
      clientStub({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } }),
    )
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it("reports isAdmin true for an active admin with an active workspace", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    createSupabaseServerClient.mockResolvedValue(clientStub({ rpc }))

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ isAdmin: true })
    expect(rpc).toHaveBeenCalledWith("current_profile_is_admin")
  })

  it("reports isAdmin false when the database denies admin", async () => {
    createSupabaseServerClient.mockResolvedValue(
      clientStub({ rpc: vi.fn().mockResolvedValue({ data: false, error: null }) }),
    )
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ isAdmin: false })
  })

  it("never caches the admin decision", async () => {
    createSupabaseServerClient.mockResolvedValue(clientStub())
    const response = await GET()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("fails closed with 500 when the admin check errors", async () => {
    createSupabaseServerClient.mockResolvedValue(
      clientStub({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) }),
    )
    const response = await GET()
    expect(response.status).toBe(500)
  })
})
