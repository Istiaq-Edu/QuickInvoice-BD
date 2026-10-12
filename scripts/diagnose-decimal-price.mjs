// Reproduces the decimal-price path end to end as a signed-in user, and reports
// what the user is actually told.
//
// The price input is `type="number" step="any" inputMode="decimal"`, so the UI
// invites a decimal and a phone keypad shows a decimal point. The client sends
// `unitPrice: Number(line.unitPrice)` unrounded, and the server schema requires
// `z.number().int()`. This script confirms the consequence rather than assuming
// it: fill a complete invoice with a decimal price and read the save state and
// any message.
//
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-decimal-price.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const PROJECT_REF = "sqbpvpwroyrabfixfgkg"
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const EXP = Math.floor(Date.now() / 1000) + 3600
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "seller@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const SESSION = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub", user: USER }

const browser = await chromium.launch()

for (const price of ["1050", "10.5"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addCookies([{ name: COOKIE_NAME, value: `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64url")}`, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
  await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
  await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
  await context.route("**/api/**", (r) => {
    const { pathname } = new URL(r.request().url())
    if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: false }) })
    if (pathname === "/api/seller-logo") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null }) })
    if (pathname === "/api/template") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: null }) })
    if (pathname === "/api/invoices/drafts") {
      // Record what the client actually sent, then answer the way the real route
      // would: the zod schema rejects a non-integer unitPrice with a 400.
      const body = r.request().postDataJSON()
      const lines = body?.invoice?.lines ?? []
      const bad = lines.filter((l) => !Number.isInteger(l.unitPrice))
      console.log(`    [server] received unitPrice values: ${JSON.stringify(lines.map((l) => l.unitPrice))}`)
      if (bad.length > 0) {
        console.log(`    [server] -> 400 "Invoice data is invalid." (unitPrice must be an integer)`)
        return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Invoice data is invalid." }) })
      }
      console.log(`    [server] -> 200 draft saved`)
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "draft-1", version: 2 }) })
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
  })

  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45_000 })
  await page.waitForTimeout(1000)

  console.log(`\n=== unit price "${price}" ===`)

  // A complete invoice, so the autosave gate (which requires every required
  // field) actually fires and the save path is exercised.
  const step = async (name) => {
    const b = page.getByRole("navigation", { name: "Invoice steps" }).getByRole("button", { name, exact: false })
    if (await b.count()) { await b.click(); await page.waitForTimeout(200) }
  }
  await page.locator("#seller-company-name").fill("Dhaka Trading Co.")
  await page.locator("#seller-name").fill("Seller Name")
  await page.locator("#buyer-name").fill("Buyer Name")
  await page.locator("#buyer-phone").fill("01711000000")
  await page.locator("#description-1").fill("Consulting")
  await page.locator("#quantity-1").fill("1")
  await page.locator("#price-1").fill(price)
  await page.waitForTimeout(300)

  const shown = await page.evaluate(() => {
    const t = document.body.innerText
    const m = t.match(/Total[^0-9৳-]*([৳-]?[\d,]+)/)
    const status = t.match(/(Saved|Not saved|Saving|Conflict detected)/)
    return { total: m ? m[1] : null, saveState: status ? status[1] : null }
  })
  console.log(`    [ui] preview total: ${shown.total}   save status: ${shown.saveState}`)

  // Give the debounced autosave time to run.
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() => {
    const t = document.body.innerText
    const status = t.match(/(Saved|Not saved|Saving|Conflict detected)/)
    return status ? status[1] : null
  })
  console.log(`    [ui] save status after autosave: ${after}`)

  await context.close()
}

await browser.close()
