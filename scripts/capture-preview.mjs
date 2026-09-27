import { chromium } from "@playwright/test"

// Captures the A4 document itself. Changing `.money` to a tabular face affects the
// printed artefact as well as the editor, and the document is what the customer
// actually receives, so it has to be looked at rather than assumed to be fine.
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" })
await page.waitForTimeout(1200)

// The editor's Field renders <label for="id"> around a nested input, and some of
// those labels carry a required asterisk, so the name a label matcher computes is
// not the plain text. Address the inputs by the id their label points at, which
// is what the label actually binds to.
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
await page.locator('input[id^="description-"]').first().fill("Website design — homepage")
await page.locator('input[id^="price-"]').first().fill("48500")
await page.getByRole("button", { name: "Add another item", exact: true }).click()
await page.locator('input[id^="description-"]').nth(1).fill("Monthly retainer")
await page.locator('input[id^="price-"]').nth(1).fill("32000")
await page.waitForTimeout(800)

const paper = page.locator(".invoice-paper").first()
await paper.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await paper.screenshot({ path: "shots/preview-document.png" })
console.log("preview captured")

await browser.close()
