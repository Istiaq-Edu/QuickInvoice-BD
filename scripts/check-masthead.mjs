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

// A note, so the closing block (totals + notes) is part of the fixture. The
// totals and the notes are one section: if the notes are pushed to a page the
// totals are not on, the section is divided and the totals read as stranded.
await page.locator("textarea").last().fill("Payment due within 7 days of the issue date.")
await page.waitForTimeout(900)

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
  //
  // The zip is over every visible child, not just the ones with text. Filtering
  // on text as well used to drop an empty cell from the array and shift every
  // index after it, so a row whose Amount had landed in the discount track was
  // compared against the wrong track and reported clean — which is exactly the
  // defect the conditional discount column could reintroduce. An empty cell is
  // skipped for ink, never for indexing: a Range over no content measures 0×0 at
  // the origin, which would read as a collision with everything to its left.
  const audit = (grid) => {
    const problems = []
    const cells = Array.from(grid.children).filter(
      (cell) => getComputedStyle(cell).display !== "none",
    )
    const tracks = trackWidths(grid)
    cells.forEach((cell, index) => {
      if (!cell.textContent.trim()) return
      const b = ink(cell)
      const track = tracks[index]
      // The description is meant to wrap, so only the figures are held to their
      // track; every cell is still held clear of its neighbour.
      if (index > 0 && track !== undefined && b.width - track > 0.5) {
        problems.push({ where: `"${cell.textContent.trim()}"`, overflowPx: Math.round((b.width - track) * 100) / 100 })
      }
      const next = cells.slice(index + 1).find((candidate) => candidate.textContent.trim())
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
  // The header is in this list on purpose. It is a `.invoice-line-grid` like every
  // row, so a header whose `data-discount` disagrees with the rows resolves a
  // different template, prints its labels over the wrong columns, and still
  // passes an audit that only ever compares rows with each other.
  const columnTracks = [header, ...rows].map((row) => Array.from(row.children).map(trackLeft))
  const misaligned = []
  if (columnTracks.length) {
    for (let column = 0; column < columnTracks[0].length; column += 1) {
      const xs = [...new Set(columnTracks.map((row) => row[column]))]
      if (xs.length > 1) misaligned.push({ column, distinctX: xs.length, xs: xs.slice(0, 4) })
    }
  }

  // Every grid must agree on which columns are printed, and must place exactly as
  // many cells as its template has tracks. A row with one cell missing still
  // looks internally aligned — its cells just occupy the wrong tracks — so the
  // count is the assertion that catches a conditional column that was dropped
  // from the header but not the rows, or the other way round.
  const flagSets = [...new Set(grids.map((grid) => `${grid.dataset.qty}/${grid.dataset.discount}`))]
  const cellMismatch = grids
    .map((grid, index) => ({ index, cells: grid.children.length, tracks: trackWidths(grid).length }))
    .filter((grid) => grid.cells !== grid.tracks)

  // The page height must be READ, not re-derived. It used to be recomputed from
  // the sheet's own width as `scrollWidth * A4_RATIO`, which was only ever valid
  // while the sheet WAS the page. The margin now belongs to the page frame and the
  // flow is the content box inside it, so the same arithmetic off the content box
  // reported 610.5px — a number the exporter never uses — and `parseInt` of the
  // badge text then produced NaN pages.
  const page = document.querySelector(".invoice-page")
  const pageHeightPx = page ? Math.round(page.getBoundingClientRect().height) : 0
  // The identity band — logo, number, dates, both parties — must finish inside the
  // top quarter of the paper. This was previously unchecked: `check:table` only
  // ever looked at `.invoice-line-grid`, so the band could grow to 40% of page one
  // (or hit its cap by clipping a phone number) and the gate still reported OK.
  //
  // `scrollHeight > clientHeight` is the assertion that matters. The band is
  // `overflow: hidden` with a max-height backstop, so a too-tall band does not
  // change the page geometry at all — it silently deletes the last line of the
  // buyer's address, in the preview and in both exports.
  // The closing block. Both must sit on the same page: the totals flow after
  // the items, the notes are pinned to the foot of the last page, and the effect
  // moves the totals onto the notes' page when they would otherwise be split.
  const totals = sheet.querySelector('[data-keep-key="totals"]')
  const notesBlock = sheet.querySelector("[data-notes-block]")
  const closingScale = sheet.getBoundingClientRect().width / 432
  const pageTop = sheet.getBoundingClientRect().top
  const pageIndexOf = (el) => el
    ? Math.floor((el.getBoundingClientRect().top - pageTop) / closingScale / 630.5)
    : -1
  const totalsBox = totals?.getBoundingClientRect()
  const totalsTop = totalsBox ? (totalsBox.top - pageTop) / closingScale : 0
  const totalsBottom = totalsBox ? (totalsBox.bottom - pageTop) / closingScale : 0
  const totalsCrosses = []
  for (let edge = 630.5; edge < totalsBottom; edge += 630.5) {
    if (totalsTop < edge - 0.5 && totalsBottom > edge + 0.5) totalsCrosses.push(edge)
  }
  const totalsPage = pageIndexOf(totals)
  const notesPage = pageIndexOf(notesBlock)
  const notesBox = notesBlock?.getBoundingClientRect()
  const notesTop = notesBox ? (notesBox.top - pageTop) / closingScale : 0
  const notesBottom = notesBox ? (notesBox.bottom - pageTop) / closingScale : 0
  const notesCrosses = []
  for (let edge = 630.5; edge < notesBottom; edge += 630.5) {
    if (notesTop < edge - 0.5 && notesBottom > edge + 0.5) notesCrosses.push(edge)
  }
  const band = sheet.querySelector("[data-identity-band]")
  const bandBox = band?.getBoundingClientRect()
  const bandHeightPx = band ? Math.round(bandBox.height) : 0
  const bandClipPx = band ? Math.max(0, band.scrollHeight - band.clientHeight) : 0
  // Horizontal overflow is the same failure in the other axis: the band is a
  // clipped box, so a nowrap date line or a long invoice number would be cut off
  // with no vertical symptom at all.
  const bandSideClipPx = band ? Math.max(0, band.scrollWidth - band.clientWidth) : 0
  const bandBottomFraction = bandBox && page ? (bandBox.bottom - page.getBoundingClientRect().top) / page.getBoundingClientRect().height : 0
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
    bandHeightPx,
    bandClipPx,
    totalsCrosses,
    notesCrosses,
    totalsPage,
    notesPage,
    bandSideClipPx,
    bandBottomFraction: Math.round(bandBottomFraction * 1000) / 1000,
    misaligned,
    flagSets,
    cellMismatch,
    columnCount: trackWidths(header).length,
    pageSheets: document.querySelectorAll(".invoice-page").length,
    breakRules: document.querySelectorAll(".paper-break").length,
    overlayInsideSheet: Boolean(sheet.querySelector(".paper-break")),
    statedPages: badge ? Number.parseInt(badge.match(/\d+/)?.[0] ?? "", 10) : null,
    headerCollisions: audit(header),
    rowCollisions: rows.flatMap((row) => audit(row)),
  }
})

console.log("METRICS", JSON.stringify(metrics, null, 2))

// Second pass: the state the fixture above never builds.
//
// Every line in that fixture carries a discount, so only the five-column template
// is ever measured. The discount column is conditional and the quantity column is
// switchable, which makes the four- and three-column templates real documents —
// and a cell missing from a row is invisible to a per-row audit, because that row
// is still aligned with itself. This pass removes every discount and turns the
// quantity column off, then asserts the smallest template the app can print.
const discounts = page.locator('select[id^="discount-type-"]:visible')
for (let index = 0, total = await discounts.count(); index < total; index += 1) {
  await discounts.nth(index).selectOption("none")
}
await page.getByRole("switch", { name: "Qty" }).click()
await page.waitForTimeout(1000)
const compact = await page.evaluate(() => {
  const sheet = document.querySelector(".invoice-paper")
  const grids = Array.from(sheet.querySelectorAll(".invoice-line-grid"))
  const header = grids[0]
  const rows = grids.slice(1)
  const trackWidths = (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").map((value) => Number.parseFloat(value))
  const tracks = (grid) => trackWidths(grid).length
  const ink = (node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getBoundingClientRect()
  }
  // The compact template is audited, not just counted. Track COUNT is satisfied by
  // a row whose Amount has landed in the Price track — the cells are present, the
  // indexes are wrong, and every row still agrees with itself. Ink against track,
  // and cell lefts against the header, are what catch that.
  const collisions = []
  for (const grid of grids) {
    const cells = Array.from(grid.children).filter((cell) => getComputedStyle(cell).display !== "none")
    const widths = trackWidths(grid)
    cells.forEach((cell, index) => {
      if (!cell.textContent.trim()) return
      const box = ink(cell)
      if (index > 0 && widths[index] !== undefined && box.width - widths[index] > 0.5) {
        collisions.push({ where: `"${cell.textContent.trim()}"`, overflowPx: Math.round((box.width - widths[index]) * 100) / 100 })
      }
      const next = cells.slice(index + 1).find((candidate) => candidate.textContent.trim())
      if (next && box.right - ink(next).left > 0.5) {
        collisions.push({ where: `"${cell.textContent.trim()}" | "${next.textContent.trim()}"`, overlapPx: Math.round((box.right - ink(next).left) * 100) / 100 })
      }
    })
  }
  const lefts = [header, ...rows].map((row) => Array.from(row.children).map((cell) => Math.round(cell.getBoundingClientRect().left * 10) / 10))
  const misaligned = []
  for (let column = 0; column < (lefts[0]?.length ?? 0); column += 1) {
    const xs = [...new Set(lefts.map((row) => row[column]))]
    if (xs.length > 1) misaligned.push({ column, distinctX: xs.length, xs: xs.slice(0, 4) })
  }
  const page = document.querySelector(".invoice-page")
  const pageBox = page?.getBoundingClientRect()
  const canonicalWidth = Number.parseFloat(document.querySelector(".invoice-pages")?.style.width ?? "")
  const scale = pageBox && canonicalWidth ? pageBox.width / canonicalWidth : 1
  const pageHeightPx = pageBox ? Math.round(pageBox.height) : 0
  const marginPx = pageBox ? Math.round((sheet.getBoundingClientRect().top - pageBox.top) / scale) : 0
  const badge = Array.from(document.querySelectorAll('[role="status"]'))
    .map((node) => node.textContent?.trim())
    .find((text) => text?.includes("page"))

  return {
    grids: grids.length,
    trackCounts: [...new Set(grids.map(tracks))],
    cellMismatch: grids.filter((grid) => grid.children.length !== tracks(grid)).length,
    flagSets: [...new Set(grids.map((grid) => `${grid.dataset.qty}/${grid.dataset.discount}`))],
    descriptionTrack: Math.round(Number.parseFloat(getComputedStyle(header).gridTemplateColumns) * 100) / 100,
    collisions,
    misaligned,
    scrollHeight: sheet.scrollHeight,
    pageHeightPx,
    contentBoxHeightPx: pageHeightPx - marginPx * 2,
    statedPages: badge ? Number.parseInt(badge.match(/\d+/)?.[0] ?? "", 10) : null,
  }
})
console.log("COMPACT", JSON.stringify(compact, null, 2))
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
// The band is allowed to be ANY height up to the quarter line, but it must never
// be cut off to get there: a clipped band is missing data on a legal document.
if (metrics.bandClipPx > 0) failures.push(`identity band is clipped by ${metrics.bandClipPx}px; its last line is missing from the preview and both exports`)
if (metrics.bandSideClipPx > 0) failures.push(`identity band overflows sideways by ${metrics.bandSideClipPx}px; the invoice number or dates are cut off`)
if (metrics.bandBottomFraction > 0.25) failures.push(`identity band ends ${(metrics.bandBottomFraction * 100).toFixed(1)}% down page one; the budget is 25%`)
if (metrics.bandHeightPx <= 0) failures.push("identity band not found; the quarter-of-a-page check would pass by measuring nothing")
if (metrics.totalsCrosses.length) failures.push(`subtotal/total block is split across a page boundary at ${metrics.totalsCrosses.join(", ")}px`)
// The notes are a footer: they sit at the foot of their page when they fit
// after the totals, and start the next page as one block when they do not. What
// must never happen is the block being cut by a page edge.
if (metrics.notesCrosses.length) failures.push(`notes block is cut by a page boundary at ${metrics.notesCrosses.join(", ")}px`)
// The column set is document-wide: a header that disagrees with its rows prints
// its labels over the wrong figures and no per-grid audit can see it.
if (metrics.flagSets.length !== 1 || metrics.flagSets[0] !== "true/true") failures.push(`line grids disagree on which columns print: ${JSON.stringify(metrics.flagSets)}`)
if (metrics.cellMismatch.length) failures.push(`cells do not fill their tracks: ${JSON.stringify(metrics.cellMismatch)}`)
if (compact.trackCounts.length !== 1 || compact.trackCounts[0] !== 3) failures.push(`quantity off and no discounts should print 3 columns, found ${JSON.stringify(compact.trackCounts)}`)
if (compact.cellMismatch) failures.push(`compact layout has ${compact.cellMismatch} grid(s) whose cell count does not match their tracks`)
if (compact.flagSets.length !== 1 || compact.flagSets[0] !== "false/false") failures.push(`compact layout still reports ${JSON.stringify(compact.flagSets)}`)
if (compact.descriptionTrack < 60) failures.push(`compact description track collapsed to ${compact.descriptionTrack}px`)
if (compact.collisions.length) failures.push(`compact layout collisions: ${JSON.stringify(compact.collisions)}`)
if (compact.misaligned.length) failures.push(`compact columns not aligned across rows: ${JSON.stringify(compact.misaligned)}`)
if (compact.statedPages !== null && compact.statedPages * compact.contentBoxHeightPx + 4 < compact.scrollHeight) {
  failures.push(`compact badge says ${compact.statedPages} pages but ${compact.scrollHeight}px of content does not fit ${compact.statedPages} content box(es) of ${compact.contentBoxHeightPx}px`)
}
if (metrics.statedPages !== null && metrics.statedPages * metrics.contentBoxHeightPx + 4 < metrics.scrollHeight) {
  failures.push(`badge says ${metrics.statedPages} pages but ${metrics.scrollHeight}px of content does not fit ${metrics.statedPages} content box(es) of ${metrics.contentBoxHeightPx}px`)
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length})`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`\nOK: ${metrics.lineCount} rows aligned on ${metrics.columnCount} columns, description track ${metrics.descriptionTrack}px, ` +
  `${metrics.statedPages} page(s) of a ${metrics.pageHeightPx}px frame (${metrics.contentBoxHeightPx}px content box, ${metrics.marginPx}px margin), no text collisions, rules outside the measured sheet.`)
console.log(`OK: compact layout prints ${compact.trackCounts[0]} columns, every grid fills its tracks, description track ${compact.descriptionTrack}px.`)
console.log(`OK: identity band ${metrics.bandHeightPx}px tall, ends ${(metrics.bandBottomFraction * 100).toFixed(1)}% down page one, nothing clipped.`)
