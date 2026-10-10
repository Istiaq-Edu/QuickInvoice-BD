// Q: if a form control is ever painted under the dock, can the user scroll it
// clear? Checks, per step, whether each control that intersects the dock's band
// at its current scroll position can be brought fully above the dock by
// scrolling, using the page's actual scrollable range.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-dock-reachable.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch()

for (const width of [320, 390, 1024, 1279]) {
  const context = await browser.newContext({ viewport: { width, height: 844 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  await stepper.getByRole("button", { name: "Items", exact: false }).click()
  await page.waitForTimeout(300)

  const r = await page.evaluate(() => {
    const d = document.querySelector(".fixed.inset-x-0.bottom-0")
    const dr = d ? d.getBoundingClientRect() : null
    if (!dr) return { dock: false }
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    const out = { dock: true, dockTop: Math.round(dr.top), maxScroll: Math.round(maxScroll), unreachable: [], scrollableClear: 0, checked: 0 }
    for (const el of document.querySelectorAll("main input, main select, main textarea, main button, main a[href]")) {
      if (d.contains(el)) continue
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue
      const rect = el.getBoundingClientRect()
      if (rect.height === 0 || rect.width === 0) continue
      out.checked++
      // Bottom-of-document position for this element if the page were fully scrolled.
      const docTop = rect.top + window.scrollY
      const bottomAtMaxScroll = docTop + rect.height - maxScroll
      if (bottomAtMaxScroll > dr.top + 1) {
        out.unreachable.push({
          label: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 30),
          bottomAtMaxScroll: Math.round(bottomAtMaxScroll),
          dockTop: Math.round(dr.top),
          shortfall: Math.round(bottomAtMaxScroll - dr.top),
        })
      } else {
        out.scrollableClear++
      }
    }
    return out
  })

  console.log(`\n=== ${width}px Items ===`)
  if (!r.dock) { console.log("no dock"); await context.close(); continue }
  console.log(`dockTop=${r.dockTop} maxScroll=${r.maxScroll} controls=${r.checked} reachable=${r.scrollableClear} UNREACHABLE=${r.unreachable.length}`)
  for (const u of r.unreachable) console.log(`  X "${u.label}" needs ${u.shortfall}px more than the page can scroll (bottom would land at ${u.bottomAtMaxScroll}, dock top ${u.dockTop})`)
  await context.close()
}
await browser.close()
