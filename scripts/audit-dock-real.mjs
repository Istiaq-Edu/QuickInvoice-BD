// Isolates genuine content occlusion by the fixed bottom dock, excluding the
// dock's own descendants (its Back/Next buttons are supposed to sit there).
// The question is whether a *form* control ends up under the dock at the bottom
// of the scroll, and whether the scroll padding is enough to clear it.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-dock-real.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const STEPS = ["Details", "From", "Bill to", "Items", "Notes", "Preview"]
const browser = await chromium.launch()

for (const width of [320, 390, 768, 1024, 1100, 1279, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  const stepped = (await stepper.count()) > 0

  console.log(`\n=== ${width}px (stepped=${stepped}) ===`)
  for (const step of STEPS) {
    if (stepped) {
      const b = stepper.getByRole("button", { name: step, exact: false })
      if (await b.count()) { await b.click(); await page.waitForTimeout(200) }
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const d = document.querySelector(".fixed.inset-x-0.bottom-0")
      if (!d || getComputedStyle(d).display === "none" || d.getBoundingClientRect().height === 0) return { dock: false }
      const dr = d.getBoundingClientRect()
      const hits = []
      for (const el of document.querySelectorAll("main input, main select, main textarea, main button, main a[href]")) {
        if (d.contains(el)) continue // the dock's own controls live there by design
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue
        const rect = el.getBoundingClientRect()
        if (rect.height === 0 || rect.width === 0) continue
        const hidden = Math.min(rect.bottom, dr.bottom) - Math.max(rect.top, dr.top)
        if (hidden > 1) hits.push({ hidden: Math.round(hidden), label: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 32) })
      }
      return { dock: true, dockTop: Math.round(dr.top), hits }
    })
    if (!r.dock) { console.log(`  [${step}] no dock`); continue }
    const worst = r.hits.sort((a, b) => b.hidden - a.hidden)[0]
    console.log(`  [${step}] dockTop=${r.dockTop} contentOccluded=${r.hits.length}${worst ? `  worst=${worst.hidden}px "${worst.label}"` : ""}${worst ? "   <-- REAL" : ""}`)
    for (const h of r.hits.slice(0, 6)) console.log(`        ${h.hidden}px "${h.label}"`)
  }
  await context.close()
}
await browser.close()
