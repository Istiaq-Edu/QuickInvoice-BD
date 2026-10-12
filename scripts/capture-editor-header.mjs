// Captures the signed-in editor header with the account menu open, so the
// collapse can be judged visually.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/capture-editor-header.mjs
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

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await context.addCookies([{ name: `sb-${PROJECT_REF}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64url")}`, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/api/**", (r) => {
  const { pathname } = new URL(r.request().url())
  if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true }) })
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null, settings: {} }) })
})

const page = await context.newPage()
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1800)

await page.screenshot({ path: `${OUT}/editor-320-header-closed.png` })

const menu = page.locator("main > header details summary")
console.log(`menu summary count: ${await menu.count()}`)
await menu.first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/editor-320-header-open.png` })

const items = await page.evaluate(() => {
  const panel = document.querySelector("main > header details div")
  if (!panel) return []
  return Array.from(panel.querySelectorAll("a, button")).map((el) => {
    const r = el.getBoundingClientRect()
    return { text: (el.textContent || "").trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }
  })
})
console.log(`menu items: ${items.length}`)
for (const i of items) console.log(`  "${i.text}" ${i.w}x${i.h}`)

await context.close()
await browser.close()
console.log(`captured to ${OUT}`)
