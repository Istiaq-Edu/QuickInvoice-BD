// Regression guard for the `.touch-hit` rule: the enlarged hit area must apply
// only to coarse pointers. On a mouse-driven desktop the controls must keep
// exactly their painted size, or adjacent buttons gain overlapping dead zones.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-touch-scope.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch()

// hasTouch: false reproduces a fine pointer, so @media (pointer: coarse) must not match.
for (const cfg of [
  { name: "desktop / fine pointer", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: "phone / coarse pointer ", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]) {
  const context = await browser.newContext({ viewport: cfg.viewport, isMobile: cfg.isMobile, hasTouch: cfg.hasTouch })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  if (await stepper.count()) {
    await stepper.getByRole("button", { name: "Items", exact: false }).click()
    await page.waitForTimeout(350)
  }
  const r = await page.evaluate(() => {
    const coarse = matchMedia("(pointer: coarse)").matches
    const probes = []
    for (const el of document.querySelectorAll(".touch-hit")) {
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden") continue
      const b = el.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      const after = getComputedStyle(el, "::after")
      probes.push({
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 28),
        painted: `${Math.round(b.width)}x${Math.round(b.height)}`,
        afterW: after.width,
        afterH: after.height,
        afterContent: after.content,
      })
    }
    return { coarse, count: probes.length, sample: probes.slice(0, 3) }
  })
  console.log(`\n${cfg.name}: pointer:coarse=${r.coarse}  .touch-hit=${r.count}`)
  for (const p of r.sample) console.log(`  "${p.label}" painted ${p.painted}  ::after ${p.afterW} x ${p.afterH} (content=${p.afterContent})`)
  await context.close()
}
await browser.close()
