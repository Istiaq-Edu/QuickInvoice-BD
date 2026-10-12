// Checks whether the logo cropper's confirm button is reachable on a short
// phone (320x568), where the panel's 94vh cap and its 46vh stage leave very
// little room for the controls below.
//
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/diagnose-cropper-height.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const OUT = "docs/operations/mobile-review"
mkdirSync(OUT, { recursive: true })

// A tiny valid PNG, so the file input accepts it.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR42u3OMQEAAAgDoJnc6BpjDyRg" +
  "blXVvXsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAB4W5wAAWQ0k1AAAAAASUVORK5CYII=",
  "base64",
)
writeFileSync("/tmp/probe-logo.png", PNG)

const browser = await chromium.launch()

for (const [w, h] of [[320, 568], [390, 844]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await context.route("**/auth/v1/user**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }))
  await context.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null, settings: {} }) }))
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1500)

  // A guest can still pick a session logo, which is what opens the cropper.
  const input = page.locator("#seller-logo-upload-guest")
  if ((await input.count()) === 0) { console.log(`\n=== ${w}x${h} === file input not found`); await context.close(); continue }
  await input.setInputFiles("/tmp/probe-logo.png")
  await page.waitForTimeout(1200)

  const r = await page.evaluate(() => {
    // Match the panel by its own class token. Selecting [role="dialog"] first
    // caught the full-viewport backdrop instead, which reports no clipping and
    // hides the problem.
    const panel = document.querySelector('div[class*="94vh"]')
    if (!panel) return null
    const pr = panel.getBoundingClientRect()
    const cs = getComputedStyle(panel)
    const buttons = []
    for (const el of panel.querySelectorAll("button")) {
      const b = el.getBoundingClientRect()
      buttons.push({
        text: (el.textContent || "").trim().slice(0, 22),
        top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
        insideViewport: b.bottom <= window.innerHeight + 1 && b.top >= -1,
      })
    }
    return {
      panelTop: Math.round(pr.top), panelBottom: Math.round(pr.bottom), panelH: Math.round(pr.height),
      viewportH: window.innerHeight,
      panelScrollH: panel.scrollHeight, panelClientH: panel.clientHeight,
      overflowY: cs.overflowY, maxHeight: cs.maxHeight,
      // Whether any ancestor between the panel and the body can scroll, which is
      // the only way a clipped control could still be reached.
      scrollableAncestors: (() => {
        const out = []
        let n = panel.parentElement
        while (n && n !== document.body) {
          const acs = getComputedStyle(n)
          if (["auto", "scroll"].includes(acs.overflowY) && n.scrollHeight > n.clientHeight + 1) out.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)}`)
          n = n.parentElement
        }
        return out
      })(),
      bodyScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      buttons,
    }
  })

  console.log(`\n=== ${w}x${h} ===`)
  if (!r) { console.log("  cropper panel not found"); await context.close(); continue }
  console.log(`  panel top=${r.panelTop} bottom=${r.panelBottom} h=${r.panelH} maxHeight=${r.maxHeight} (viewport ${r.viewportH})`)
  console.log(`  panel scrollHeight=${r.panelScrollH} clientHeight=${r.panelClientH} overflowY=${r.overflowY}`)
  const clipped = r.panelScrollH - r.panelClientH
  console.log(`  ${clipped > 1 ? `CONTENT CLIPPED by ${clipped}px` : "no clipped content"}`)
  console.log(`  scrollable ancestors: ${r.scrollableAncestors.length ? r.scrollableAncestors.join(", ") : "none"}   bodyScrollable=${r.bodyScrollable}`)
  for (const b of r.buttons) console.log(`    "${b.text}" top=${b.top} bottom=${b.bottom} h=${b.h} insideViewport=${b.insideViewport}`)

  await page.screenshot({ path: `${OUT}/cropper-${w}x${h}.png` })
  await context.close()
}

await browser.close()
