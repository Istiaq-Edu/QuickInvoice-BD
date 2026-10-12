// Measures the LOGGED-IN surfaces.
//
// The guest audit measured `/` with no session, which renders fewer controls
// than the signed-in page: the header has one button instead of three, each step
// has one action button instead of two, there is no Finalize button, no admin
// nav, and none of the data tables exist. So "0 overflow as a guest" says
// nothing about the signed-in layout.
//
// Getting a real session would mean either provisioning test credentials or
// creating an account in the live project. Neither is necessary: auth on these
// pages is decided client-side by `supabase.auth.getUser()`, so stubbing the
// Supabase auth endpoints and the /api routes lets the app render its true
// signed-in layout against fixture data. Nothing is written anywhere.
//
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/measure-authed.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const PROJECT_REF = "sqbpvpwroyrabfixfgkg"

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// The client decodes the access token to read `exp`, so the token must be a
// well-formed JWT. Nothing verifies the signature: every auth endpoint is stubbed.
const EXP = Math.floor(Date.now() / 1000) + 60 * 60
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "seller@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const SESSION = {
  access_token: accessToken,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: EXP,
  refresh_token: "stub-refresh-token",
  user: USER,
}

const TEMPLATE = { accent: "emerald", showAddresses: true, showSellerContact: true, showBuyerContact: true, showNotes: true, showQuantityColumn: true, showPaidStamp: true }

// Deliberately hostile fixture content: long names, long emails, large amounts.
// A table that only fits because the data is short has not been tested.
const LONG_NAME = "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited"
const invoices = Array.from({ length: 12 }, (_, i) => ({
  id: `inv-${i}`,
  invoice_number: `INV-2026-${String(1200 + i).padStart(5, "0")}`,
  lifecycle_status: i % 5 === 0 ? "draft" : "finalized",
  issue_date: `2026-0${(i % 9) + 1}-1${i % 9}`,
  due_date: `2026-0${(i % 9) + 1}-2${i % 9}`,
  payment_status: ["unpaid", "partial", "paid", "overdue"][i % 4],
  total_amount: 1250000.5 + i * 987654.25,
  amount_paid: i % 3 === 0 ? 500000 : 0,
  paidOn: i % 3 === 0 ? "2026-05-05" : null,
  customer_snapshot: { companyName: LONG_NAME, name: "Abdullah Al Mamun Chowdhury" },
}))

const customers = Array.from({ length: 10 }, (_, i) => ({
  id: `cus-${i}`,
  companyName: LONG_NAME,
  name: "Mohammad Abdur Rahman Siddique",
  address: "House 42, Road 7, Block C, Banani, Dhaka 1213, Bangladesh",
  email: `accounts.payable.department.${i}@chittagongsteel.example.com`,
  phone: "+880 1711 000000",
  website: "https://chittagongsteel.example.com",
}))

const allowlist = Array.from({ length: 8 }, (_, i) => ({
  id: `al-${i}`,
  email: `very.long.administrator.address.${i}@some-organization.example.com`,
  normalizedEmail: `very.long.administrator.address.${i}@some-organization.example.com`,
  status: i % 3 === 0 ? "disabled" : "active",
  createdAt: "2026-01-01T00:00:00Z",
  removedAt: i % 3 === 0 ? "2026-06-01T00:00:00Z" : null,
  purgeCompletedAt: null,
  purgeJob: null,
}))

function apiFixture(pathname) {
  if (pathname === "/api/profile") return { isAdmin: true }
  if (pathname === "/api/template") return { settings: TEMPLATE }
  if (pathname === "/api/seller-profile") return { companyName: LONG_NAME, sellerName: "Mohammad Abdur Rahman Siddique", address: "House 42, Road 7, Banani, Dhaka 1213", email: "billing@chittagongsteel.example.com", phone: "+880 1711 000000", website: "https://chittagongsteel.example.com", logoAssetId: null, logoUrl: null }
  if (pathname === "/api/seller-logo") return { logo: null }
  if (pathname === "/api/customers") return { customers }
  if (pathname === "/api/invoices") return { invoices, totals: { outstanding: 4820000.75, received: 1500000, overdue: 2100000.5, overdueCount: 4 } }
  if (pathname === "/api/admin/allowlist") return { entries: allowlist }
  if (pathname === "/api/items") return { items: [] }
  if (pathname === "/api/note-templates") return { notes: [] }
  if (pathname === "/api/invoices/drafts") return { draft: null }
  return {}
}

const PROBE = () => {
  const AA_MIN = 24
  const path = (el) => {
    const bits = []
    let node = el
    while (node && node !== document.body && bits.length < 4) {
      let bit = node.tagName.toLowerCase()
      if (node.id) bit += `#${node.id}`
      else if (typeof node.className === "string" && node.className.trim())
        bit += `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      bits.unshift(bit)
      node = node.parentElement
    }
    return bits.join(" > ")
  }

  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const bleed = []
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right - window.innerWidth > 1.5) {
      bleed.push({ path: path(el), right: Math.round(r.right), w: Math.round(r.width), text: (el.textContent || "").trim().slice(0, 32) })
    }
  }

  const small = []
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || el.classList.contains("sr-only")) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.height < AA_MIN) small.push({ path: path(el), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 34), w: Math.round(r.width), h: Math.round(r.height) })
  }

  // Wide data tables are the classic mobile failure. Report the scroller state
  // rather than the overflow, because a clipped table inside its own scroll
  // container is a legitimate pattern and a table spilling the page is not.
  const tables = []
  for (const el of document.querySelectorAll("table, [role='table'], ol.surface, .overflow-x-auto")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none") continue
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    tables.push({
      path: path(el),
      w: Math.round(r.width),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      overflowX: cs.overflowX,
      right: Math.round(r.right),
    })
  }

  return { docOverflow, bleedCount: bleed.length, bleed: bleed.slice(0, 10), smallCount: small.length, small: small.slice(0, 10), tables: tables.slice(0, 6) }
}

const ROUTES = ["/", "/invoices", "/customers", "/invoices/trash", "/account/settings", "/admin/allowlist"]

const browser = await chromium.launch()
// NOT `isMobile: true`. Under mobile emulation Chromium widens the layout
// viewport to fit overflowing content, so `innerWidth` grows to match the
// overflow and `scrollWidth - clientWidth` reads 0 even when the layout is
// 691px wide on a 320px device. A narrow non-mobile viewport reproduces the same
// CSS viewport without that shrink-to-fit behaviour, which is what makes the
// overflow visible to the measurement.
const context = await browser.newContext({ viewport: { width: 320, height: 844 } })

await context.route("**/auth/v1/token**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/auth/v1/user**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }))
await context.route("**/api/**", (route) => {
  const { pathname } = new URL(route.request().url())
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiFixture(pathname)) })
})

const page = await context.newPage()

// Sign in through the app's own form so the client persists the session in
// whatever format it uses, rather than guessing the cookie shape.
await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" })
await page.getByLabel("Email").fill("seller@example.com")
await page.getByLabel("Password").fill("stub-password")
await page.getByRole("button", { name: /^Sign in$/ }).click()
await page.waitForURL(`${BASE}/`, { timeout: 20_000 }).catch(() => {})
await page.waitForTimeout(1200)

const signedIn = await page.evaluate(() => document.body.innerText.includes("Sign out") || document.body.innerText.includes("seller@example.com"))
console.log(`session established: ${signedIn ? "YES" : "NO -- measurements below are the GUEST page and are not valid"}\n`)

for (const width of [320, 390, 768]) {
  await page.setViewportSize({ width, height: 844 })
  console.log(`\n############ ${width}px ############`)
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {})
    await page.waitForTimeout(900)
    // /admin/allowlist is a server component that redirects unless a real
    // server-side session exists. Route stubbing cannot fake that, so a
    // redirect to the login page is reported rather than measured as if it
    // were the admin screen.
    const landed = new URL(page.url()).pathname
    if (landed !== route) {
      console.log(`  ${route}  SKIPPED -- server-side redirect to ${landed} (needs a real session)`)
      continue
    }
    const r = await page.evaluate(PROBE)
    const bad = r.docOverflow > 1 || r.bleedCount > 0 || r.smallCount > 0
    console.log(`  ${route}  docOverflowX=${r.docOverflow}  bleed=${r.bleedCount}  belowAA=${r.smallCount}${bad ? "   <-- ISSUE" : ""}`)
    for (const b of r.bleed) console.log(`      bleed right=${b.right} (vw=${width}) w=${b.w} "${b.text}" ${b.path}`)
    for (const s of r.small) console.log(`      belowAA ${s.w}x${s.h} "${s.label}" ${s.path}`)
    for (const t of r.tables) {
      const clipped = t.scrollW > t.clientW + 1
      const escapes = t.right > width + 1
      if (clipped || escapes) console.log(`      table w=${t.w} scroll=${t.scrollW} client=${t.clientW} overflowX=${t.overflowX} right=${t.right}${escapes ? "  <-- SPILLS PAGE" : ""} ${t.path}`)
    }
  }
}

await context.close()
await browser.close()
