// Tests whether seeding the Supabase session cookie directly is enough to make
// the app render signed-in, and reports what the app actually sees.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-cookie-seed.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const PROJECT_REF = "sqbpvpwroyrabfixfgkg"
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const EXP = Math.floor(Date.now() / 1000) + 3600
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "seller@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const SESSION = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub-refresh", user: USER }

const browser = await chromium.launch()

for (const mode of ["domain", "url", "base64-std"]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
  await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
  await context.route("**/api/**", (r) => {
    const { pathname } = new URL(r.request().url())
    if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true }) })
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null, settings: {} }) })
  })

  const encoded = mode === "base64-std"
    ? `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64").replace(/=+$/, "")}`
    : `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64url")}`

  const cookie = mode === "url"
    ? { name: COOKIE_NAME, value: encoded, url: BASE, path: "/", httpOnly: false, secure: false, sameSite: "Lax" }
    : { name: COOKIE_NAME, value: encoded, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }
  await context.addCookies([cookie])

  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45_000 })
  await page.waitForTimeout(1500)

  const seen = await page.evaluate((name) => ({
    cookiePresent: document.cookie.includes(name),
    cookieLen: (document.cookie.split("; ").find((c) => c.startsWith(`${name}=`)) || "").length,
    hasSignOut: /sign out/i.test(document.body.innerText),
    hasSignIn: /sign in/i.test(document.body.innerText),
    headerText: (document.querySelector("main > header")?.innerText || "").replace(/\s+/g, " ").slice(0, 90),
  }), COOKIE_NAME)

  console.log(`\n=== mode=${mode} ===`)
  console.log(`  cookie present in document.cookie: ${seen.cookiePresent} (len ${seen.cookieLen})`)
  console.log(`  header shows "sign out": ${seen.hasSignOut}`)
  console.log(`  header shows "sign in" : ${seen.hasSignIn}`)
  console.log(`  header text: "${seen.headerText}"`)

  const stored = await context.cookies()
  console.log(`  context cookies after load: ${stored.map((c) => `${c.name}(len ${c.value.length})`).join(", ") || "none"}`)
  await context.close()
}

await browser.close()
