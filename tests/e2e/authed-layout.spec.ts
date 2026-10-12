import { expect, test, type BrowserContext, type Page } from "@playwright/test"

/**
 * Layout guard for the signed-in surfaces.
 *
 * The guest homepage and the signed-in pages are not the same layout, and a
 * mobile audit of `/` as a guest passes while the signed-in pages overflow.
 * Three separate defects hid behind that gap:
 *
 *   - `SignOutButton` hardcoded `w-full`, which is right inside the mobile
 *     dropdown but wrong in the invoice header where the button is inline at
 *     every width. It demanded 318px on a 320px screen.
 *   - The `Admin` header link was written as
 *     `${buttonVariants({...})} hidden sm:inline-flex`, built by template literal
 *     rather than through `cn`. `buttonVariants` already emits a `display`
 *     utility, so `hidden` and `inline-flex` both set `display` and the
 *     generated stylesheet order decided the winner -- `inline-flex` won, and an
 *     `sm`-only control rendered at 320px.
 *   - The customer directory printed an email in a `<p>` with no wrapping
 *     control. An email has no spaces, so it could not break and spilled 142px.
 *
 * None of those are visible to a unit test, and all three are invisible to a
 * guest audit. What they share is a symptom: the document becomes wider than the
 * viewport. So that is what this asserts, on every signed-in route, at the
 * narrow widths the app claims to support.
 *
 * Auth is decided client-side by `supabase.auth.getUser()`, so stubbing the
 * Supabase endpoints and `/api` lets the real signed-in layout render against
 * fixture data. Nothing is written anywhere, and no test account is needed.
 */

const PROJECT_REF = "sqbpvpwroyrabfixfgkg"

function b64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// The client decodes the access token to read `exp`, so it must be a well-formed
// JWT. The signature is never verified: every auth endpoint is stubbed below.
const EXP = Math.floor(Date.now() / 1000) + 3600
const ACCESS_TOKEN = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "00000000-0000-4000-8000-000000000001", email: "seller@example.com", role: "authenticated", exp: EXP })}.sig`

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

const SESSION = { access_token: ACCESS_TOKEN, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "stub-refresh-token", user: USER }

// Deliberately hostile fixture content. A layout that only fits because the data
// is short has not been tested: the email below is what broke the directory, and
// the company name is long enough to matter.
const LONG_COMPANY = "Chittagong Steel & Re-Rolling Mills (Pvt.) Limited"
const LONG_EMAIL = "accounts.payable.department.0@chittagongsteel.example.com"

const CUSTOMERS = Array.from({ length: 6 }, (_, i) => ({
  id: `cus-${i}`,
  companyName: LONG_COMPANY,
  name: "Mohammad Abdur Rahman Siddique",
  address: "House 42, Road 7, Block C, Banani, Dhaka 1213, Bangladesh",
  email: LONG_EMAIL.replace("0", String(i)),
  phone: "+880 1711 000000",
  website: "https://chittagongsteel.example.com",
}))

const INVOICES = Array.from({ length: 8 }, (_, i) => ({
  id: `inv-${i}`,
  invoice_number: `INV-2026-${String(1200 + i).padStart(5, "0")}`,
  lifecycle_status: i % 5 === 0 ? "draft" : "finalized",
  issue_date: "2026-05-11",
  due_date: "2026-05-25",
  payment_status: ["unpaid", "partial", "paid", "overdue"][i % 4],
  total_amount: 1250000.5 + i * 987654.25,
  amount_paid: i % 3 === 0 ? 500000 : 0,
  paidOn: i % 3 === 0 ? "2026-05-05" : null,
  customer_snapshot: { companyName: LONG_COMPANY, name: "Abdullah Al Mamun Chowdhury" },
}))

function apiFixture(pathname: string): unknown {
  if (pathname === "/api/profile") return { isAdmin: true }
  if (pathname === "/api/customers") return { customers: CUSTOMERS }
  if (pathname === "/api/invoices") return { invoices: INVOICES, totals: { outstanding: 4820000.75, received: 1500000, overdue: 2100000.5, overdueCount: 4 } }
  if (pathname === "/api/seller-logo") return { logo: null }
  if (pathname === "/api/template") return { settings: {} }
  if (pathname === "/api/admin/allowlist") return { entries: [] }
  if (pathname === "/api/items") return { items: [] }
  if (pathname === "/api/note-templates") return { notes: [] }
  return {}
}

async function stubSupabase(page: Page) {
  await page.route("**/auth/v1/token**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }))
  await page.route("**/auth/v1/user**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }))
  await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }))
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiFixture(pathname)) })
  })
}

/**
 * Seeds the session cookie directly instead of driving the login form.
 *
 * Driving the form worked but was flaky: it failed 2 of 9 runs even single-
 * threaded against a dev server, because the sign-in round trip and the
 * client-side redirect have to both land inside one timeout. The cookie name and
 * encoding were MEASURED, not assumed (scripts/diagnose-session-storage.mjs):
 * `sb-<projectRef>-auth-token`, value `base64-` + base64url of the session JSON.
 *
 * The risk with seeding is that it degrades quietly: if the format ever changes,
 * the app simply renders as a guest, and a guest layout has no overflow, so the
 * assertion would pass while testing nothing. `expectSignedIn` below is what
 * prevents that, and it runs on every route.
 */
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

async function seedSession(context: BrowserContext) {
  const value = `base64-${Buffer.from(JSON.stringify(SESSION)).toString("base64url")}`
  await context.addCookies([{ name: COOKIE_NAME, value, domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
}

/**
 * Fails loudly if the signed-in state is not present, so a broken session seed
 * cannot be mistaken for a passing layout.
 *
 * The marker differs by route because the signed-in chrome does. `/` shows the
 * sign-out button inline in its header at every width, so it can be asserted
 * directly. The workspace pages put sign-out inside a `lg:flex` nav or a closed
 * `<details>` menu, so at 320-768px it is not in the accessibility tree at all --
 * asserting on it there failed even with a valid session. Those pages instead
 * render a "Sign in to continue" gate when the session is missing, so its
 * ABSENCE is the signal.
 */
async function expectSignedIn(page: Page, route: string) {
  if (route === "/") {
    await expect(
      page.getByRole("button", { name: /sign out/i }).first(),
      "session was not established -- the layout below would be the guest layout",
    ).toBeAttached()
    return
  }
  await expect(
    page.getByRole("link", { name: /sign in to continue/i }),
    "session was not established -- this page rendered its signed-out gate instead of the workspace",
  ).toHaveCount(0)
}

// `/admin/allowlist` is a server component that redirects unless a real
// server-side session exists, and route stubbing cannot fake a server-side
// Supabase call. It is excluded rather than silently measured as the login page.
const AUTHED_ROUTES = ["/", "/invoices", "/customers", "/invoices/trash", "/account/settings"] as const

const NARROW_WIDTHS = [320, 390, 768] as const

test.describe("signed-in layout", () => {
  // Against a dev server that compiles routes on demand, the first hit to a
  // route can take longer than the default timeout. This spec visits five routes
  // per test, so it needs more room than the default.
  test.describe.configure({ timeout: 120_000 })

  for (const width of NARROW_WIDTHS) {
    test(`no page overflows the viewport at ${width}px`, async ({ page, context }) => {
      // Runs once, in the desktop project, rather than once per project.
      //
      // The viewport is set explicitly below, so running under all three
      // projects tripled the work for identical results -- and the mobile
      // projects use `isMobile: true`, which is actively wrong here: Chromium
      // widens the layout viewport to fit overflowing content, so the very
      // overflow this spec exists to catch reports as zero. Coverage of the
      // mobile widths comes from `width` below, not from the project.
      test.skip(test.info().project.name !== "desktop", "covered by the desktop project; mobile emulation masks horizontal overflow")

      await stubSupabase(page)
      await seedSession(context)
      await page.setViewportSize({ width, height: 844 })

      for (const route of AUTHED_ROUTES) {
        // `networkidle` is the obvious wait and the wrong one here: a dev-server
        // compile can blow the timeout, and the failure then reads as a layout
        // failure. Waiting for the page's own loading indicator to clear is both
        // faster and more meaningful -- it means the data the layout depends on
        // has actually rendered, so the measurement is of the real page.
        await page.goto(route, { waitUntil: "domcontentloaded" })
        await page
          .waitForFunction(() => !/loading/i.test(document.body.innerText), null, { timeout: 60_000 })
          .catch(() => undefined)
        await page.waitForTimeout(400)

        // Checked per route, not once, because a redirect would otherwise turn
        // the rest of this test into a guest measurement.
        await expectSignedIn(page, route)

        const overflow = await page.evaluate(() => {
          const html = document.documentElement
          const offenders: string[] = []
          for (const el of document.querySelectorAll("body *")) {
            const cs = getComputedStyle(el)
            if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            // An element inside its own horizontal scroller is a deliberate
            // pattern (the mobile step bar), so only report elements no ancestor
            // clips.
            let clipped = false
            let node = el.parentElement
            while (node && node !== document.body) {
              const acs = getComputedStyle(node)
              if (["auto", "scroll", "hidden", "clip"].includes(acs.overflowX)) { clipped = true; break }
              node = node.parentElement
            }
            if (clipped) continue
            if (r.right > window.innerWidth + 1) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
          }
          return { scrollWidth: html.scrollWidth, clientWidth: html.clientWidth, offenders: offenders.slice(0, 5) }
        })

        expect(
          overflow.scrollWidth - overflow.clientWidth,
          `${route} overflows at ${width}px. Widest unclipped elements: ${overflow.offenders.join(" | ") || "(none reported)"}`,
        ).toBeLessThanOrEqual(1)
      }
    })
  }
})
