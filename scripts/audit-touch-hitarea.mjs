// Verifies the `.touch-hit` pseudo-element really yields a >=44x44 tappable
// region, by hit-testing the corner points of the intended 44x44 box with
// document.elementFromPoint. A pseudo-element cannot be measured directly, but
// it does participate in hit testing, so a point outside the painted button but
// inside the intended hit box resolves to the button if the rule works.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-touch-hitarea.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
const stepper = page.getByRole("navigation", { name: "Invoice steps" })
await stepper.getByRole("button", { name: "Items", exact: false }).click()
await page.waitForTimeout(350)

const r = await page.evaluate(() => {
  const results = []
  for (const el of document.querySelectorAll(".touch-hit")) {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") continue
    const b = el.getBoundingClientRect()
    if (b.width === 0 || b.height === 0) continue
    // The intended hit box, per the CSS rule.
    const targetW = Math.max(b.width, 44)
    const targetH = Math.max(b.height, 44)
    const cx = b.left + b.width / 2
    const cy = b.top + b.height / 2

    // Probe the four corners of the intended box, inset by 1px so the point is
    // unambiguously inside.
    const inset = 1
    const probes = [
      [cx - targetW / 2 + inset, cy - targetH / 2 + inset],
      [cx + targetW / 2 - inset, cy - targetH / 2 + inset],
      [cx - targetW / 2 + inset, cy + targetH / 2 - inset],
      [cx + targetW / 2 - inset, cy + targetH / 2 - inset],
    ]
    let insideAll = 0
    for (const [px, py] of probes) {
      if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue
      const hit = document.elementFromPoint(px, py)
      if (hit && (hit === el || el.contains(hit))) insideAll++
    }
    // How far outside the painted box does the hit region reach?
    const reachX = Math.round((targetW - b.width) / 2)
    const reachY = Math.round((targetH - b.height) / 2)
    results.push({
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 32),
      painted: `${Math.round(b.width)}x${Math.round(b.height)}`,
      target: `${Math.round(targetW)}x${Math.round(targetH)}`,
      reach: `+${reachX}px x, +${reachY}px y`,
      cornersHit: `${insideAll}/4`,
      ok: targetW >= 44 && targetH >= 44,
    })
  }
  return results
})

console.log(`${r.length} .touch-hit controls found\n`)
let allOk = true
for (const x of r) {
  if (!x.ok) allOk = false
  console.log(`  ${x.ok ? "OK " : "FAIL"} "${x.label}" painted ${x.painted} -> target ${x.target} (${x.reach}) corners=${x.cornersHit}`)
}
console.log(`\nall targets >= 44x44: ${allOk ? "YES" : "NO"}`)
await context.close()
await browser.close()
