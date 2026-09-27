// Temporary visual-review helper for the "From / Your company" panel.
// Usage: node scripts/review-from-panel.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const OUT = "shots"
mkdirSync(OUT, { recursive: true })

const PROBE = () => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const panel = document.querySelector("#seller-company-name")?.closest(".editor-section") ?? null
  const pr = panel?.getBoundingClientRect()
  const clipped = []
  if (panel && pr) {
    for (const el of panel.querySelectorAll("button, p, input, textarea")) {
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      if (r.bottom > pr.bottom + 1) clipped.push({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40) })
    }
  }
  let dockClearance = "n/a"
  const dock = document.querySelector(".fixed.inset-x-0.bottom-0")
  const addr = document.querySelector("#seller-address")
  if (dock && addr) {
    window.scrollTo(0, document.body.scrollHeight)
    const d = dock.getBoundingClientRect()
    const a = addr.getBoundingClientRect()
    dockClearance = { dockTop: Math.round(d.top), addressBottom: Math.round(a.bottom), overlaps: a.bottom > d.top && a.top < d.bottom }
    window.scrollTo(0, 0)
  }
  return {
    panel: box(panel),
    scrollH: panel?.scrollHeight,
    clientH: panel?.clientHeight,
    clipped,
    dockClearance,
    touch: [...document.querySelectorAll(".editor-section button")].map((b) => ({ n: (b.textContent || "").trim().slice(0, 22), ...box(b) })).filter((b) => b.h !== null),
    logo: (() => { const el = document.querySelector("#seller-logo-upload, #seller-logo-upload-guest"); return el ? { id: el.id, name: el.getAttribute("aria-label"), by: el.getAttribute("aria-describedby"), box: box(el) } : "MISSING" })(),
    banner: (() => { const el = [...document.querySelectorAll("p")].find((p) => p.textContent?.includes("Guest logos are kept")); return el ? { visible: el.getBoundingClientRect().height > 0, ...box(el) } : "MISSING" })(),
  }
}

const browser = await chromium.launch()
for (const [label, viewport] of [
  ["desktop-1440", { width: 1440, height: 900 }],
  ["laptop-1024", { width: 1024, height: 768 }],
  ["mobile-390", { width: 390, height: 844 }],
  ["mobile-320", { width: 320, height: 844 }],
]) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45_000 })
    if (viewport.width < 1280) await page.getByRole("navigation", { name: "Invoice steps" }).getByRole("button", { name: "From" }).click()
    await page.waitForTimeout(500)
    await page.locator("#seller-company-name").fill("Northwind Studio")
    await page.locator("#seller-name").fill("Ayesha Rahman")
    await page.waitForTimeout(300)
    const panel = page.locator("#seller-company-name").locator("xpath=ancestor::div[contains(@class,'editor-section')]")
    await panel.screenshot({ path: `${OUT}/from-${label}.png` })
    await page.screenshot({ path: `${OUT}/page-${label}.png`, fullPage: true })
    const r = await page.evaluate(PROBE)
    console.log(`\n=========== ${label} ===========`)
    console.log(`panel ${JSON.stringify(r.panel)} scrollH=${r.scrollH} clientH=${r.clientH} pageErrors=${errors.length ? errors.join(" | ") : "none"}`)
    for (const id of ["seller-company-name", "seller-name", "seller-email", "seller-phone", "seller-address"]) {
      const snap = await page.locator(`#${id}`).ariaSnapshot()
      console.log(`  a11y ${id.padEnd(20)} ${String(snap).replace(/\s+/g, " ").trim().slice(0, 120)}`)
    }
    console.log(`  logo: ${JSON.stringify(r.logo)}`)
    console.log(`  banner: ${JSON.stringify(r.banner)}`)
    console.log(`  dock: ${JSON.stringify(r.dockClearance)}`)
    console.log(`  touch: ${r.touch.map((t) => `${t.n || "(icon)"}:${t.w}x${t.h}`).join("  ")}`)
    console.log(`  clipped: ${r.clipped.length ? JSON.stringify(r.clipped) : "none"}`)
  } catch (error) {
    console.log(`fail ${label}: ${error.message}`)
  } finally {
    await page.close()
  }
}
await browser.close()
console.log(`\nshots written to ${OUT}/`)
