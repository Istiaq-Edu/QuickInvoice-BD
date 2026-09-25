// Full assessment of the logo cropper.
// The question that matters: can the crop be expanded to cover the whole
// image, at every viewport size, at every zoom level, and with touch?
import { chromium } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = "http://localhost:3000"
const OUT = "debug-out"
mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(...a)

const box = (page) => page.getByRole("application", { name: /crop area/i }).boundingBox()
const canvasBox = (page) => page.locator("canvas[aria-label='Image being cropped']").boundingBox()

async function fixture(name, w, h) {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.setContent(`<body style="margin:0"><canvas id="c" width="${w}" height="${h}"></canvas><script>
    const c=document.getElementById('c'),x=c.getContext('2d');
    const cols=['#e11d48','#2563eb','#16a34a','#f59e0b','#7c3aed','#0891b2'];
    for(let r=0;r<4;r++)for(let q=0;q<6;q++){x.fillStyle=cols[(r+q)%6];x.fillRect(q*(${w}/6),r*(${h}/4),${w}/6,${h}/4);}
    x.strokeStyle='#000';x.lineWidth=6;x.strokeRect(3,3,${w}-6,${h}-6);
  </script></body>`)
  const buf = await p.locator("#c").screenshot()
  await b.close()
  const f = `${OUT}/${name}.png`
  writeFileSync(f, buf)
  return f
}

// Drag with real touch events, exercising the pointerType="touch" path
// rather than the mouse path.
async function touchDrag(page, client, from, to) {
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] })
  for (let i = 1; i <= 8; i++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }],
    })
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await page.waitForTimeout(240)
}

async function mouseDrag(page, _client, from, to) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(220)
}

// Shrink a corner, then drag the SAME corner back outward until it stops
// growing. Dragging the opposite corner cannot grow a crop that is already
// flush against that image edge; the clamp is correct, not a bug.
async function shrinkAndRegrow(page, client, drag, index, img) {
  const handle = page.locator('[aria-label^="Crop"]:not([aria-label^="Crop area"])').nth(index)
  const hb0 = await handle.boundingBox()
  if (!hb0) return null
  const cx = hb0.x + hb0.width / 2
  const cy = hb0.y + hb0.height / 2
  const cb = await box(page)
  // Outward direction for this handle: a right/bottom handle grows to the
  // right/down (+1), a left/top handle grows to the left/up (-1).
  const dirX = cx >= cb.x + cb.width / 2 ? 1 : -1
  const dirY = cy >= cb.y + cb.height / 2 ? 1 : -1
  await drag(page, client, { x: cx, y: cy }, { x: Math.max(2, cx - dirX * 100), y: Math.max(2, cy - dirY * 70) })
  const shrunk = await box(page)
  let last = -1
  for (let i = 0; i < 30; i++) {
    const cur = await box(page)
    if (Math.abs(cur.width - img.width) <= 4 && Math.abs(cur.height - img.height) <= 4) return { shrunk, grown: cur }
    if (Math.round(cur.width) === last) return { shrunk, grown: cur }
    last = Math.round(cur.width)
    const hb = await handle.boundingBox()
    if (!hb) return { shrunk, grown: cur }
    const hx = hb.x + hb.width / 2
    const hy = hb.y + hb.height / 2
    await drag(page, client, { x: hx, y: hy }, { x: Math.max(2, hx + dirX * 50), y: Math.max(2, hy + dirY * 40) })
  }
  return { shrunk, grown: await box(page) }
}

async function assess(label, viewport, zoomSteps, useTouch) {
  const file = await fixture(`fx-${label}`, 1200, 800)
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport, hasTouch: useTouch, isMobile: useTouch, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  const client = await context.newCDPSession(page)
  const drag = useTouch ? touchDrag : mouseDrag

  await page.goto(BASE, { waitUntil: "networkidle" })
  const from = page.getByRole("button", { name: "From" })
  if (await from.count()) await from.first().click()
  await page.getByLabel("Upload a session logo").setInputFiles(file)
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 20000 })
  await page.waitForTimeout(900)

  const results = []
  const initial = await box(page)
  const cb0 = await canvasBox(page)
  results.push(`open=${Math.round(initial.width)}x${Math.round(initial.height)} image=${Math.round(cb0.width)}x${Math.round(cb0.height)} ${Math.abs(initial.width - cb0.width) <= 3 ? "FULL" : "PARTIAL"}`)

  for (const z of zoomSteps) {
    await page.locator('input[aria-label="Zoom"]').fill(String(z))
    await page.waitForTimeout(250)

    await page.getByRole("button", { name: "Reset" }).click()
    await page.waitForTimeout(250)
    const afterReset = await box(page)
    const img = await canvasBox(page)
    const resetFull = Math.abs(afterReset.width - img.width) <= 3 && Math.abs(afterReset.height - img.height) <= 3

    // Shrink a corner, then win the full area back with the same corner.
    const cycle = await shrinkAndRegrow(page, client, drag, 4, img)
    const shrunk = cycle?.shrunk
    const grew = cycle?.grown
    const full = grew && Math.abs(grew.width - img.width) <= 4 && Math.abs(grew.height - img.height) <= 4
    const fmt = (r) => (r ? Math.round(r.width) + "x" + Math.round(r.height) : "n/a")
    results.push(`zoom${z}: resetFull=${resetFull ? "YES" : "NO"} shrink=${fmt(shrunk)} regrow=${fmt(grew)} fullArea=${full ? "OK" : "BLOCKED"}`)
  }

  await page.screenshot({ path: `${OUT}/assess-${label}.png` })
  log(`\n[${label}] ${viewport.width}x${viewport.height} ${useTouch ? "TOUCH" : "mouse"}`)
  log("  " + results.join("\n  "))
  if (errors.length) log("  JS ERRORS: " + errors.join(" | "))
  await browser.close()
}

async function main() {
  await assess("desktop-1440", { width: 1440, height: 900 }, [1, 2], false)
  await assess("short-1280x620", { width: 1280, height: 620 }, [1, 2], false)
  await assess("tablet-834", { width: 834, height: 1112 }, [1, 2], false)
  await assess("mobile-375", { width: 375, height: 667 }, [1, 2], false)
  await assess("mobile-320", { width: 320, height: 568 }, [1], false)
  await assess("touch-375", { width: 375, height: 667 }, [1, 2], true)
  log("\nassessment complete")
}

main().catch((e) => { console.error("ASSESSMENT FAILED:", e); process.exit(1) })
