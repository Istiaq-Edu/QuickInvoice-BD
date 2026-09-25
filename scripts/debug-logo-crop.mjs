// Debug harness: drives the real guest logo upload flow in a browser so crop
// behaviour can be observed rather than assumed. Not part of the test suite.
import { chromium } from "@playwright/test"
import { mkdirSync, statSync, writeFileSync } from "node:fs"

const BASE = "http://localhost:3000"
const OUT = "debug-out"
mkdirSync(OUT, { recursive: true })

const log = (...parts) => console.log(...parts)

async function makeFixture() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  // Draw a grid of labelled quadrants so the crop is visually verifiable.
  await page.setContent(`<body style="margin:0"><canvas id="c" width="1200" height="800"></canvas>
    <script>
      const c = document.getElementById('c'), x = c.getContext('2d');
      const cols = 6, rows = 4, colors = ['#e11d48','#2563eb','#16a34a','#f59e0b','#7c3aed','#0891b2'];
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        x.fillStyle = colors[(r + q) % colors.length];
        x.fillRect(q * (1200/cols), r * (800/rows), 1200/cols, 800/rows);
        x.fillStyle = '#fff'; x.font = 'bold 34px sans-serif';
        x.fillText(String.fromCharCode(65 + r) + (q + 1), q * (1200/cols) + 12, r * (800/rows) + 42);
      }
      x.strokeStyle = '#000'; x.lineWidth = 6; x.strokeRect(3, 3, 1194, 794);
    </script></body>`)
  const buffer = await page.locator("#c").screenshot()
  await browser.close()
  writeFileSync(`${OUT}/fixture.png`, buffer)
  log("fixture written", buffer.length, "bytes")
  return `${OUT}/fixture.png`
}

async function makeFixture2(name, w, h, cols, rows) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.setContent(`<body style="margin:0"><canvas id="c" width="${w}" height="${h}"></canvas>
    <script>
      const c = document.getElementById('c'), x = c.getContext('2d');
      const colors = ['#e11d48','#2563eb','#16a34a','#f59e0b','#7c3aed','#0891b2','#be123c','#0f766e'];
      for (let r = 0; r < ${rows}; r++) for (let q = 0; q < ${cols}; q++) {
        x.fillStyle = colors[(r * ${cols} + q) % colors.length];
        x.fillRect(q * (${w}/${cols}), r * (${h}/${rows}), ${w}/${cols}, ${h}/${rows});
      }
      x.strokeStyle = '#000'; x.lineWidth = 4; x.strokeRect(2, 2, ${w} - 4, ${h} - 4);
    </script></body>`)
  const buffer = await page.locator("#c").screenshot()
  await browser.close()
  const path = `${OUT}/${name}.png`
  writeFileSync(path, buffer)
  return path
}

// Proves the session logo is actually decodable by the browser, which is what
// html2canvas does internally when it rasterises the page for PDF/DOCX.
async function testExportPath(page) {
  const decoded = await page.evaluate(async () => {
    const img = document.querySelector('img[alt="Seller logo"]')
    if (!img) return { found: false }
    const src = img.currentSrc || img.src
    if (!src.startsWith("blob:")) return { found: true, blob: false }
    try {
      const probe = new Image()
      probe.src = src
      await probe.decode()
      return { found: true, blob: true, w: probe.naturalWidth, h: probe.naturalHeight }
    } catch (e) {
      return { found: true, blob: true, decodeError: String(e) }
    }
  })
  log("EXPORT logo decodable:", JSON.stringify(decoded))

  const preview = page.getByRole("button", { name: /Preview/ })
  if (await preview.count()) await preview.first().click()
  await page.waitForTimeout(700)

  // Export is a deliberate no-op while the invoice is incomplete
  // (page.tsx: `if (incomplete || !previewRef.current) return`), so fill the
  // minimum required fields before trying to download.
  await page.locator("#seller-company-name").fill("Session Seller")
  await page.locator("#seller-name").fill("Owner")
  await page.locator("#buyer-company-name").fill("Acme Buyer")
  await page.locator("#buyer-name").fill("Buyer")
  await page.locator("#buyer-phone").fill("01800000000")
  await page.locator('input[id^="description-"]:visible').first().fill("Consulting")
  await page.locator('input[id^="price-"]:visible').first().fill("1250")
  await page.waitForTimeout(900)

  for (const fmt of ["PDF", "DOCX"]) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 45000 }),
        page.getByRole("button", { name: `Download ${fmt}` }).first().click(),
      ])
      const p = await download.path()
      const size = p ? statSync(p).size : 0
      log(`EXPORT ${fmt}: ${download.suggestedFilename()} bytes=${size} ${size > 1000 ? "OK" : "SUSPICIOUS"}`)
    } catch (err) {
      const status = await page.getByText(/export failed|downloaded/i).first().innerText().catch(() => "n/a")
      log(`EXPORT ${fmt}: FAILED (${err.message.split("\n")[0]}) status="${status}"`)
    }
  }
}

async function testShapes(page) {
  const cases = [
    { name: "small", w: 200, h: 120, cols: 3, rows: 2, expect: "small logo" },
    { name: "portrait", w: 600, h: 900, cols: 2, rows: 3, expect: "portrait" },
    { name: "large", w: 3000, h: 2000, cols: 6, rows: 4, expect: "large photo" },
  ]
  for (const c of cases) {
    const file = await makeFixture2(c.name, c.w, c.h, c.cols, c.rows)
    await page.getByLabel("Upload a session logo").setInputFiles(file)
    await page.waitForTimeout(1600)
    const open = await page.getByRole("dialog").isVisible().catch(() => false)
    if (!open) { log(`SHAPE ${c.name} (${c.w}x${c.h}): dialog did not open`); continue }
    const hint = await page.getByText(/Uploads at/).innerText().catch(() => "n/a")
    const before = await box(page)
    // Drag the SE corner far inward to probe the minimum-edge guard.
    const se = page.locator('[aria-label^="Crop"]:not([aria-label^="Crop area"])').nth(4)
    const hb = await se.boundingBox()
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
      await page.mouse.down()
      await page.mouse.move(Math.max(2, hb.x - 400), Math.max(2, hb.y - 400), { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(180)
    }
    const after = await box(page)
    const held = after && after.width > 2 && after.height > 2
    log(`SHAPE ${c.name} (${c.w}x${c.h}): start=${Math.round(before.width)}x${Math.round(before.height)} afterHardShrink=${Math.round(after.width)}x${Math.round(after.height)} minGuard=${held ? "OK" : "COLLAPSED"}`)
    log(`  ${c.expect}: ${hint}`)
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.waitForTimeout(300)
  }
}

// Can the crop be expanded to cover the whole image? Compare the crop box
// against the painted canvas, which is exactly the full image area.
async function testFullArea(page) {
  await page.getByRole("button", { name: "Reset" }).click()
  await page.waitForTimeout(250)
  const start = await box(page)
  const canvas = await page.locator("canvas[aria-label='Image being cropped']").boundingBox()
  log(`FULL AREA: start=${Math.round(start.width)}x${Math.round(start.height)} image=${Math.round(canvas.width)}x${Math.round(canvas.height)} (start is ${Math.round((start.width / canvas.width) * 100)}% of width)`)

  const handles = page.locator('[aria-label^="Crop"]:not([aria-label^="Crop area"])')
  // nw = 0, se = 4. Drag both far outward; clamps should stop at the image edge.
  for (const [idx, label, dx, dy] of [[0, "nw", -600, -600], [4, "se", 600, 600]]) {
    const h = handles.nth(idx)
    const hb = await h.boundingBox()
    if (!hb) { log(`FULL AREA ${label}: no box`); continue }
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2 + dy, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const b = await box(page)
    log(`FULL AREA after ${label} drag: ${Math.round(b.width)}x${Math.round(b.height)} at (${Math.round(b.x)},${Math.round(b.y)})`)
  }

  const finalBox = await box(page)
  const finalCanvas = await page.locator("canvas[aria-label='Image being cropped']").boundingBox()
  const dw = Math.round(finalBox.width - finalCanvas.width)
  const dh = Math.round(finalBox.height - finalCanvas.height)
  const covers = Math.abs(dw) <= 3 && Math.abs(dh) <= 3
  log(`FULL AREA result: crop=${Math.round(finalBox.width)}x${Math.round(finalBox.height)} vs image=${Math.round(finalCanvas.width)}x${Math.round(finalCanvas.height)} shortfall=${dw}x${dh} ${covers ? "FULL AREA REACHABLE" : "CANNOT REACH FULL AREA"}`)

  // With the crop filling the image, every handle sits on the image edge, so
  // they must still be grabbable and must still shrink on an inward drag.
  await page.getByRole("button", { name: "Reset" }).click()
  await page.waitForTimeout(250)
  const resetBox = await box(page)
  const resetCanvas = await page.locator("canvas[aria-label='Image being cropped']").boundingBox()
  log(`RESET is full image: ${Math.abs(Math.round(resetBox.width - resetCanvas.width)) <= 3 && Math.abs(Math.round(resetBox.height - resetCanvas.height)) <= 3 ? "YES" : "NO"} (${Math.round(resetBox.width)}x${Math.round(resetBox.height)} vs ${Math.round(resetCanvas.width)}x${Math.round(resetCanvas.height)})`)

  const grab = []
  for (let i = 0; i < 8; i++) {
    const h = handles.nth(i)
    const label = await h.getAttribute("aria-label")
    const hb = await h.boundingBox()
    if (!hb) { grab.push(`${label}:NO BOX`); continue }
    const cx = hb.x + hb.width / 2
    const cy = hb.y + hb.height / 2
    const hit = await describeAt(page, cx, cy)
    const b4 = await box(page)
    // Inward: toward the centre of the crop.
    const dx = cx < b4.x + b4.width / 2 ? 30 : -30
    const dy = cy < b4.y + b4.height / 2 ? 30 : -30
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + dx, cy + dy, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(130)
    const af = await box(page)
    const changed = Math.abs(af.width - b4.width) > 2 || Math.abs(af.height - b4.height) > 2
    grab.push(`${String(label).replace("Crop ", "")}:${hit.includes("aria-label") ? "hit" : "BLOCKED"}/${changed ? "shrinks" : "noChange"}`)
  }
  log("GRABBABLE AT FULL AREA: " + grab.join("  "))
}

const box = (page) => page.getByRole("application", { name: /crop area/i }).boundingBox()

async function describeAt(page, x, y) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py)
    if (!el) return "null"
    const label = el.getAttribute("aria-label")
    return `${el.tagName.toLowerCase()}${label ? `[aria-label="${label}"]` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : ""}`
  }, [x, y])
}

async function testHandles(page) {
  // "Crop area" also starts with "Crop", so exclude the move region itself.
  const handles = page.locator('[aria-label^="Crop"]:not([aria-label^="Crop area"])')
  const count = await handles.count()
  log("HANDLE COUNT:", count)
  const vp = page.viewportSize() ?? { width: 1280, height: 900 }
  const results = []
  const reset = async () => {
    await page.getByRole("button", { name: "Reset" }).click()
    await page.waitForTimeout(150)
  }
  for (let i = 0; i < count; i++) {
    const h = handles.nth(i)
    const label = await h.getAttribute("aria-label")
    // Reset first: the crop starts at 92% inset, so dragging OUTWARD is
    // already pinned against the image edge and correctly clamps to zero.
    await reset()
    const hb = await h.boundingBox()
    if (!hb) { results.push(`${label}: NO BOX`); continue }
    const before = await box(page)
    const clamp = (n) => Math.max(1, Math.min(vp.width - 1, Math.round(n)))
    const cx = clamp(hb.x + hb.width / 2)
    const cy = clamp(hb.y + hb.height / 2)
    const hit = await describeAt(page, cx, cy)
    const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
    // Drag INWARD, toward the centre: there is always room to shrink.
    const dx = cx < centre.x ? 40 : -40
    const dy = cy < centre.y ? 40 : -40
    try {
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(clamp(cx + dx), clamp(cy + dy), { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(140)
      const after = await box(page)
      const d = (a, b) => Math.round(a - b)
      const dW = d(after.width, before.width)
      const dH = d(after.height, before.height)
      const edgeOnly = (label.includes("edge") && (dW === 0 || dH === 0)) && !(dW && dH)
      const verdict = (dW || dH) ? (edgeOnly ? "EDGE-PULLED-OTHER-AXIS" : "OK") : "NOTHING"
      results.push(`${String(label).padEnd(20)} hit=${hit.includes("aria-label") ? "handle" : "OTHER"} dW=${String(dW).padStart(5)} dH=${String(dH).padStart(5)} ${verdict}`)
    } catch (err) {
      await page.mouse.up().catch(() => {})
      results.push(`${String(label).padEnd(20)} DRAG ERROR: ${err.message.split("\n")[0]}`)
    }
  }
  log("HANDLE DRAG RESULTS (inward):\n  " + results.join("\n  "))
}

// Shrink the crop so there is room to move it; at full area a move is
// correctly clamped to zero and the test would prove nothing.
async function shrinkFirst(page) {
  await page.getByRole("button", { name: "Reset" }).click()
  await page.waitForTimeout(200)
  const se = page.locator('[aria-label^="Crop"]:not([aria-label^="Crop area"])').nth(4)
  const hb = await se.boundingBox()
  if (!hb) return
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x - 60, hb.y - 40, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(180)
  return box(page)
}

async function testMove(page) {
  await shrinkFirst(page)
  const before = await box(page)
  const c = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
  const hit = await describeAt(page, c.x, c.y)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  // Drag down-right: inside the image, so the move must be honoured.
  await page.mouse.move(c.x + 30, c.y + 20, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(140)
  const after = await box(page)
  const dx = Math.round(after.x - before.x)
  const dy = Math.round(after.y - before.y)
  const sizeHeld = Math.round(after.width - before.width) === 0 && Math.round(after.height - before.height) === 0
  log("MOVE: hit=", hit.includes("Crop area") ? "crop-area" : hit.slice(0, 40),
      "dx=", dx, "dy=", dy, "sizeHeld=", sizeHeld,
      (dx > 0 && dy > 0 && sizeHeld) ? "OK (clamped by image edge if < 30/20)" : "UNEXPECTED")
}

async function testAspects(page) {
  const expected = { Square: 1, "4:3": 4 / 3, "16:9": 16 / 9 }
  for (const name of ["Square", "4:3", "16:9", "Free"]) {
    const b = await box(page)
    await page.getByRole("button", { name, exact: true }).click()
    await page.waitForTimeout(150)
    const a = await box(page)
    const ratio = a.width / a.height
    const areaChange = Math.round((a.width * a.height / (b.width * b.height) - 1) * 100)
    const ok = expected[name] ? (Math.abs(ratio - expected[name]) < 0.02 ? "OK" : "MISMATCH") : "free"
    log(`ASPECT ${name.padEnd(7)} ratio=${ratio.toFixed(3)} ${ok} areaChange=${areaChange}%`)
  }
}

async function testZoom(page) {
  // Reset first, then walk the zoom range, to prove a zoom round trip is
  // non-destructive: the crop must come back to the size it started at.
  await page.getByRole("button", { name: "Reset" }).click()
  await page.waitForTimeout(200)
  const start = await box(page)
  const sizes = []
  for (const v of ["2", "1.5", "1"]) {
    await page.locator('input[aria-label="Zoom"]').fill(v)
    await page.waitForTimeout(250)
    const b = await box(page)
    sizes.push({ v, w: Math.round(b.width), h: Math.round(b.height) })
  }
  const back = sizes[sizes.length - 1]
  const restored = Math.abs(back.w - Math.round(start.width)) <= 2 && Math.abs(back.h - Math.round(start.height)) <= 2
  log("ZOOM round trip: start=", Math.round(start.width) + "x" + Math.round(start.height),
      "steps=", sizes.map((s) => `${s.v}:${s.w}x${s.h}`).join(" -> "),
      restored ? "RESTORED OK" : "CROP LOST")
}


async function testKeyboardAndReset(page) {
  // Shrink first: the default crop is now the full image, where an outward
  // nudge is correctly clamped to zero and would prove nothing.
  await shrinkFirst(page)
  const before = await box(page)
  await page.getByRole("application", { name: /crop area/i }).focus()
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(150)
  const after = await box(page)
  const dx = Math.round(after.x - before.x)
  log("KEYBOARD ArrowRight: dx=", dx, dx === 8 ? "OK (8 screen px)" : dx === 0 ? "clamped at edge" : "UNEXPECTED")

  await page.getByRole("button", { name: "Reset" }).click()
  await page.waitForTimeout(200)
  log("RESET box:", JSON.stringify(await box(page)))
}

async function testConfirmAndPersist(page) {
  log("OUTPUT HINT:", await page.getByText(/Uploads at/).innerText().catch(() => "n/a"))
  await page.getByRole("button", { name: "Use this crop" }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/05-after-confirm.png` })
  log("preview logo count:", await page.locator('img[alt="Seller logo"]').count())
  log("session message:", await page.getByText(/session only|browser only/i).first().innerText().catch(() => "none"))

  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  log("preview logo after reload:", await page.locator('img[alt="Seller logo"]').count())
}

async function main() {
  const fixture = await makeFixture()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`) })

  try {
    await page.goto(BASE, { waitUntil: "networkidle" })
    const fromStep = page.getByRole("button", { name: "From" })
    if (await fromStep.count()) await fromStep.first().click()
    const input = page.getByLabel("Upload a session logo")
    await input.waitFor({ state: "visible", timeout: 15000 })
    await input.setInputFiles(fixture)

    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 20000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/01-cropper-open.png` })

    // The image must actually be painted, not a revoked blob URL.
    const canvasInfo = await page.evaluate(() => {
      const c = document.querySelector("canvas[aria-label='Image being cropped']")
      if (!c) return { present: false }
      const ctx = c.getContext("2d")
      const data = ctx.getImageData(0, 0, c.width, c.height).data
      let painted = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
      return { present: true, width: c.width, height: c.height, opaquePixels: painted, total: data.length / 4 }
    })
    log("CANVAS:", JSON.stringify(canvasInfo))
    log("INITIAL box:", JSON.stringify(await box(page)))

    await testHandles(page)
    await page.screenshot({ path: `${OUT}/02-after-handles.png` })
    await testMove(page)
    await testAspects(page)
    await page.screenshot({ path: `${OUT}/03-aspect.png` })
    await testZoom(page)
    await page.screenshot({ path: `${OUT}/04-zoom.png` })
    await testKeyboardAndReset(page)
    await testFullArea(page)
    await testConfirmAndPersist(page)
    await testExportPath(page)
    await testShapes(page)
  } catch (failure) {
    log("HARNESS FAILURE:", failure.message)
    await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {})
  }

  log("JS ERRORS:", errors.length ? errors : "none")
  await browser.close()
}

main().catch((e) => { console.error("HARNESS FAILED:", e); process.exit(1) })
