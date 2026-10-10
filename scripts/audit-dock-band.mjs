// Confirms the dock/scroll-padding interaction in the 1024-1279px band, where
// `lg:pb-10` shortens the page's bottom padding while the fixed dock is still
// rendered (it is hidden only at `xl`). Verifies whether the last control and
// the dock's own buttons can be cleanly reached at every step.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-dock-band.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch()

for (const width of [320, 390, 768, 1024, 1100, 1279, 1280, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })

  const dockVisible = await page.evaluate(() => {
    const d = document.querySelector(".fixed.inset-x-0.bottom-0")
    if (!d) return false
    return getComputedStyle(d).display !== "none" && d.getBoundingClientRect().height > 0
  })
  const pad = await page.evaluate(() => {
    const inner = document.querySelector("main > div.mx-auto")
    return inner ? getComputedStyle(inner).paddingBottom : null
  })

  // Measured overlap: with the page scrolled to the bottom, does the last
  // interactive control in the form sit above the dock's top edge?
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(200)
  const overlap = await page.evaluate(() => {
    const d = document.querySelector(".fixed.inset-x-0.bottom-0")
    if (!d || getComputedStyle(d).display === "none") return { dock: false }
    const dr = d.getBoundingClientRect()
    const cands = Array.from(document.querySelectorAll("main input, main select, main button"))
      .filter((el) => {
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return false
        const r = el.getBoundingClientRect()
        return r.height > 0 && r.width > 0
      })
    let worst = null
    for (const el of cands) {
      const r = el.getBoundingClientRect()
      // Only count controls the dock actually paints over.
      if (r.bottom > dr.top && r.top < dr.bottom) {
        const hidden = Math.round(Math.min(r.bottom, dr.bottom) - Math.max(r.top, dr.top))
        if (!worst || hidden > worst.hidden) {
          worst = { hidden, label: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 30) }
        }
      }
    }
    return { dock: true, dockTop: Math.round(dr.top), pageH: document.documentElement.scrollHeight, worst }
  })

  console.log(`${String(width).padStart(4)}px  dock=${dockVisible ? "shown" : "hidden"}  paddingBottom=${pad}  ${overlap.dock ? (overlap.worst ? `OVERLAP ${overlap.worst.hidden}px on "${overlap.worst.label}"` : "no overlap") : "dock not drawn"}`)
  await context.close()
}
await browser.close()
