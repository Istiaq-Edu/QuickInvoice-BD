import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createSupabaseAdminClient = vi.fn()

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClient(),
}))

import { GET, POST } from "../../app/api/internal/purge/route"

const CRON_SECRET = "test-cron-secret-value"
const originalEnv = { ...process.env }

function adminStub(overrides: Record<string, unknown> = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  }
}

function withHeaders(headers: Record<string, string>) {
  return new Request("https://example.test/api/internal/purge", { method: "GET", headers })
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key"
  createSupabaseAdminClient.mockReset()
  createSupabaseAdminClient.mockReturnValue(adminStub())
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("purge worker authentication", () => {
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

  it("returns 401 for an incorrect bearer secret", async () => {
    const response = await GET(withHeaders({ authorization: "Bearer wrong-secret" }))
    expect(response.status).toBe(401)
  })

  it("returns 401 for a same-length but incorrect secret", async () => {
    const wrong = "x".repeat(CRON_SECRET.length)
    const response = await GET(withHeaders({ authorization: `Bearer ${wrong}` }))
    expect(response.status).toBe(401)
  })

  it("returns 401 for an empty bearer value", async () => {
    const response = await GET(withHeaders({ authorization: "Bearer " }))
    expect(response.status).toBe(401)
  })

  it("accepts the Bearer header Vercel Cron sends on GET", async () => {
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ claimed: 0, completed: 0, failed: [] })
  })

  it("accepts the x-cron-secret header", async () => {
    const response = await GET(withHeaders({ "x-cron-secret": CRON_SECRET }))
    expect(response.status).toBe(200)
  })

  it("keeps POST working for manual and retry runs", async () => {
    const response = await POST(
      new Request("https://example.test/api/internal/purge", {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )
    expect(response.status).toBe(200)
  })

  it("does not expose a purge job id or user id in a failure response", async () => {
    createSupabaseAdminClient.mockReturnValue(
      adminStub({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "relation account_purge_jobs does not exist" },
        }),
      }),
    )
    const response = await GET(withHeaders({ authorization: `Bearer ${CRON_SECRET}` }))
    const body = await response.text()
    expect(response.status).toBe(500)
    expect(body).not.toMatch(/account_purge_jobs/)
  })
})
