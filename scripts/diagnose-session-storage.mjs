// Reports exactly where the Supabase browser client persists the session after a
// real sign-in, so a test can seed it deterministically instead of driving the
// login form (which is slow and flaky against a dev server).
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-session-storage.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const EXP = Math.floor(Date.now() / 1000) + 3600
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "seller@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const SESSION = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub-refresh", user: USER }

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true, logo: null, settings: {} }) }))

const page = await context.newPage()
await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" })
await page.getByLabel("Email").fill("seller@example.com")
await page.getByLabel("Password").fill("stub-password")
await page.getByRole("button", { name: /^Sign in$/ }).click()
await page.waitForURL(`${BASE}/`, { timeout: 30_000 }).catch(() => {})
await page.waitForTimeout(1200)

const cookies = await context.cookies()
console.log(`cookies (${cookies.length}):`)
for (const c of cookies) {
  console.log(`  name=${c.name}`)
  console.log(`    domain=${c.domain} path=${c.path} httpOnly=${c.httpOnly} secure=${c.secure} len=${c.value.length}`)
  // The value is prefixed, so decode it to confirm the exact encoding a test
  // must reproduce rather than guessing base64 vs base64url.
  const prefix = c.value.startsWith("base64-") ? "base64-" : "(no prefix)"
  const payload = c.value.startsWith("base64-") ? c.value.slice("base64-".length) : c.value
  console.log(`    prefix=${prefix}`)
  console.log(`    hasPlus=${payload.includes("+")} hasSlash=${payload.includes("/")} hasDash=${payload.includes("-")} hasUnderscore=${payload.includes("_")} hasPadding=${payload.endsWith("=")}`)
  for (const enc of ["base64", "base64url"]) {
    try {
      const decoded = Buffer.from(payload, enc).toString("utf8")
      const parsed = JSON.parse(decoded)
      console.log(`    decodes as ${enc}: YES  keys=${JSON.stringify(Object.keys(parsed))}`)
    } catch (error) {
      console.log(`    decodes as ${enc}: no (${String(error).slice(0, 60)})`)
    }
  }
}

const storage = await page.evaluate(() => {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    out[k] = String(localStorage.getItem(k)).slice(0, 80)
  }
  return out
})
console.log(`localStorage keys: ${JSON.stringify(Object.keys(storage))}`)
for (const [k, v] of Object.entries(storage)) console.log(`  ${k} = ${v}…`)

await context.close()
await browser.close()
