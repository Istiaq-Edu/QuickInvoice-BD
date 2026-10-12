// Finds what actually makes the document wider than the viewport.
//
// `scrollWidth - clientWidth` on the document says an overflow exists but not
// which element owns it, and the difference matters: an element inside its own
// `overflow-x-auto` container is a deliberate scroller, while an element that
// widens the page body is a bug. This walks every element and reports those
// whose painted box exceeds the viewport while NO ancestor clips horizontally.
//
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-overflow.mjs [--guest] [path]
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

const CUSTOMERS = Array.from({ length: 10 }, (_, i) => ({
  id: `cus-${i}`,
  companyName: "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited",
  name: "Mohammad Abdur Rahman Siddique",
  address: "House 42, Road 7, Block C, Banani, Dhaka 1213, Bangladesh",
  email: `accounts.payable.department.${i}@chittagongsteel.example.com`,
  phone: "+880 1711 000000",
  website: "https://chittagongsteel.example.com",
}))

const DIAG = (deviceWidth) => {
  const label = (el) => {
    let bit = el.tagName.toLowerCase()
    if (el.id) bit += `#${el.id}`
    else if (typeof el.className === "string" && el.className.trim()) bit += `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
    return bit
  }
  // Compared against the DEVICE width, not window.innerWidth. Under mobile
  // emulation Chromium expands the layout viewport to fit the content, so
  // innerWidth grows to match the overflow and every element then looks
  // "inside" it -- which is how a 691px-wide layout passed a 320px check.
  const vw = deviceWidth
  const over = []
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right <= vw + 1) continue
    over.push({ el, cs, r })
  }
  // Report only the OUTERMOST overflowing elements: if a parent also overflows,
  // the child is a consequence, not the cause. Filtering by "has a clipping
  // ancestor" instead hid the real culprit, because a clipped child still
  // reports its full layout width while the clip only masks the paint.
  const culprits = []
  for (const { el, cs, r } of over) {
    const parent = el.parentElement
    const parentOverflows = parent && parent !== document.body
      ? parent.getBoundingClientRect().right > vw + 1
      : false
    if (parentOverflows) continue
    const label = (node) => {
      let bit = node.tagName.toLowerCase()
      if (node.id) bit += `#${node.id}`
      else if (typeof node.className === "string" && node.className.trim()) bit += `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      return bit
    }
    const clips = []
    let n = el.parentElement
    while (n && n !== document.body) {
      const acs = getComputedStyle(n)
      if (["auto", "scroll", "hidden", "clip"].includes(acs.overflowX)) clips.push(`${label(n)}:${acs.overflowX}`)
      n = n.parentElement
    }
    culprits.push({
      path: label(el),
      right: Math.round(r.right),
      w: Math.round(r.width),
      overflow: `${cs.overflowX}/${cs.overflowY}`,
      minWidth: cs.minWidth,
      display: cs.display,
      gridCols: cs.gridTemplateColumns,
      clips: clips.slice(0, 3),
      text: (el.textContent || "").trim().slice(0, 40),
      parents: Array.from({ length: 3 }).reduce((acc, _, i) => {
        let m = el.parentElement
        for (let k = 0; k < i && m; k++) m = m.parentElement
        if (m && m !== document.body) acc.push(label(m))
        return acc
      }, []),
    })
  }
  return { deviceWidth, innerWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, culprits: culprits.slice(0, 14) }
}

const browser = await chromium.launch()
// Deliberately NOT `isMobile: true`. Under mobile emulation Chromium widens the
// layout viewport to fit overflowing content, which hides the very overflow this
// script exists to find. A narrow non-mobile viewport reproduces the same CSS
// viewport width without the shrink-to-fit behaviour.
const context = await browser.newContext({ viewport: { width: 320, height: 844 } })

await context.route("**/auth/v1/token**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
await context.route("**/api/**", (r) => {
  const { pathname } = new URL(r.request().url())
  if (pathname === "/api/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: true }) })
  if (pathname === "/api/customers") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ customers: CUSTOMERS }) })
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
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

for (const width of [320, 390, 768]) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(900)
  const d = await page.evaluate(DIAG, width)
  console.log(`\n=== ${GUEST ? "GUEST" : "AUTHED"} ${ROUTE} @ ${width}px ===`)
  console.log(`device=${d.deviceWidth} innerWidth=${d.innerWidth} docScrollWidth=${d.docScrollWidth} overflow=${d.docScrollWidth - d.deviceWidth}px`)
  if (d.culprits.length === 0) console.log("  no unclipped element exceeds the device width")
  for (const c of d.culprits) {
    console.log(`  <${c.path}> right=${c.right} w=${c.w} minWidth=${c.minWidth} ovf=${c.overflow} display=${c.display}`)
    if (c.gridCols && c.gridCols !== "none") console.log(`      grid-template-columns: ${c.gridCols}`)
    if (c.clips.length) console.log(`      clipping ancestors: ${c.clips.join(", ")}`)
    console.log(`      parents: ${c.parents.join("  <  ")}`)
    console.log(`      text: "${c.text}"`)
  }
}

await context.close()
await browser.close()
