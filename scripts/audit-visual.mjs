// Temporary layout + contrast auditor. Reports objective, measurable defects.
// Usage: node scripts/audit-visual.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const ROUTES = ["/", "/invoices", "/customers", "/account/settings", "/admin/allowlist", "/auth/login"]

const AUDIT = () => {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const parts = m[1].split(/[,/]/).map((p) => parseFloat(p.trim()))
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const lum = (c) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => {
    const la = lum(a)
    const lb = lum(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const effectiveBg = (el) => {
    const stack = []
    let node = el
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0) {
        stack.push(bg)
        if (bg.a === 1) break
      }
      node = node.parentElement
    }
    let base = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 6, g: 10, b: 18, a: 1 }
    if (base.a < 1) base = { r: 6, g: 10, b: 18, a: 1 }
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base)
    return base
  }
  const path = (el) => {
    const bits = []
    let node = el
    while (node && node !== document.body && bits.length < 4) {
      let bit = node.tagName.toLowerCase()
      if (node.id) bit += `#${node.id}`
      else if (node.className && typeof node.className === "string") {
        const first = node.className.trim().split(/\s+/).slice(0, 2).join(".")
        if (first) bit += `.${first}`
      }
      bits.unshift(bit)
      node = node.parentElement
    }
    return bits.join(" > ")
  }

  const out = { clipped: [], lowContrast: [], docOverflow: null }

  out.docOverflow = { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }

  const all = Array.from(document.querySelectorAll("body *"))
  for (const el of all) {
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    // Text clipped by an overflow-hidden ancestor or by a too-small box.
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip"
    if (clipsX && el.scrollWidth - el.clientWidth > 2 && el.textContent && el.textContent.trim().length > 3) {
      const own = Array.from(el.children).every((c) => getComputedStyle(c).display === "none")
      if (own || el.clientWidth > 0) {
        out.clipped.push({ path: path(el), text: el.textContent.trim().slice(0, 46), over: el.scrollWidth - el.clientWidth })
      }
    }

    // Small text contrast.
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)
    if (!hasText) continue
    const size = parseFloat(style.fontSize)
    if (size > 20) continue
    const fg = parse(style.color)
    if (!fg) continue
    const bg = effectiveBg(el)
    const c = ratio(over(fg, bg), bg)
    if (c < 4.5) {
      out.lowContrast.push({ path: path(el), text: el.textContent.trim().slice(0, 42), size: Math.round(size), ratio: Math.round(c * 100) / 100 })
    }
  }
  return out
}

const browser = await chromium.launch()
for (const route of ROUTES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45_000 })
    await page.waitForTimeout(500)
    const r = await page.evaluate(AUDIT)
    console.log(`\n=== ${route} ===`)
    console.log(`doc scrollWidth ${r.docOverflow.scrollWidth} vs viewport ${r.docOverflow.innerWidth}${r.docOverflow.scrollWidth > r.docOverflow.innerWidth ? "  <-- HORIZONTAL OVERFLOW" : ""}`)
    console.log(`-- clipped text (${r.clipped.length}) --`)
    for (const c of r.clipped.slice(0, 12)) console.log(`  +${c.over}px  "${c.text}"  ${c.path}`)
    console.log(`-- text under 4.5:1 (${r.lowContrast.length}) --`)
    for (const c of r.lowContrast.slice(0, 16)) console.log(`  ${c.ratio}:1  ${c.size}px  "${c.text}"  ${c.path}`)

    // Anything light-coloured rendered on the white A4 sheet is effectively invisible,
    // and the same colours are baked into the PDF/DOCX exports.
    const sheet = await page.evaluate(() => {
      const lum = (value) => {
        const m = value.match(/rgba?\(([^)]+)\)/)
        if (!m) return null
        const [r, g, b, a = 1] = m[1].split(",").map((p) => parseFloat(p.trim()))
        if (a < 0.25) return null
        const f = (v) => {
          v /= 255
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const paper = document.querySelector(".invoice-paper")
      if (!paper) return null
      const bad = []
      for (const el of paper.querySelectorAll("*")) {
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())
        if (!hasText) continue
        const style = getComputedStyle(el)
        if (style.display === "none" || style.visibility === "hidden") continue
        const l = lum(style.color)
        if (l !== null && l > 0.45) {
          bad.push({ text: el.textContent.trim().slice(0, 34), color: style.color, cls: (el.className || "").toString().slice(0, 60) })
        }
      }
      return bad
    })
    if (sheet) {
      console.log(`-- INVISIBLE on the white A4 sheet (${sheet.length}) --`)
      for (const s of sheet.slice(0, 14)) console.log(`  ${s.color}  "${s.text}"  [${s.cls}]`)
    }
  } catch (error) {
    console.log(`\n=== ${route} === FAILED: ${error.message}`)
  } finally {
    await page.close()
  }
}
await browser.close()
