// Temporary visual-review helper. Captures full-page screenshots of public routes.
// Usage: node scripts/capture-shots.mjs
import { mkdirSync } from "node:fs"
import { chromium } from "@playwright/test"

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000"
const OUT = "shots"
const ONLY = (process.env.SHOT_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const ROUTES = [
  ["home", "/"],
  ["login", "/auth/login"],
  ["signup", "/auth/signup"],
  ["invoices", "/invoices"],
  ["trash", "/invoices/trash"],
  ["customers", "/customers"],
  ["settings", "/account/settings"],
  ["admin", "/admin/allowlist"],
].filter(([name]) => ONLY.length === 0 || ONLY.includes(name))

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

for (const [name, path] of ROUTES) {
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport })
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45_000 })
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: label === "desktop" })
      console.log(`ok   ${name}-${label} -> ${path}`)
    } catch (error) {
      console.log(`fail ${name}-${label} -> ${path}: ${error.message}`)
    } finally {
      await page.close()
    }
  }
}

await browser.close()
