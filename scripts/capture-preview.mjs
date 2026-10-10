import { chromium } from "@playwright/test"

// Captures the A4 document itself. Changing `.money` to a tabular face affects the
// printed artefact as well as the editor, and the document is what the customer
// actually receives, so it has to be looked at rather than assumed to be fine.
//
// This is a CAPTURE tool, not a gate: it writes PNGs and prints the geometry it
// saw, and always exits 0. The assertions live in `check:table` and
// `check:pagination`; a screenshot cannot fail, so nothing here is allowed to
// pretend otherwise.
//
// The port defaults to 3100 because that is where `check:table` and
// `check:pagination` expect the app. It used to be hardcoded to 3000, which is
// Playwright's own port — so running this by hand, against the dev server the
// other two scripts use, silently captured whatever else happened to be there.
const PORT = process.env.PREVIEW_PORT || "3100"
const URL = `http://127.0.0.1:${PORT}/`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
await page.goto(URL, { waitUntil: "networkidle" })
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

// Enough line items to spill onto a second page, so the pagination is exercised
// rather than trivially showing one sheet.
for (let index = 1; index <= 26; index += 1) {
  const filled = await page.locator('input[id^="description-"]:visible').count()
  if (filled < index) {
    await page.getByRole("button", { name: "Add another item", exact: true }).click()
    // The new row mounts on the next frame; filling before it exists times out.
    // The count has to be of every matching input, not of the `:not([hidden])`
    // subset — nothing sets `hidden` on these, so that filter matched all of them
    // by accident and would have kept "working" right up until a row was reused.
    await page.waitForFunction(
      (expected) => document.querySelectorAll('input[id^="description-"]').length >= expected,
      index,
      { timeout: 10_000 },
    ).catch(() => undefined)
  }
  await page.locator('input[id^="description-"]:visible').nth(index - 1).fill(`Retainer milestone ${index}`)
  await page.locator('input[id^="quantity-"]:visible').nth(index - 1).fill("1")
  await page.locator('input[id^="price-"]:visible').nth(index - 1).fill("12500")
}
await page.waitForTimeout(1200)

const paper = page.locator(".invoice-paper").first()
await paper.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)

// Reports the geometry the paginated preview actually built.
//
// This used to look for `.paper-break` rules drawn inside the sheet and compare
// their offsets against where the slicer would cut. Those elements were removed
// when the pages became real geometry, so the query returned an empty list and
// `maxDriftPx` degenerated into `Math.max(..., 0)` — a number that is zero by
// construction and so could never report drift. It measured nothing at all while
// looking like a measurement.
//
// What is reported now is the thing the rules were standing in for: the sheets
// themselves, their real gaps, and how far each one insets its content.
const result = await page.evaluate(() => {
  const sheets = Array.from(document.querySelectorAll(".invoice-page"))
  const copies = Array.from(document.querySelectorAll(".invoice-page-content"))
  const sheet0 = sheets[0]?.getBoundingClientRect()
  const content0 = copies[0]?.getBoundingClientRect()
  const canonicalWidth = Number.parseFloat(document.querySelector(".invoice-pages")?.style.width ?? "")
  const scale = sheet0 && canonicalWidth ? sheet0.width / canonicalWidth : 1
  // Raw, UNROUNDED, for the arithmetic below. Rounding the frame and the margin to
  // whole pixels first and then multiplying by the page index accumulated about half
  // a pixel per page, so the report showed a phantom 1px of drift on pages two and
  // three — a margin that was in fact identical on every page. `check:pagination`
  // measures the same thing without rounding and reports exact equality; this file
  // must not disagree with the gate that guards it.
  const rawMargin = sheet0 && content0 ? (content0.top - sheet0.top) / scale : 0
  const rawFrame = sheet0 ? sheet0.height / scale : 0
  const rawContentBox = rawFrame - rawMargin * 2
  const marginPx = Math.round(rawMargin)
  const framePx = Math.round(rawFrame)

  return {
    sheets: sheets.length,
    framePx,
    contentBoxPx: Math.round(rawContentBox),
    marginPx,
    scale: Math.round(scale * 1000) / 1000,
    heights: sheets.map((sheet) => Math.round(sheet.getBoundingClientRect().height / scale)),
    gaps: sheets.slice(1).map((sheet, i) => Math.round((sheet.getBoundingClientRect().top - sheets[i].getBoundingClientRect().bottom) / scale)),
    insets: sheets.map((sheet, index) => {
      const copy = copies[index]
      if (!copy) return -1
      const flowTop = copy.getBoundingClientRect().top + index * rawContentBox
      return Math.round((flowTop - sheet.getBoundingClientRect().top) / scale)
    }),
    ariaHidden: sheets.map((sheet) => sheet.getAttribute("aria-hidden")),
    // The paper is deliberately not clipped any more, so this should be 0. It is
    // the number that used to be silently non-zero and cost the PDF its totals.
    clippedPx: copies[0] ? copies[0].scrollHeight - Math.round(copies[0].getBoundingClientRect().height / scale) : null,
    badge: Array.from(document.querySelectorAll('[role="status"]'))
      .map((n) => n.textContent?.trim())
      .find((text) => text?.includes("page")),
  }
})

console.log(JSON.stringify(result, null, 2))
// A viewport screenshot, not an element one: the preview column is `xl:sticky`,
// and capturing the element directly makes Playwright scroll it out from under
// its own sticky ancestor, which yields a blank white sheet.
await page.evaluate(() => {
  const sheet = document.querySelector(".invoice-paper")
  if (sheet) window.scrollTo({ top: window.scrollY + sheet.getBoundingClientRect().top - 24, behavior: "instant" })
})
await page.waitForTimeout(600)
await page.screenshot({ path: "shots/preview-paginated.png" })
console.log("preview captured")

await browser.close()
