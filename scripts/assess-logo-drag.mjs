// Drag-smoothness assessment for the logo cropper.
//
// The question that matters: does the crop follow the pointer on every frame,
// with the main thread left free for the browser to paint?
//
// Two costs are separated:
//   * Compositor work. A backdrop-filter that wraps the moving overlay is
//     invalidated on every drag frame and never shows up in main-thread
//     counters, so it is measured as delivered frames per second during a real,
//     fixed-cadence drag.
//   * Main-thread work. Re-rendering the dialog on every pointer event is
//     measured with Chrome's cumulative Script/Style/Layout counters.
import { chromium } from "@playwright/test"

const BASE = "http://localhost:3000"
const OUT = "debug-out"
const HEADFUL = process.env.HEADFUL === "1"
const MOVES = 160
const MOVE_INTERVAL_MS = 8

const readMetrics = (payload) => payload.metrics.reduce((acc, m) => ((acc[m.name] = m.value), acc), {})

async function openCropper(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  const fromStep = page.getByRole("button", { name: "From" })
  if (await fromStep.count()) await fromStep.first().click()
  await page.getByLabel("Upload a session logo").setInputFiles(`${OUT}/fx-desktop-1440.png`)
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 20000 })
  await page.waitForTimeout(700)
}

const frameRecorder = () => {
  window.__frames = []
  let last = performance.now()
  const tick = (now) => {
    window.__frames.push(now - last)
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

async function frameStats(page, elapsed) {
  const frames = await page.evaluate(() => window.__frames.slice(1))
  const sorted = [...frames].sort((a, b) => a - b)
  return {
    fps: frames.length / elapsed,
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    worst: sorted[sorted.length - 1] || 0,
  }
}

// Chrome's own frame cadence with the cropper open and nothing happening. Any
// drag result at this level means no frame was lost to the cropper.
async function measureIdle(page) {
  await page.evaluate(frameRecorder)
  const start = Date.now()
  await page.waitForTimeout(1500)
  const stats = await frameStats(page, (Date.now() - start) / 1000)
  console.log(`idle              fps=${stats.fps.toFixed(1)} p50=${stats.p50.toFixed(1)}ms max=${stats.worst.toFixed(1)}ms`)
}

async function measureDrag(page, client, label, css) {
  if (css) await page.addStyleTag({ content: css })
  // Shrink first: a crop that fills the image is correctly clamped to zero
  // movement, so a full-area drag would prove nothing.
  const handle = page.locator('[aria-label="Crop bottom right"]')
  const hb = await handle.boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2 - 150, hb.y + hb.height / 2 - 150)
  await page.mouse.up()
  await page.waitForTimeout(200)

  const bb = await page.getByRole("application", { name: /crop area/i }).boundingBox()
  await page.evaluate(frameRecorder)
  const before = readMetrics(await client.send("Performance.getMetrics"))

  const start = Date.now()
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, button: "left", buttons: 1, clickCount: 1 })
  for (let i = 0; i < MOVES; i++) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: bb.x + 20 + (bb.width - 60) * ((i % 80) / 80),
      y: bb.y + 20 + (bb.height - 60) * ((i % 40) / 40),
      button: "left",
      buttons: 1,
    })
    await page.waitForTimeout(MOVE_INTERVAL_MS)
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bb.x + 20, y: bb.y + 20, button: "left", buttons: 0, clickCount: 1 })
  const elapsed = (Date.now() - start) / 1000
  const after = readMetrics(await client.send("Performance.getMetrics"))
  const stats = await frameStats(page, elapsed)

  const ms = (v) => (v * 1000).toFixed(0).padStart(4)
  console.log(
    `${label.padEnd(17)} fps=${stats.fps.toFixed(1)} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.worst.toFixed(1)}ms | task=${ms(after.TaskDuration - before.TaskDuration)}ms script=${ms(after.ScriptDuration - before.ScriptDuration)}ms style=${ms(after.RecalcStyleDuration - before.RecalcStyleDuration)}ms layout=${ms(after.LayoutDuration - before.LayoutDuration)}ms`,
  )
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADFUL })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  const client = await page.context().newCDPSession(page)
  await client.send("Performance.enable")

  await openCropper(page)
  await measureIdle(page)
  await measureDrag(page, client, HEADFUL ? "dragging (gpu)" : "dragging", "")
  console.log(HEADFUL ? "  (headful: real compositor)" : "  (headless: software raster, slower than a real browser)")
  if (errors.length) console.log("  JS ERRORS: " + errors.join(" | "))
  await browser.close()
}

main().catch((e) => {
  console.error("ASSESSMENT FAILED:", e)
  process.exit(1)
})
