// Measures the /invoices filter section on a phone: how tall it is, how much
// vertical space it consumes before the first invoice row is reachable, and how
// wide each control ends up.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-invoice-filters.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const PROJECT_REF = "sqbpvpwroyrabfixfgkg"
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

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
  payment_status: "unpaid",
  total_amount: 1250000,
  amount_paid: 0,
  paidOn: null,
  customer_snapshot: { companyName: "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited", name: "Abdullah Al Mamun" },
}))

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
await context.addCookies([{ name: COOKIE_NAME, value: `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64url")}`, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/api/**", (r) => {
  const { pathname } = new URL(r.request().url())
  if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true }) })
  if (pathname === "/api/invoices") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invoices: INVOICES, totals: { outstanding: 4820000, received: 1500000, overdue: 2100000, overdueCount: 4 } }) })
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
})

const page = await context.newPage()

for (const width of [320, 390]) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`${BASE}/invoices`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => !/loading/i.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(600)

  const r = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Invoice history filters"]')
    if (!section) return null
    const sr = section.getBoundingClientRect()
    const controls = []
    for (const el of section.querySelectorAll("input, select, button")) {
      const b = el.getBoundingClientRect()
      if (b.width === 0) continue
      controls.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "").trim().slice(0, 26),
        w: Math.round(b.width),
        h: Math.round(b.height),
        top: Math.round(b.top),
      })
    }
    // Vertical distance from the top of the filter panel to the first invoice row.
    const firstRow = document.querySelector("main ol > li, main [role='list'] > *")
    const firstRowTop = firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null
    return {
      sectionTop: Math.round(sr.top),
      sectionHeight: Math.round(sr.height),
      viewportH: window.innerHeight,
      controls,
      firstRowTop,
      rowsDistinctTops: [...new Set(controls.map((c) => c.top))].length,
    }
  })

  console.log(`\n=== /invoices @ ${width}px ===`)
  if (!r) { console.log("  filter section not found"); continue }
  console.log(`  filter panel: top=${r.sectionTop} height=${r.sectionHeight}px  (viewport ${r.viewportH})`)
  console.log(`  controls: ${r.controls.length} across ${r.rowsDistinctTops} stacked rows`)
  for (const c of r.controls) console.log(`    ${c.tag.padEnd(6)} w=${String(c.w).padStart(4)} h=${c.h} top=${c.top}  "${c.label}"`)
  if (r.firstRowTop !== null) console.log(`  first invoice row top: ${r.firstRowTop}px  -> ${Math.round((r.firstRowTop / r.viewportH) * 100)}% down the viewport`)
}

await context.close()
await browser.close()
