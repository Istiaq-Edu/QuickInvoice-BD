// Mobile responsiveness auditor. Measures real layout geometry on the stepped
// mobile flow: horizontal overflow of the document, touch-target sizes on every
// interactive control, dock occlusion of the last control, and whether the
// invoice preview scales instead of forcing a horizontal scroll.
// Usage: SHOT_BASE_URL=http://127.0.0.1:3100 node scripts/audit-mobile.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const STEPS = ["Details", "From", "Bill to", "Items", "Notes", "Preview"]

const PROBE = () => {
  // Inlined, not closed over: the probe is serialised and re-evaluated in the
  // page, so module-scope constants are not in scope inside it.
  const AA_MIN = 24
  const AAA_MIN = 44

  const path = (el) => {
    const bits = []
    let node = el
    while (node && node !== document.body && bits.length < 4) {
      let bit = node.tagName.toLowerCase()
      if (node.id) bit += `#${node.id}`
      else if (typeof node.className === "string" && node.className.trim())
        bit += `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      bits.unshift(bit)
      node = node.parentElement
    }
    return bits.join(" > ")
  }

  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth

  // Every element that paints outside the viewport on the right.
  const bleed = []
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right - window.innerWidth > 1.5) {
      bleed.push({
        path: path(el),
        right: Math.round(r.right),
        w: Math.round(r.width),
        text: (el.textContent || "").trim().slice(0, 30),
      })
    }
  }

  // Touch targets: interactive controls below the AA floor.
  const small = []
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [role='tab']")) {
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") continue
    if (el.classList.contains("sr-only")) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.height < AA_MIN) {
      small.push({
        path: path(el),
        label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 34),
        w: Math.round(r.width),
        h: Math.round(r.height),
      })
    }
  }

  // Below-AAA but above-AA: reported separately, not as failures.
  const sub44 = []
  for (const el of document.querySelectorAll("button, a[href], input, select, [role='button']")) {
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") continue
    if (el.classList.contains("sr-only")) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.height >= AA_MIN && r.height < AAA_MIN) {
      sub44.push({ path: path(el), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 34), h: Math.round(r.height) })
    }
  }

  const dock = document.querySelector(".fixed.inset-x-0.bottom-0")
  let dockOcclusion = null
  if (dock && getComputedStyle(dock).display !== "none") {
    const dr = dock.getBoundingClientRect()
    const victims = []
    for (const el of document.querySelectorAll("main input, main select, main textarea, main button, main a[href]")) {
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden") continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      const covered = r.bottom > dr.top && r.top < dr.bottom && r.right > dr.left && r.left < dr.right
      if (covered && !dock.contains(el)) {
        victims.push({ path: path(el), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), bottom: Math.round(r.bottom) })
      }
    }
    dockOcclusion = { dockRect: { top: Math.round(dr.top), h: Math.round(dr.height) }, coveredCount: victims.length, victims: victims.slice(0, 8) }
  }

  return { docOverflow, bleed: bleed.slice(0, 12), bleedCount: bleed.length, small, sub44Count: sub44.length, sub44: sub44.slice(0, 10), dockOcclusion }
}

const browser = await chromium.launch()
for (const [label, viewport] of [
  ["mobile-320", { width: 320, height: 844 }],
  ["mobile-360", { width: 360, height: 800 }],
  ["mobile-390", { width: 390, height: 844 }],
  ["mobile-414", { width: 414, height: 896 }],
  ["tablet-768", { width: 768, height: 1024 }],
  ["laptop-1024", { width: 1024, height: 768 }],
]) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 })

  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  const stepped = await stepper.count() > 0

  console.log(`\n=========== ${label} (${viewport.width}x${viewport.height}) ===========`)
  console.log(`stepped flow: ${stepped ? "yes" : "no (side-by-side)"}`)

  for (const step of STEPS) {
    if (stepped) {
      const btn = stepper.getByRole("button", { name: step, exact: false })
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(250)
      }
    }
    const r = await page.evaluate(PROBE)
    const fail = r.docOverflow > 1 || r.bleedCount > 0 || r.small.length > 0
    console.log(`  [${step}] docOverflowX=${r.docOverflow}px  bleed=${r.bleedCount}  belowAA=${r.small.length}  sub44=${r.sub44Count}${fail ? "   <-- ISSUE" : ""}`)
    for (const b of r.bleed) console.log(`      bleed right=${b.right} (vw=${viewport.width}) w=${b.w} "${b.text}" ${b.path}`)
    for (const s of r.small) console.log(`      belowAA ${s.w}x${s.h} "${s.label}" ${s.path}`)
    if (step === "Items" && r.dockOcclusion) {
      console.log(`      dock: h=${r.dockOcclusion.dockRect.h} top=${r.dockOcclusion.dockRect.top} covered=${r.dockOcclusion.coveredCount}`)
      for (const v of r.dockOcclusion.victims) console.log(`        covered "${v.label}" bottom=${v.bottom} ${v.path}`)
    }
  }

  // Scroll to the very bottom on Items and re-check dock occlusion.
  if (stepped) {
    await stepper.getByRole("button", { name: "Items", exact: false }).click()
    await page.waitForTimeout(250)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(300)
    const bottom = await page.evaluate(PROBE)
    console.log(`  [Items @bottom] dockCovered=${bottom.dockOcclusion?.coveredCount ?? "n/a"} docOverflowX=${bottom.docOverflow}`)
    for (const v of bottom.dockOcclusion?.victims ?? []) console.log(`      covered "${v.label}" bottom=${v.bottom} ${v.path}`)

    // Preview scaling: does the invoice paper shrink instead of overflowing?
    await stepper.getByRole("button", { name: "Preview", exact: false }).click()
    await page.waitForTimeout(400)
    const paper = await page.evaluate(() => {
      const el = document.querySelector(".invoice-paper")
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return { w: Math.round(r.width), right: Math.round(r.right), transform: cs.transform, zoom: cs.zoom, parentW: Math.round(el.parentElement.getBoundingClientRect().width) }
    })
    console.log(`  [Preview] paper ${paper ? `${paper.w}px right=${paper.right} parentW=${paper.parentW} transform=${paper.transform}` : "not found"}`)
    if (paper && paper.right > viewport.width + 1) console.log(`      <-- paper bleeds ${paper.right - viewport.width}px past viewport`)
  }
  await context.close()
}
await browser.close()
