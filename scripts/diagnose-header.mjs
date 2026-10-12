// Dumps the invoice page header's children with their computed display, to
// settle whether the `Admin` link is really hidden below `sm`.
//
// The link is written as `${buttonVariants({ variant: "outline", size: "sm" })} hidden sm:inline-flex`,
// built by template literal rather than through `cn()`. `buttonVariants` already
// emits a `display` utility, so `hidden` and `inline-flex` both set `display` and
// the class-attribute order decides nothing -- the generated stylesheet does.
// Measured, not reasoned about.
//
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-header.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const EXP = Math.floor(Date.now() / 1000) + 3600
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "seller@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const SESSION = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub", user: USER }

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 320, height: 844 } })
await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/api/**", (r) => {
  const { pathname } = new URL(r.request().url())
  if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true }) })
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null, settings: {} }) })
})

const page = await context.newPage()
await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" })
await page.getByLabel("Email").fill("seller@example.com")
await page.getByLabel("Password").fill("stub-password")
await page.getByRole("button", { name: /^Sign in$/ }).click()
await page.waitForURL(`${BASE}/`, { timeout: 20_000 }).catch(() => {})
await page.waitForTimeout(1200)

for (const width of [320, 640, 768]) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(900)
  const r = await page.evaluate(() => {
    const header = document.querySelector("main > header")
    const container = header?.firstElementChild
    const out = { headerW: header ? Math.round(header.getBoundingClientRect().width) : null, containerW: container ? Math.round(container.getBoundingClientRect().width) : null, children: [] }
    if (!container) return out
    for (const child of container.children) {
      const cs = getComputedStyle(child)
      const b = child.getBoundingClientRect()
      out.children.push({
        tag: child.tagName.toLowerCase(),
        text: (child.textContent || "").trim().slice(0, 24),
        display: cs.display,
        left: Math.round(b.left),
        right: Math.round(b.right),
        w: Math.round(b.width),
        cls: (typeof child.className === "string" ? child.className : "").slice(0, 120),
        kids: Array.from(child.children).map((k) => {
          const kcs = getComputedStyle(k)
          const kb = k.getBoundingClientRect()
          return { tag: k.tagName.toLowerCase(), text: (k.textContent || "").trim().slice(0, 18), display: kcs.display, w: Math.round(kb.width), left: Math.round(kb.left) }
        }),
      })
    }
    return out
  })
  console.log(`\n=== ${width}px ===`)
  console.log(`header w=${r.headerW} container w=${r.containerW}`)
  for (const c of r.children) {
    console.log(`  <${c.tag}> "${c.text}" display=${c.display} w=${c.w} left=${c.left} right=${c.right}`)
    for (const k of c.kids) console.log(`      <${k.tag}> "${k.text}" display=${k.display} w=${k.w} left=${k.left}`)
  }
}

await context.close()
await browser.close()
