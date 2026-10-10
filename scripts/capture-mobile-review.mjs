// Captures the mobile stepped flow at each step for visual review, at the two
// widths the design system claims to support (320 floor, 390 common).
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/capture-mobile-review.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const OUT = "docs/operations/mobile-review"
mkdirSync(OUT, { recursive: true })

const STEPS = ["Details", "From", "Bill to", "Items", "Notes", "Preview"]
const browser = await chromium.launch()

for (const [label, viewport] of [
  ["320", { width: 320, height: 844 }],
  ["390", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  for (const step of STEPS) {
    const b = stepper.getByRole("button", { name: step, exact: false })
    if (await b.count()) { await b.click(); await page.waitForTimeout(350) }
    await page.screenshot({ path: `${OUT}/${label}-${step.toLowerCase().replace(/\s+/g, "-")}.png`, fullPage: false })
  }
  await context.close()
}
await browser.close()
console.log(`captured to ${OUT}`)
