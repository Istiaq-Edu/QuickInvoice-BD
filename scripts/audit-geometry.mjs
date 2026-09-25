// Temporary geometry auditor: finds overlapping grid columns, dead space, and text
// that overflows or is clipped by its own box.
// Usage: node scripts/audit-geometry.mjs
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"

const PROBE = () => {
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }
  }
  const path = (el) => {
    if (!el) return "?"
    const bits = []
    let node = el
    while (node && node !== document.body && bits.length < 5) {
      let bit = node.tagName.toLowerCase()
      if (node.id) bit += `#${node.id}`
      else if (typeof node.className === "string" && node.className.trim()) bit += `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      bits.unshift(bit)
      node = node.parentElement
    }
    return bits.join(" > ")
  }

  const container = document.querySelector("main > div.mx-auto")
  const grid = document.querySelector("fieldset")?.parentElement ?? null
  const fieldset = document.querySelector("fieldset")
  const preview = document.querySelector('section[aria-label="Invoice preview"]')
  const paper = document.querySelector(".invoice-paper")
  const dock = document.querySelector(".fixed.inset-x-0.bottom-0")

  const overflowing = []
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") continue
    const overX = el.scrollWidth - el.clientWidth
    const overY = el.scrollHeight - el.clientHeight
    if ((overX > 2 || overY > 2) && el.textContent && el.textContent.trim().length > 2) {
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)
      if (!hasOwnText) continue
      overflowing.push({
        path: path(el),
        text: el.textContent.trim().slice(0, 40),
        overX,
        overY,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        rect: rect(el),
      })
    }
  }

  // Text nodes painted to the right of their nearest .surface box edge.
  const escapes = []
  for (const el of document.querySelectorAll("body *")) {
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)
    if (!hasOwnText) continue
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") continue
    const host = el.closest(".surface, .well")
    if (!host) continue
    const hostRect = host.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (elRect.right - hostRect.right > 1 || hostRect.left - elRect.left > 1) {
      escapes.push({ path: path(el), text: el.textContent.trim().slice(0, 40), elRect: rect(el), hostEdge: Math.round(hostRect.right) })
    }
  }

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dock: dock ? { display: getComputedStyle(dock).display, rect: rect(dock) } : null,
    container: rect(container),
    grid: grid ? { rect: rect(grid), cols: getComputedStyle(grid).gridTemplateColumns } : null,
    fieldset: rect(fieldset),
    preview: rect(preview),
    paper: rect(paper),
    overflowSample: overflowing.slice(0, 14),
    overflowCount: overflowing.length,
    escapes: escapes.slice(0, 14),
    escapesCount: escapes.length,
  }
}

const browser = await chromium.launch()
for (const [label, viewport] of [
  ["desktop-1440", { width: 1440, height: 900 }],
  ["desktop-1280", { width: 1280, height: 800 }],
  ["laptop-1024", { width: 1024, height: 768 }],
  ["mobile-390", { width: 390, height: 844 }],
  ["mobile-320", { width: 320, height: 844 }],
]) {
  const page = await browser.newPage({ viewport })
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45_000 })
  if (viewport.width < 1024) {
    await page.getByRole("navigation", { name: "Invoice steps" }).getByRole("button", { name: "Items" }).click()
    await page.waitForTimeout(200)
  }
  const addDiscount = page.getByRole("button", { name: "Add discount item 1" })
  if (await addDiscount.isVisible()) {
    await addDiscount.click()
    await page.locator('input[aria-label="Discount value item 1"]').fill("10")
  }

  await page.waitForTimeout(400)
  const r = await page.evaluate(PROBE)
  console.log(`\n=========== ${label} ===========`)
  console.log(`viewport ${r.viewport.w}x${r.viewport.h}`)
  console.log(`container ${JSON.stringify(r.container)}`)
  console.log(`grid      ${JSON.stringify(r.grid?.rect)}  cols=${r.grid?.cols}`)
  console.log(`fieldset  ${JSON.stringify(r.fieldset)}`)
  console.log(`preview   ${JSON.stringify(r.preview)}`)
  console.log(`paper     ${JSON.stringify(r.paper)}`)
  console.log(`mobile dock: ${r.dock ? `${r.dock.display} @ ${JSON.stringify(r.dock.rect)}` : "absent"}`)
  if (r.grid && r.fieldset && r.preview) {
    const gap = r.preview.x - r.fieldset.right
    const deadRight = r.container.right - r.preview.right
    console.log(`column gap ${gap}px (expect ~32)   dead space right of preview ${deadRight}px`)
  }
  console.log(`-- own-box overflow (${r.overflowCount}) --`)
  for (const o of r.overflowSample) console.log(`  x+${o.overX} y+${o.overY} ovf(${o.overflowX}/${o.overflowY}) "${o.text}" ${o.path}`)
  console.log(`-- text escaping its panel (${r.escapesCount}) --`)
  for (const e of r.escapes) console.log(`  "${e.text}" right=${e.elRect.right} panelRight=${e.hostEdge} ${e.path}`)

  const table = await page.evaluate(() => {
    const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null)
    const scroller = document.querySelector("fieldset .overflow-x-auto")
    const scrollerTarget = scroller ?? document.querySelector('fieldset nav[aria-label="Invoice steps"] ol')
    return {
      contentScrollWidth: scrollerTarget ? scrollerTarget.scrollWidth : null,
      contentClientWidth: scrollerTarget ? scrollerTarget.clientWidth : null,
      description: w(document.querySelector('input[aria-label="Item 1 description"]')),
      discountSelect: w(document.querySelector("select#discount-type-1")),
      discountValue: w(document.querySelector('input[aria-label="Discount value item 1"]')),
      itemsOverflowX: (() => {
        const el = document.querySelector("fieldset .surface ol")?.parentElement
        return el ? getComputedStyle(el).overflowX : null
      })(),
      itemsScroll: (() => {
        const el = document.querySelector("fieldset .surface ol")?.parentElement
        return el ? Math.round(el.scrollWidth - el.clientWidth) : null
      })(),
    }
  })
  console.log(`items cards: ${JSON.stringify(table)}`)
  if (table.itemsScroll && table.itemsScroll > 2) {
    console.log(`  <-- items panel scrolls horizontally by ${table.itemsScroll}px`)
  }
  await page.close()
}
await browser.close()
