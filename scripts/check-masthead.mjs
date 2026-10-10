// Renders the document with the exact data from the reported bad layout, so the
// line-item table can be judged against the case that exposed it: a long
// wrapping description, a long buyer company name, and figures large enough to
// overrun a fixed column.
//
// This script is a GATE, not a report. It exits non-zero when the table
// regresses, and it is wired into `npm run check:table`.
import { chromium } from "@playwright/test"

// The sheet is the right-hand column and is `display: none` below `xl`, so the
// desktop layout is the only one where the table is visible at all. The width
// here is not about reaching a breakpoint: the sheet's own rules are container
// queries, so they respond to the sheet rather than to the viewport.
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
await page.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" })
await page.waitForTimeout(1200)
// Addressed by id: the labels carry required asterisks and vary in wording, and
// this fixture must not depend on copy that the UI is free to change.
const set = async (id, value) => page.locator(`#${id}:visible, #${id}`).first().fill(value)
await set("seller-company-name", "ISP Billing")
await set("seller-name", "MD.Ishtiaq Ahmed Jony")
await set("seller-address", "Baunia road, Abdullah Memorial High School, Turag, Dhaka-1230")
await set("seller-email", "ishtiaq.ahmed9999@protonmail.com")
await set("seller-phone", "01845864446")
await set("buyer-company-name", "Baunia Broadband Cable Network")
await set("buyer-name", "MD.Tahsin")
await set("buyer-address", "Bhai bhai super market, Baunia bottala, Turag, Dhaka-1230")
await set("buyer-email", "officebbcnx@gmail.com")
await set("buyer-phone", "01623754537")

// Sixteen ordinary lines plus one deliberately huge figure, and 17 rows in total so
// the alignment check has enough of them to be worth having. The money columns are
// sized to their content, so the only way to check them is to give them content
// that is genuinely wide: a ৳12,500,000 line measured 77.7px of ink and used to
// sit in a 58px track, overlapping its neighbour by 16px once a discount applied.
//
// The rows are deliberately uneven — a huge figure, a percentage discount on one
// line and a different one on another, and lines that show no discount at all —
// because a table where every row carries the same figures cannot tell an aligned
// column from a self-sized one.
const HUGE = 17
for (let index = 1; index <= HUGE; index += 1) {
  const filled = await page.locator('input[id^="description-"]:visible').count()
  if (filled < index) {
    await page.getByRole("button", { name: "Add another item", exact: true }).click()
    await page.waitForFunction(
      (n) => document.querySelectorAll('input[id^="description-"]').length >= n, index, { timeout: 10_000 },
    ).catch(() => undefined)
  }
  const huge = index === HUGE
  await page.locator('input[id^="description-"]:visible').nth(index - 1).fill(
    huge ? "Annual enterprise licence, support and onboarding" : `Monthly broadband service — cycle ${index}`,
  )
  await page.locator('input[id^="quantity-"]:visible').nth(index - 1).fill("1")
  await page.locator('input[id^="price-"]:visible').nth(index - 1).fill(huge ? "12500000" : "1850")
  // Three different discount shapes, so the discount column holds an em dash, a
  // short percentage figure and a long fixed-taka figure at the same time. That
  // mixture is the whole point: a column that sizes itself to its own content
  // looks perfectly correct in any single row and is only wrong between them.
  if (huge || index === 4) {
    await page.locator('select[id*="discount"]').nth(index - 1).selectOption("percentage")
    await page.locator('input[aria-label^="Discount value"]').nth(index - 1).fill(huge ? "40" : "10")
  } else if (index === 11) {
    await page.locator('select[id*="discount"]').nth(index - 1).selectOption("fixed")
    await page.locator('input[aria-label^="Discount value"]').nth(index - 1).fill("1250")
  }
}
await page.waitForTimeout(1400)

await page.evaluate(() => {
  const sheet = document.querySelector(".invoice-paper")
  if (sheet) window.scrollTo({ top: window.scrollY + sheet.getBoundingClientRect().top - 20, behavior: "instant" })
})
await page.waitForTimeout(500)
await page.screenshot({ path: "shots/masthead-check.png" })
/**
 * The regression this file exists to catch is TEXT colliding with TEXT, which is
 * invisible in the element boxes: a grid item's border box is its track, and text
 * that overruns a track does not widen the item. An earlier version compared
 * sibling `getBoundingClientRect()` values, which can only ever measure the
 * gutter between tracks — it reported a clean bill of health while "DISCOUNT"
 * and "AMOUNT" were touching, and while a real 16px overlap was on screen. So
 * the measurement is a Range over each cell's text, which is the ink.
 */
const metrics = await page.evaluate(() => {
  const sheet = document.querySelector(".invoice-paper")
  const grids = Array.from(sheet.querySelectorAll(".invoice-line-grid"))
  const header = grids[0]
  const rows = grids.slice(1)

  const ink = (node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    return { left: box.left, right: box.right, width: box.width }
  }
  const trackWidths = (grid) =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").map((value) => Number.parseFloat(value))

  // Each visible cell must fit the track it was given, and must not touch its
  // neighbour. A cell the narrow-sheet container query has hidden is skipped:
  // `display: none` gives it a zero-width rect at the origin, which would read as
  // a 246px overlap with the cell before it. Hidden cells are also not placed, so
  // the remaining cells shift down a track — which is why the tracks are zipped
  // against the VISIBLE cells in order rather than against raw child indexes.
  const audit = (grid) => {
    const problems = []
    const cells = Array.from(grid.children).filter(
      (cell) => getComputedStyle(cell).display !== "none" && cell.textContent.trim(),
    )
    const tracks = trackWidths(grid)
    cells.forEach((cell, index) => {
      const b = ink(cell)
      const track = tracks[index]
      // The description is meant to wrap, so only the figures are held to their
      // track; every cell is still held clear of its neighbour.
      if (index > 0 && track !== undefined && b.width - track > 0.5) {
        problems.push({ where: `"${cell.textContent.trim()}"`, overflowPx: Math.round((b.width - track) * 100) / 100 })
      }
      const next = cells[index + 1]
      if (next && b.right - ink(next).left > 0.5) {
        problems.push({
          where: `"${cell.textContent.trim()}" | "${next.textContent.trim()}"`,
          overlapPx: Math.round((b.right - ink(next).left) * 100) / 100,
        })
      }
    })
    return problems
  }

  // Column ALIGNMENT, which is a different assertion from collision. The bug this
  // file exists beside was every row sizing its own money columns, so the discount
  // figures landed on a different x in every row. Two things are checked:
  //
  //  - the track each cell occupies starts at the same x in every row, and
  //  - the widest figure in a column still fits the track it was given.
  //
  // Overlap alone cannot catch this: a column nudged two pixels sideways without
  // touching its neighbour reports clean. So the tracks are compared directly.
  const trackLeft = (cell) => Math.round(cell.getBoundingClientRect().left * 10) / 10
  const columnTracks = rows.map((row) => Array.from(row.children).map(trackLeft))
  const misaligned = []
  if (columnTracks.length) {
    for (let column = 0; column < columnTracks[0].length; column += 1) {
      const xs = [...new Set(columnTracks.map((row) => row[column]))]
      if (xs.length > 1) misaligned.push({ column, distinctX: xs.length, xs: xs.slice(0, 4) })
    }
  }

  // The page height must be READ, not re-derived. It used to be recomputed from
  // the sheet's own width as `scrollWidth * A4_RATIO`, which was only ever valid
  // while the sheet WAS the page. The margin now belongs to the page frame and the
  // flow is the content box inside it, so the same arithmetic off the content box
  // reported 610.5px — a number the exporter never uses — and `parseInt` of the
  // badge text then produced NaN pages.
  const page = document.querySelector(".invoice-page")
  const pageHeightPx = page ? Math.round(page.getBoundingClientRect().height) : 0
  // The frame is the paper; the flow advances by the CONTENT box inside it. The
  // badge guard below has to compare against the content box, because that is the
  // number of pixels a page actually holds. Reading the frame there left the guard
  // a whole margin too generous on every page.
  const pageBox = page?.getBoundingClientRect()
  const canonicalWidth = Number.parseFloat(document.querySelector(".invoice-pages")?.style.width ?? "")
  const scale = pageBox && canonicalWidth ? pageBox.width / canonicalWidth : 1
  const marginPx = pageBox ? Math.round((sheet.getBoundingClientRect().top - pageBox.top) / scale) : 0
  const contentBoxHeightPx = pageHeightPx - marginPx * 2
  const badge = Array.from(document.querySelectorAll('[role="status"]'))
    .map((n) => n.textContent?.trim())
    .find((text) => text?.includes("page"))

  return {
    sheetWidth: Math.round(sheet.getBoundingClientRect().width),
    descriptionTrack: Math.round(trackWidths(header)[0] * 100) / 100,
    lineCount: rows.length,
    tallestRow: Math.round(rows.reduce((max, row) => Math.max(max, row.getBoundingClientRect().height), 0)),
    scrollHeight: sheet.scrollHeight,
    pageHeightPx,
    contentBoxHeightPx,
    marginPx,
    misaligned,
    pageSheets: document.querySelectorAll(".invoice-page").length,
    breakRules: document.querySelectorAll(".paper-break").length,
    overlayInsideSheet: Boolean(sheet.querySelector(".paper-break")),
    statedPages: badge ? Number.parseInt(badge.match(/\d+/)?.[0] ?? "", 10) : null,
    headerCollisions: audit(header),
    rowCollisions: rows.flatMap((row) => audit(row)),
  }
})

console.log("METRICS", JSON.stringify(metrics, null, 2))
await browser.close()

// The thresholds are the point of the file. Printing a number and exiting 0 is
// not a check, and that is how this regression shipped once already.
const failures = []
if (metrics.headerCollisions.length) failures.push(`header collisions: ${JSON.stringify(metrics.headerCollisions)}`)
if (metrics.rowCollisions.length) failures.push(`row collisions: ${JSON.stringify(metrics.rowCollisions)}`)
if (metrics.misaligned.length) failures.push(`columns not aligned across rows: ${JSON.stringify(metrics.misaligned)}`)
if (metrics.lineCount !== HUGE) failures.push(`expected ${HUGE} line rows, found ${metrics.lineCount}`)
if (metrics.descriptionTrack < 60) failures.push(`description track collapsed to ${metrics.descriptionTrack}px`)
if (metrics.overlayInsideSheet) failures.push("page-break rules are inside the measured sheet and inflate its scrollHeight")
if (metrics.marginPx <= 0) failures.push(`page margin measured as ${metrics.marginPx}px; the flow must sit inside the paper`)
if (metrics.statedPages !== null && metrics.statedPages * metrics.contentBoxHeightPx + 4 < metrics.scrollHeight) {
  failures.push(`badge says ${metrics.statedPages} pages but ${metrics.scrollHeight}px of content does not fit ${metrics.statedPages} content box(es) of ${metrics.contentBoxHeightPx}px`)
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length})`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`\nOK: ${metrics.lineCount} rows aligned on ${metrics.rowCells ?? 5} columns, description track ${metrics.descriptionTrack}px, ` +
  `${metrics.statedPages} page(s) of a ${metrics.pageHeightPx}px frame (${metrics.contentBoxHeightPx}px content box, ${metrics.marginPx}px margin), no text collisions, rules outside the measured sheet.`)
