import { chromium } from "@playwright/test"

// Visual + geometric check for the printed-column toolbar and the conditional
// discount column. Writes PNGs into shots/ and prints the grid template each
// state resolved to, so a column that silently keeps its track is visible.
const PORT = process.env.PREVIEW_PORT || "3100"
const URL = `http://127.0.0.1:${PORT}/`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
await page.goto(URL, { waitUntil: "networkidle" })
await page.waitForTimeout(900)

const fieldId = async (scope, labelText) => {
  const id = await scope.locator("label").filter({ hasText: labelText }).first().getAttribute("for")
  if (!id) throw new Error(`no label found for "${labelText}"`)
  return `#${id}`
}
const details = page.locator("fieldset .surface").nth(1)
const billTo = page.locator("fieldset .surface").nth(2)
await page.locator(await fieldId(details, "Company name")).fill("Studio Nodi")
await page.locator(await fieldId(details, "Seller name")).fill("Farhana Islam")
await page.locator(await fieldId(billTo, "Buyer name")).fill("Rahim Uddin")
await page.locator(await fieldId(billTo, "Phone")).fill("01711000000")

const description = page.locator('input[id^="description-"]').first()
await description.fill("Brand identity system")
await page.locator('input[id^="quantity-"]').first().fill("2")
await page.locator('input[id^="price-"]').first().fill("12500")
await page.locator('button:has-text("Add another item")').click()
await page.locator('input[id^="description-"]').nth(1).fill("Landing page build")
await page.locator('input[id^="quantity-"]').nth(1).fill("1")
await page.locator('input[id^="price-"]').nth(1).fill("40000")
await page.waitForTimeout(900)

const items = page.locator("fieldset .surface").nth(3)
await items.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await items.screenshot({ path: "shots/columns-toolbar.png" })

const gridState = () =>
  page.evaluate(() => {
    const grid = document.querySelector(".invoice-paper .invoice-line-grid")
    const header = Array.from(grid.children).map((c) => c.textContent.trim())
    return {
      cells: header,
      tracks: getComputedStyle(grid).gridTemplateColumns,
      discountAttr: grid.dataset.discount,
      qtyAttr: grid.dataset.qty,
    }
  })

const readPreview = async (label) => {
  const state = await gridState()
  console.log(label, JSON.stringify(state))
  const paper = page.locator(".invoice-paper").first()
  await paper.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await paper.screenshot({ path: `shots/columns-${label}.png` })
  return state
}

await readPreview("no-discount")

// Give the second line a percentage discount through the editor's own control.
await page.locator('select[id^="discount-type-"]').nth(1).selectOption("percentage")
await page.locator('input[aria-label^="Discount value"]').nth(1).fill("15")
await page.waitForTimeout(900)
await readPreview("with-discount")

// Turn the quantity column off and confirm both flags compose.
await page.locator('button[role="switch"]:has-text("Qty")').click()
await page.waitForTimeout(700)
const off = await readPreview("qty-off-with-discount")

// Mobile toolbar.
const mobile = await browser.newPage({ viewport: { width: 375, height: 844 }, isMobile: true, deviceScaleFactor: 2 })
await mobile.goto(URL, { waitUntil: "networkidle" })
await mobile.waitForTimeout(800)
await mobile.locator("nav[aria-label='Invoice steps'] button").nth(3).click()
await mobile.waitForTimeout(600)
await mobile.locator("fieldset .surface").nth(3).screenshot({ path: "shots/columns-toolbar-mobile.png" })

// The preview's display-options panel, now document-wide only.
await page.locator("#display-options-toggle").click()
await page.waitForTimeout(500)
await page.locator("#invoice-display").screenshot({ path: "shots/columns-customize-panel.png" })

// The two cross-references, and where focus actually lands. A scroll that moves
// the viewport but leaves focus behind is invisible in a screenshot, so it is
// measured here rather than looked at.
await page.locator("a[href='#invoice-display']").click()
await page.waitForTimeout(800)
console.log("bridge to panel", JSON.stringify(await page.evaluate(() => ({
  panelPresent: Boolean(document.getElementById("invoice-display")),
  focus: document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName,
  panelTop: Math.round(document.getElementById("invoice-display")?.getBoundingClientRect().top ?? -1),
}))))

await page.locator("#invoice-display button", { hasText: "Line items" }).first().click()
await page.waitForTimeout(800)
console.log("bridge to items", JSON.stringify(await page.evaluate(() => ({
  panelPresent: Boolean(document.getElementById("invoice-display")),
  focusRole: document.activeElement?.getAttribute("role"),
  focusName: document.activeElement?.textContent?.trim(),
  sectionTop: Math.round(document.getElementById("line-items")?.getBoundingClientRect().top ?? -1),
}))))

console.log("qty-off state", JSON.stringify(off))
await browser.close()
