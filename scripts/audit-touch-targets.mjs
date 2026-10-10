// Lists interactive controls below the WCAG 2.2 AAA touch-target size (44x44),
// with the class list so the intended hit area can be judged. A control smaller
// than 44px is only a failure if it also has no enlarged hit area.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-touch-targets.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch()

for (const width of [320, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })
  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  await stepper.getByRole("button", { name: "Items", exact: false }).click()
  await page.waitForTimeout(350)

  const r = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll("main button, main input, main select, main a[href]")) {
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden" || el.classList.contains("sr-only")) continue
      const b = el.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      if (b.height >= 44) continue
      // Does the element (or its wrapper) expand the hit area via a pseudo-element?
      let hasPseudoHit = false
      for (const node of [el, el.parentElement]) {
        if (!node) continue
        const before = getComputedStyle(node, "::before")
        const after = getComputedStyle(node, "::after")
        for (const ps of [before, after]) {
          if (ps.content && ps.content !== "none" && ps.position === "absolute") hasPseudoHit = true
        }
      }
      out.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 40),
        tag: el.tagName.toLowerCase(),
        w: Math.round(b.width),
        h: Math.round(b.height),
        parentH: el.parentElement ? Math.round(el.parentElement.getBoundingClientRect().height) : null,
        pseudoHit: hasPseudoHit,
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 120),
      })
    }
    return out
  })

  console.log(`\n=== ${width}px, Items step: ${r.length} controls under 44px ===`)
  for (const x of r) {
    const note = x.pseudoHit ? "pseudo-expanded" : x.parentH && x.parentH >= 44 ? `parent ${x.parentH}px` : "NO EXPANSION"
    console.log(`  ${x.tag} ${x.w}x${x.h} [${note}] "${x.label}"`)
    console.log(`      ${x.cls}`)
  }
  await context.close()
}
await browser.close()
