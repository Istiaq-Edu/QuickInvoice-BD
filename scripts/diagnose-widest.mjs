// Brute-force: dumps the elements with the largest right edge, plus the html and
// body box state, when a filtered search finds nothing but the document is still
// wider than the viewport. A filtered walk can miss the cause entirely — the
// overflow may come from a min-width on a wrapper, from a scroll container's own
// box, or from an element the filter excluded.
//
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-widest.mjs /customers
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const args = process.argv.slice(2)
const GUEST = args.includes("--guest")
const ROUTE = args.find((a) => a.startsWith("/")) ?? "/"

const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const EXP = Math.floor(Date.now() / 1000) + 3600
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "seller@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const SESSION = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub", user: USER }

const DUMP = (vw) => {
  const label = (el) => {
    let bit = el.tagName.toLowerCase()
    if (el.id) bit += `#${el.id}`
    else if (typeof el.className === "string" && el.className.trim()) bit += `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
    return bit
  }
  const html = document.documentElement
  const body = document.body
  const rows = []
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    rows.push({
      path: label(el),
      right: Math.round(r.right),
      left: Math.round(r.left),
      w: Math.round(r.width),
      pos: cs.position,
      minW: cs.minWidth,
      overflowX: cs.overflowX,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      text: (el.textContent || "").trim().slice(0, 30),
    })
  }
  rows.sort((a, b) => b.right - a.right)
  // The origin of an overflow is the innermost element whose own content box is
  // wider than its padding box while its overflow is visible -- that is what
  // propagates upward. It is reported separately because such an element can sit
  // entirely inside the viewport (its rect is small) while its CONTENT spills,
  // and because a pseudo-element can spill without any element rect showing it.
  const spillers = []
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    if (el.scrollWidth - el.clientWidth <= 1) continue
    if (cs.overflowX !== "visible") continue
    // Innermost only: skip if a descendant also spills.
    let hasSpillingChild = false
    for (const child of el.querySelectorAll("*")) {
      const ccs = getComputedStyle(child)
      if (ccs.display === "none") continue
      if (child.scrollWidth - child.clientWidth > 1 && ccs.overflowX === "visible") { hasSpillingChild = true; break }
    }
    if (hasSpillingChild) continue
    spillers.push({
      path: label(el),
      w: Math.round(el.getBoundingClientRect().width),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      spill: el.scrollWidth - el.clientWidth,
      text: (el.textContent || "").trim().slice(0, 40),
    })
  }
  return {
    vw,
    html: { scrollW: html.scrollWidth, clientW: html.clientWidth, minW: getComputedStyle(html).minWidth, overflowX: getComputedStyle(html).overflowX },
    body: { scrollW: body.scrollWidth, clientW: body.clientWidth, minW: getComputedStyle(body).minWidth, overflowX: getComputedStyle(body).overflowX },
    widest: rows.slice(0, 8),
    spillers: spillers.slice(0, 10),
  }
}

const CUSTOMERS = Array.from({ length: 10 }, (_, i) => ({
  id: `cus-${i}`,
  companyName: "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited",
  name: "Mohammad Abdur Rahman Siddique",
  address: "House 42, Road 7, Block C, Banani, Dhaka 1213, Bangladesh",
  email: `accounts.payable.department.${i}@chittagongsteel.example.com`,
  phone: "+880 1711 000000",
  website: "https://chittagongsteel.example.com",
}))

const INVOICES = Array.from({ length: 12 }, (_, i) => ({
  id: `inv-${i}`,
  invoice_number: `INV-2026-${String(1200 + i).padStart(5, "0")}`,
  lifecycle_status: i % 5 === 0 ? "draft" : "finalized",
  issue_date: "2026-05-11",
  due_date: "2026-05-25",
  payment_status: ["unpaid", "partial", "paid", "overdue"][i % 4],
  total_amount: 1250000.5 + i * 987654.25,
  amount_paid: i % 3 === 0 ? 500000 : 0,
  paidOn: i % 3 === 0 ? "2026-05-05" : null,
  customer_snapshot: { companyName: "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited", name: "Abdullah Al Mamun Chowdhury" },
}))

function fixture(pathname) {
  if (pathname === "/api/profile") return { isAdmin: true }
  if (pathname === "/api/customers") return { customers: CUSTOMERS }
  if (pathname === "/api/invoices") return { invoices: INVOICES, totals: { outstanding: 4820000.75, received: 1500000, overdue: 2100000.5, overdueCount: 4 } }
  if (pathname === "/api/admin/allowlist") return { entries: [] }
  if (pathname === "/api/seller-logo") return { logo: null }
  if (pathname === "/api/template") return { settings: {} }
  return {}
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 320, height: 844 } })
await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/api/**", (r) => {
  const { pathname } = new URL(r.request().url())
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture(pathname)) })
})

const page = await context.newPage()
if (!GUEST) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" })
  await page.getByLabel("Email").fill("seller@example.com")
  await page.getByLabel("Password").fill("stub-password")
  await page.getByRole("button", { name: /^Sign in$/ }).click()
  await page.waitForURL(`${BASE}/`, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1000)
}

for (const width of [320]) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(900)
  const d = await page.evaluate(DUMP, width)
  console.log(`\n=== ${GUEST ? "GUEST" : "AUTHED"} ${ROUTE} @ ${width}px ===`)
  console.log(`html  scrollW=${d.html.scrollW} clientW=${d.html.clientW} minW=${d.html.minW} overflowX=${d.html.overflowX}`)
  console.log(`body  scrollW=${d.body.scrollW} clientW=${d.body.clientW} minW=${d.body.minW} overflowX=${d.body.overflowX}`)
  console.log(`-- widest elements by right edge --`)
  for (const r of d.widest) {
    console.log(`  right=${r.right} left=${r.left} w=${r.w} pos=${r.pos} minW=${r.minW} ovf=${r.overflowX} scrollW=${r.scrollW} clientW=${r.clientW} <${r.path}> "${r.text}"`)
  }
  console.log(`-- innermost elements whose own content spills (overflow visible) --`)
  if (d.spillers.length === 0) console.log("  none")
  for (const s of d.spillers) {
    console.log(`  spill=${s.spill}px w=${s.w} scrollW=${s.scrollW} clientW=${s.clientW} <${s.path}> "${s.text}"`)
  }
}

await context.close()
await browser.close()
