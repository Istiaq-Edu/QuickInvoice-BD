// Verifies that the mobile stepper's horizontal overflow is clipped by its own
// scroll container (intentional) rather than escaping the page, and measures the
// fixed bottom dock's occlusion with page scroll positions held constant.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-mobile-verify.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch()

for (const width of [320, 360, 390, 414]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  await stepper.getByRole("button", { name: "Items", exact: false }).click()
  await page.waitForTimeout(300)

  console.log(`\n=== ${width}px ===`)

  // 1. Is the stepper a real scroll container, and does it clip?
  const clip = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Invoice steps"]')
    const ol = nav?.querySelector("ol")
    if (!ol) return null
    const cs = getComputedStyle(ol)
    const olRect = ol.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    // Any descendant painted outside the ol's own box?
    let escaped = 0
    let maxRight = 0
    for (const li of ol.querySelectorAll("li")) {
      const r = li.getBoundingClientRect()
      maxRight = Math.max(maxRight, r.right)
      if (r.right - olRect.right > 1) escaped++
    }
    return {
      overflowX: cs.overflowX,
      scrollWidth: ol.scrollWidth,
      clientWidth: ol.clientWidth,
      scrollable: ol.scrollWidth - ol.clientWidth,
      olRight: Math.round(olRect.right),
      navRight: Math.round(navRect.right),
      liEscapingOlBox: escaped,
      maxLiRight: Math.round(maxRight),
      // Scrollability is only usable if the user can actually scroll it.
      touchAction: cs.touchAction,
    }
  })
  console.log(`stepper: overflowX=${clip.overflowX} scrollable=${clip.scrollable}px liOutsideOwnBox=${clip.liEscapingOlBox} olRight=${clip.olRight} maxLiRight=${clip.maxLiRight}`)
  console.log(`  -> clipped by own box: ${clip.liEscapingOlBox === 0 ? "YES (intentional scroller)" : "NO (real overflow)"}`)

  // 2. Can the scroller actually be scrolled to reach the last step?
  const reached = await page.evaluate(async () => {
    const ol = document.querySelector('nav[aria-label="Invoice steps"] ol')
    if (!ol) return null
    ol.scrollLeft = 99999
    await new Promise((r) => requestAnimationFrame(r))
    const last = ol.querySelector("li:last-child")
    const r = last.getBoundingClientRect()
    const page = window.innerWidth
    return { scrollLeft: Math.round(ol.scrollLeft), lastRight: Math.round(r.right), lastVisible: r.right <= page + 1 }
  })
  console.log(`  last step reachable after scroll: ${reached.lastVisible ? "YES" : `NO (right=${reached.lastRight} vw=${width})`}`)

  // 3. Dock occlusion with scroll held constant, at the exact scroll position.
  const dock = await page.evaluate(() => {
    const d = document.querySelector(".fixed.inset-x-0.bottom-0")
    if (!d) return null
    const dr = d.getBoundingClientRect()
    const victims = []
    for (const el of document.querySelectorAll("main input, main select, main button, main a[href]")) {
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.width === 0) continue
      if (r.bottom > dr.top && r.top < dr.bottom && r.right > dr.left && r.left < dr.right) {
        victims.push({
          label: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 34),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          scrollY: Math.round(window.scrollY),
        })
      }
    }
    return { dockTop: Math.round(dr.top), dockH: Math.round(dr.height), count: victims.length, victims }
  })
  console.log(`dock: top=${dock.dockTop} h=${dock.dockH} occluding=${dock.count}`)
  for (const v of dock.victims) console.log(`  occludes "${v.label}" top=${v.top} bottom=${v.bottom}`)

  // 4. Is there bottom padding so the last element can scroll clear of the dock?
  const pad = await page.evaluate(() => {
    const main = document.querySelector("main")
    const inner = document.querySelector("main > div.mx-auto")
    const cs = getComputedStyle(inner || main)
    const d = document.querySelector(".fixed.inset-x-0.bottom-0")
    // Scroll to the very bottom and see if the last interactive element clears the dock.
    window.scrollTo(0, document.body.scrollHeight)
    const last = Array.from(document.querySelectorAll("main input, main select, main button")).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height > 0 && getComputedStyle(el).display !== "none"
    }).pop()
    const dr = d ? d.getBoundingClientRect() : null
    const lr = last ? last.getBoundingClientRect() : null
    return {
      paddingBottom: cs.paddingBottom,
      lastLabel: last ? (last.getAttribute("aria-label") || last.textContent || "").trim().slice(0, 34) : null,
      lastBottom: lr ? Math.round(lr.bottom) : null,
      dockTop: dr ? Math.round(dr.top) : null,
      clears: lr && dr ? lr.bottom <= dr.top + 1 : null,
    }
  })
  console.log(`bottom scroll: padding-bottom=${pad.paddingBottom} last="${pad.lastLabel}" bottom=${pad.lastBottom} dockTop=${pad.dockTop} clears=${pad.clears}`)

  await context.close()
}
await browser.close()
