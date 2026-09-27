import { chromium } from "@playwright/test"

// The ৳ is drawn by a self-hosted Noto Sans Bengali, so its metrics are identical
// on every machine and one trustworthy measurement is possible: render the sign
// and a digit at the SAME font-size in a single run, and count each one's ink rows
// from a screenshot. Equal sizes are the whole point -- an earlier version of this
// probe compared a sign at 110px against a digit at 200px, which is why it
// returned an identical ratio for two different sizes and had to be discarded.
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" })
await page.waitForTimeout(1500)

const loaded = await page.evaluate(async () => {
  await document.fonts.ready
  const sign = document.querySelector(".money .taka")
  const money = document.querySelector(".money")
  return {
    signFamily: getComputedStyle(sign).fontFamily.split(",")[0],
    moneyFamily: getComputedStyle(money).fontFamily.split(",")[0],
    bengaliReady: document.fonts.check('16px "Noto Sans Bengali"', "\u09F3"),
  }
})
console.log(`sign family : ${loaded.signFamily}`)
console.log(`money family: ${loaded.moneyFamily}`)
console.log(`Noto Sans Bengali serves the sign: ${loaded.bengaliReady}`)

const inkRows = async (text, family, size) => {
  await page.evaluate(
    ({ text, family, size }) => {
      const probe = document.createElement("div")
      probe.id = "ink-probe"
      probe.style.cssText =
        "position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000;" +
        `font-family:${family};font-size:${size}px;line-height:1;width:max-content`
      probe.textContent = text
      document.body.appendChild(probe)
    },
    { text, family, size },
  )
  const shot = await page.locator("#ink-probe").screenshot()
  const rows = await page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement("canvas")
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let top = -1
    let bottom = -1
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4
        if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) {
          if (top === -1) top = y
          bottom = y
          break
        }
      }
    }
    return bottom - top + 1
  }, `data:image/png;base64,${shot.toString("base64")}`)
  await page.evaluate(() => document.getElementById("ink-probe")?.remove())
  return rows
}

const SIZE = 200
const signInk = await inkRows("\u09F3", loaded.signFamily, SIZE)
const digitInk = await inkRows("0", loaded.moneyFamily, SIZE)
const currentEm = await page.locator(".money .taka").first().evaluate((el) => {
  const parent = parseFloat(getComputedStyle(el.parentElement).fontSize)
  return parseFloat(getComputedStyle(el).fontSize) / parent
})


// Both glyphs above were rendered at the same font-size, so signInk/digitInk is the
// sign height relative to a digit at 1em. The live sign renders at currentEm, so its
// rendered ratio is that number times currentEm -- dividing by currentEm again, as an
// earlier version of this script did, double-counted the scale and produced 0.577em
// instead of 0.74em.
const measured = signInk / digitInk
const rendered = measured * currentEm
const target = 1 / measured

console.log(`  ink ratio at 1em: ${measured.toFixed(3)}`)
console.log(`  rendered ratio  : ${rendered.toFixed(3)}  (1.00 = matched with the digits)`)
console.log(``)
console.log(`current .taka = ${currentEm.toFixed(3)}em, rendering at ${rendered.toFixed(3)} of the digit height`)
console.log(`=> to match the digits exactly, use ${target.toFixed(3)}em`)

if (Math.abs(rendered - 1) > 0.05) {
  console.log(``)
  console.log(`FAIL: the sign is ${rendered > 1 ? "larger" : "smaller"} than the digits by ${(Math.abs(rendered - 1) * 100).toFixed(0)}%`)
  await browser.close()
  process.exit(1)
}
console.log(``)
console.log("PASS: the sign sits within 5% of the digit height")

await browser.close()
