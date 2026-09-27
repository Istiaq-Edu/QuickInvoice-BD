import { chromium } from "@playwright/test"

// Fills real figures so the totals and line totals render, then screenshots the
// Items panel and audits contrast on the text that failed before.
//
// The taka-sign bug and the 3.8:1 "AMOUNT DUE" label were both invisible to the
// type checker and to unit tests: one was a font-metrics problem, the other a
// colour choice. Both are cheap to reintroduce, so they are measured here rather
// than left to whoever next looks at the screen.

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${BASE}/`, { waitUntil: "networkidle" })
await page.waitForTimeout(900)
await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((p) => p.remove()))

// Quantity is filled as well as price. A new line starts blank, so a script that
// only set the price would screenshot and audit a panel where every amount is
// zero — which is exactly the content these two checks exist to measure.
await page.locator("#description-1").fill("Website design — homepage")
await page.locator("#quantity-1").fill("1")
await page.locator("#price-1").fill("5000")
await page.getByRole("button", { name: "Add another item", exact: true }).click()
await page.locator("#description-2").fill("Consulting retainer")
await page.locator("#quantity-2").fill("1")
await page.locator("#price-2").fill("12000")
// The discount band is on every row, so setting one needs no menu: a select and
// a value, on the row itself. The type has to be chosen before the value field
// accepts anything, since it is disabled while the type is "No discount".
await page.locator("#discount-type-2").selectOption("percentage")
await page.locator('input[aria-label="Discount value item 2"]').fill("10")
await page.waitForTimeout(400)

const items = page.locator("fieldset .surface", { hasText: "What are you charging for?" })
await items.scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await items.screenshot({ path: "shots/items-final.png" })

// Both checks run inside the page. Colour maths has to: modern computed styles
// come back as `oklab(...)` and `color(srgb ...)`, which cannot be parsed by a
// regex in Node, and translucent text has to be composited over its real
// backdrop before the ratio means anything. The browser already holds resolved
// sRGB values, so it does the arithmetic and returns finished numbers.
const report = await page.evaluate(() => {
  // Resolve any colour syntax to 8-bit rgb plus alpha by letting the browser do
  // the conversion. This has to happen here rather than in Node: Tailwind v4 emits
  // `oklab(...)` for its `/opacity` modifiers, and `oklab` is not a format a
  // regex can read. An earlier version parsed the numbers directly and turned
  // cream `oklab(0.994 0.0002 0.0069 / 0.8)` into rgb(1,0,0), which reported black
  // text on a near-black card as a failing 1.2:1 when the true ratio was 14:1.
  // Painting into a canvas sidesteps parsing entirely: the browser understands
  // every syntax it can render, and getImageData hands back the resolved bytes.
  const swatch = document.createElement("canvas")
  swatch.width = 1
  swatch.height = 1
  const ctx = swatch.getContext("2d", { willReadFrequently: true })
  const toRGBA = (value) => {
    if (!value || value === "transparent" || value === "none") return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = "#000"
    ctx.fillStyle = value
    // A rejected value leaves fillStyle at the previous colour, so confirm the
    // browser actually accepted it before trusting the pixel.
    if (ctx.fillStyle === "#000000" && !/^#0{3,6}$|black|rgb\(0, 0, 0\)/.test(value)) {
      const normalised = value.replace(/\s+/g, "")
      if (/^(transparent|none)$/.test(normalised)) return null
    }
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    const alpha = data[3] / 255
    if (alpha === 0) return { rgb: [0, 0, 0], alpha: 0 }
    // getImageData is premultiplied, so undo that to recover straight colour.
    return {
      rgb: [data[0] / alpha, data[1] / alpha, data[2] / alpha].map((n) => Math.min(255, Math.round(n))),
      alpha,
    }
  }
  const composite = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
  const channel = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
  const contrast = (a, b) => {
    const hi = Math.max(luminance(a), luminance(b))
    const lo = Math.min(luminance(a), luminance(b))
    return (hi + 0.05) / (lo + 0.05)
  }

  // 1. Taka sign against the first digit that follows it. A negative gap means
  //    the glyph is painted over the number, which made every price look struck
  //    out. The walk has to start *after* the sign: in a discounted total the
  //    string is "− ৳1,200", so the leading "− " is itself a non-taka text node
  //    that sits to the LEFT of the sign and would report a large false overlap.
  //
  //    The check is not limited to `.money` hosts. A taka sign rendered anywhere
  //    as bare text has the same collision problem, and a previous version of
  //    this audit only looked inside `.money`, so a bare "৳" in a column header
  //    would have slipped through unnoticed.
  const signs = []
  const bareSigns = []
  for (const host of document.querySelectorAll("fieldset .surface *")) {
    if (host.closest(".sr-only")) continue
    // Skip the wrapper itself: a `.taka` span *is* the correct treatment, so it
    // must not be reported as a bare sign just because it has no nested `.taka`.
    if (host.classList?.contains("taka")) continue
    const ownText = [...host.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
    if (ownText.includes("৳") && !host.querySelector(".taka")) {
      bareSigns.push({ text: ownText.trim().slice(0, 40), cls: (host.className || "").toString().slice(0, 50) })
    }
    if (!host.classList?.contains("money")) continue
    const sign = host.querySelector(".taka")
    if (!sign) {
      signs.push({ text: host.textContent, wrapped: false, gapPx: null })
      continue
    }
    const signBox = sign.getBoundingClientRect()
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let digitBox = null
    while (walker.nextNode()) {
      const node = walker.currentNode
      // Skip anything that is not positioned after the sign wrapper.
      if (sign.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) continue
      if (node.textContent?.trim() && !node.textContent.includes("৳")) {
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, 1)
        digitBox = range.getBoundingClientRect()
        break
      }
    }
    signs.push({
      text: host.textContent,
      wrapped: true,
      gapPx: digitBox ? Math.round((digitBox.left - signBox.right) * 100) / 100 : null,
    })
  }

  // 2. Contrast for every text node in the panel.
  const backdrop = (el) => {
    const stack = []
    let node = el
    while (node && node !== document.documentElement) {
      const parsed = toRGBA(getComputedStyle(node).backgroundColor)
      if (parsed && parsed.alpha > 0.01) {
        stack.push(parsed)
        if (parsed.alpha >= 0.99) break
      }
      node = node.parentElement
    }
    let base = [255, 255, 255]
    for (let i = stack.length - 1; i >= 0; i -= 1) base = composite(stack[i].rgb, base, stack[i].alpha)
    return base
  }

  const text = []
  const seen = new Set()
  for (const el of document.querySelectorAll("fieldset .surface *")) {
    if (el.closest(".sr-only")) continue
    // A gradient or image is not a flat colour, so a single ratio would be
    // meaningless. Skipped rather than reported as a false failure.
    const bgImage = getComputedStyle(el).backgroundImage
    if (bgImage && bgImage !== "none") continue
    const content = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent ?? "").trim())
      .join("")
      .trim()
    if (!content) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.1) continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    const key = `${cs.color}|${cs.fontSize}|${cs.fontWeight}|${content.slice(0, 24)}`
    if (seen.has(key)) continue
    seen.add(key)
    const fg = toRGBA(cs.color)
    if (!fg) continue
    const bg = backdrop(el)
    text.push({
      label: content.slice(0, 40),
      size: parseFloat(cs.fontSize),
      weight: Number(cs.fontWeight),
      ratio: Math.round(contrast(composite(fg.rgb, bg, fg.alpha), bg) * 100) / 100,
    })
  }

  return { signs, text, bareSigns }
})

const failures = []
// A taka sign rendered as bare text anywhere in the panel would have the same
// collision problem as one inside a money figure, so it is reported rather than
// left to be discovered by eye.
for (const bare of report.bareSigns) failures.push(`bare taka sign not wrapped in .taka: "${bare.text}" (${bare.cls})`)
for (const sign of report.signs) {
  if (!sign.wrapped) failures.push(`taka sign is not wrapped in .taka: "${sign.text}"`)
  else if (sign.gapPx !== null && sign.gapPx < 0) failures.push(`taka sign overlaps the digits by ${Math.abs(sign.gapPx)}px in "${sign.text}"`)
}
for (const item of report.text) {
  // WCAG "large text" is 18.66px bold or 24px regular; those need 3:1, the rest 4.5:1.
  const large = item.weight >= 700 ? item.size >= 18.66 : item.size >= 24
  const required = large ? 3 : 4.5
  if (item.ratio < required) failures.push(`contrast ${item.ratio}:1 (needs ${required}:1) — ${item.size}px "${item.label}"`)
}

console.log(`taka signs checked: ${report.signs.length}`)
console.log(`text nodes checked:  ${report.text.length}`)
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`)
  for (const failure of failures) console.log(`  - ${failure}`)
} else {
  console.log("\nPASS: no glyph overlap, no contrast failures")
}

await browser.close()
process.exit(failures.length ? 1 : 0)