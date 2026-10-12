// Captures the /invoices filter area on a phone so the narrower selects can be
// judged by eye rather than by width alone.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/capture-invoice-filters.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const OUT = "docs/operations/mobile-review"
mkdirSync(OUT, { recursive: true })

const PROJECT_REF = "sqbpvpwroyrabfixfgkg"
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const EXP = Math.floor(Date.now() / 1000) + 3600
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "seller@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const SESSION = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub", user: USER }

const INVOICES = Array.from({ length: 6 }, (_, i) => ({
  id: `inv-${i}`,
  invoice_number: `INV-2026-0120${i}`,
  lifecycle_status: "finalized",
  issue_date: "2026-05-11",
  due_date: "2026-05-25",
  payment_status: ["unpaid", "partial", "paid", "overdue"][i % 4],
  total_amount: 1250000 + i * 100000,
  amount_paid: i % 3 === 0 ? 500000 : 0,
  paidOn: i % 3 === 0 ? "2026-05-05" : null,
  customer_snapshot: { companyName: "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited", name: "Abdullah Al Mamun" },
}))

const browser = await chromium.launch()
for (const width of [320, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await context.addCookies([{ name: `sb-${PROJECT_REF}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64url")}`, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
  await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
  await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
  await context.route("**/api/**", (r) => {
    const { pathname } = new URL(r.request().url())
    if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true }) })
    if (pathname === "/api/invoices") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invoices: INVOICES, totals: { outstanding: 4820000, received: 1500000, overdue: 2100000, overdueCount: 4 } }) })
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/invoices`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => !/loading/i.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/invoices-${width}-filters.png` })
  await context.close()
}
await browser.close()
console.log(`captured to ${OUT}`)
