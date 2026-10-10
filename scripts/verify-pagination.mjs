// Confirms the paginated preview: one sheet per page, sheets separated by a real
// gap, and — the assertion that actually matters — no content straddling a page
// boundary. A break drawn across a continuous sheet could never fail that last
// check, which is why it was never made until the pages became real geometry.
import { chromium } from "@playwright/test"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" })
await page.waitForTimeout(1200)

const fieldId = async (labelText) => {
  const id = await page.locator("label").filter({ hasText: labelText }).first().getAttribute("for")
  if (!id) throw new Error(`no label found for "${labelText}"`)
  return `#${id}`
}
await page.locator(await fieldId("Company name")).fill("Studio Nodi")
await page.locator(await fieldId("Seller name")).fill("Farhana Islam")
await page.locator(await fieldId("Buyer name")).fill("Rahim Uddin")
await page.locator(await fieldId("Phone")).fill("01711000000")
await page.locator('input[id^="description-"]:visible').first().fill("Design retainer")
await page.locator('input[id^="quantity-"]:visible').first().fill("1")
await page.locator('input[id^="price-"]:visible').first().fill("48500")
await page.waitForTimeout(900)

// `async` because the margin-band hit test scrolls each page into view and waits
// a frame: `elementFromPoint` only reports what is genuinely under the cursor, so
// a page scrolled out of the viewport would silently test nothing and pass.
const inspect = () => page.evaluate(async () => {
  const sheets = Array.from(document.querySelectorAll(".invoice-page"))
  const content = document.querySelector(".invoice-page-content")
  // The heading's page count, and the pager's own "Page X of Y". They are read
  // separately because they are different facts now: the heading reports how long
  // the document IS, the pager reports which page the window is showing. Matching
  // the badge on a bare "page" substring picked up the pager as soon as it
  // existed, and then asserted the page count against the reader's position.
  const statuses = Array.from(document.querySelectorAll('[role="status"]'))
    .map((n) => n.textContent?.trim() ?? "")
  const badge = statuses.find((t) => /\b\d+\s+pages?\b/.test(t))
  const pager = statuses.find((t) => /^Page\s+\d+\s+of\s+\d+$/.test(t)) ?? null

  // The scale is applied to an ancestor, so every measurement has to be divided
  // back out to compare against the canonical A4 geometry the exporter uses.
  //
  // The canonical width is READ from the page stack's inline width rather than
  // written as a literal. It used to be hardcoded as 432 (480 less its 24px
  // margins), which meant this script would keep asserting against the old
  // geometry after SHEET_WIDTH_PX or PAGE_MARGIN_PX changed — a check that still
  // runs, still passes, and validates numbers nothing uses any more.
  const contentRect = content?.getBoundingClientRect()
  const sheet0 = sheets[0]?.getBoundingClientRect()
  const canonicalWidth = Number.parseFloat(document.querySelector(".invoice-pages")?.style.width ?? "")
  const scale = sheet0 && contentRect && canonicalWidth ? sheet0.width / canonicalWidth : 1
  const margin = contentRect && sheet0 ? (contentRect.top - sheet0.top) / scale : 0
  const pageFrame = sheet0 ? sheet0.height / scale : 0
  // The flow advances by the content box; the margin is what the frame adds back.
  const pageContent = pageFrame - 2 * margin

  // The margin is asserted by recovering where the flow's own top edge lands on
  // each sheet.
  //
  // The content copy's own box cannot be used directly: it is deliberately
  // translated up by `index * pageContent`, so its rect starts above the sheet and
  // reading it reported -606 and -1237 for pages two and three. Adding the shift
  // back is the same fact stated directly.
  //
  // Measuring the first block was tried first and is also wrong, in the other
  // direction: a block belonging to the PREVIOUS page also projects into this
  // sheet's box, 5px above the content box, where it is clipped away. It was
  // picked as "the first thing this page draws" and reported the margin as 19.
  // The window shows ONE sheet, whatever the page count. Asserting `sheets ===
  // pageCount` was the old contract and it is now the regression itself: it would
  // only pass if the preview grew a sheet per page, which is exactly the growing,
  // scrolling preview this replaced.
  const windowIsOnePage = sheets.length === 1
  // The window must be the height of a single sheet, not of the document. If the
  // reserved box tracked the flow again, a 34-line invoice would push the Download
  // buttons off screen and the preview would scroll — the behaviour being removed.
  const windowHeight = sheets[0] ? sheets[0].getBoundingClientRect().height / scale : 0
  const windowIsOneFrame = Math.abs(windowHeight - pageFrame) <= 1

  // Measured for whichever page the window is currently showing. The reader has to
  // be able to turn to every page, so the loop below drives the pager and collects
  // from each one in turn.
  //
  // `page` is the zero-based index of the page on show. The content copy is
  // deliberately translated up by `page * pageContent` to bring that page into
  // the window, so its own rect starts above the paper — reading the inset from
  // that rect reports -606, -1237 and so on for later pages, and the check then
  // fails on a perfectly margined document. Adding the shift back is the same fact
  // stated directly.
  const measureShownPage = (page) => {
    const sheet = document.querySelector(".invoice-page")
    const copy = document.querySelector(".invoice-page-content")
    if (!sheet || !copy) return { inset: -1, filled: false, marginPaint: [] }
    const box = sheet.getBoundingClientRect()
    const flowTop = copy.getBoundingClientRect().top
    const contentTop = box.top + margin * scale
    const contentBottom = box.top + (pageFrame - margin) * scale

    const filled = Array.from(copy.querySelectorAll("[data-keep-key]"))
      .map((el) => el.getBoundingClientRect())
      .some((r) => r.height > 0 && r.top >= contentTop - 0.5 && r.bottom <= contentBottom + 0.5)

    // Nothing may be PAINTED in the page's margin band. Hit-testing is what
    // respects `overflow`: a block's rect is its layout box and ignores an
    // ancestor's clip entirely, so measuring positions says the same thing whether
    // or not anything is clipped.
    const marginPaint = []
    for (const [label, y] of [
      ["head", box.top + (contentTop - box.top) * 0.5],
      ["foot", contentBottom + (box.bottom - contentBottom) * 0.5],
    ]) {
      for (const frac of [0.3, 0.5, 0.7]) {
        const hit = document.elementFromPoint(box.left + box.width * frac, y)
        if (hit?.closest?.("[data-keep-key]")) marginPaint.push({ band: label, tag: hit.tagName })
      }
    }
    return {
      inset: Math.round((flowTop - box.top) / scale + page * pageContent),
      // The page the pager SAYS it is on. Asserted against the page the loop
      // asked for, because a Next button that renders but does not advance is
      // otherwise invisible: the loop still visits `total` times and the per-page
      // geometry all reads as page one, so only the insets drift. Reading the
      // control's own state is what makes a stuck pager a named failure.
      shownPage: Number.parseInt(
        Array.from(document.querySelectorAll('[role="status"]'))
          .map((n) => n.textContent?.trim() ?? "")
          .find((t) => /^Page\s+\d+\s+of\s+\d+$/.test(t))
          ?.match(/Page\s+(\d+)/)?.[1] ?? "", 10),
      filled,
      marginPaint,
    }
  }

  // Any visible run of text that crosses a boundary is a real defect: the export
  // wraps the same offsets, so it would cut the same glyphs.
  const straddle = []
  if (content && pageContent > 0) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      if (rect.height === 0) continue
      const top = (rect.top - contentRect.top) / scale
      const bottom = (rect.bottom - contentRect.top) / scale
      for (let boundary = pageContent; boundary < bottom; boundary += pageContent) {
        if (top < boundary - 0.5 && bottom > boundary + 0.5) {
          straddle.push({ text: node.textContent.trim().slice(0, 28), boundary: Math.round(boundary) })
        }
      }
    }
  }

  // Nothing may be PAINTED in a page's margin band, on ANY page.
  //
  // This is the check that catches a page printing a slice of its neighbour. The
  // obvious assertions cannot: `straddle` stays empty because a row beginning
  // just below a boundary has not "crossed" it, and a block's rect is its layout
  // box, which ignores an ancestor's `overflow` entirely — so measuring positions
  // says the same thing whether or not anything is clipped.
  //
  // Hit-testing is what respects the clip. A point in the foot margin must not
  // resolve to a row. Before the page grew its own content-box clip, the capture
  // region was the full 679px frame, so this returned the first row of the NEXT
  // page, sliced off by the paper edge — and the same row then appeared again,
  // whole, at the top of the following page.
  //
  // The preview shows one page at a time, so the reader is turned through the
  // whole document here and each page is measured as it is shown. Asserting only
  // page one would have left every later page unchecked — which is how the bleed
  // survived a check that reported success.
  const insets = []
  const filled = []
  const shownPages = []
  const marginPaint = []
  const pageCount = Number.parseInt(badge?.match(/\d+/)?.[0] ?? "", 10)
  const total = Number.isFinite(pageCount) ? pageCount : 1
  // The sheet is scrolled into view before hit-testing, because `elementFromPoint`
  // only reports what is genuinely under the cursor.
  const sheetEl = document.querySelector(".invoice-page")
  sheetEl?.scrollIntoView({ block: "center", behavior: "instant" })
  await new Promise((r) => setTimeout(r, 60))
  for (let page = 0; page < total; page += 1) {
    const shown = measureShownPage(page)
    insets.push(shown.inset)
    filled.push(shown.filled)
    shownPages.push(shown.shownPage)
    for (const hit of shown.marginPaint) marginPaint.push({ page, ...hit })
    if (page < total - 1) {
      const next = document.querySelector('[aria-label="Preview pages"] button[aria-label="Next page"]')
      if (!next) break
      next.click()
      await new Promise((r) => setTimeout(r, 60))
    }
  }
  // Rewind to page one so the reader's next screenshot starts at the top.
  for (let page = 0; page < total - 1; page += 1) {
    const prev = document.querySelector('[aria-label="Preview pages"] button[aria-label="Previous page"]')
    if (!prev) break
    prev.click()
    await new Promise((r) => setTimeout(r, 60))
  }

  // The preview renders exactly ONE copy of the document, so the duplicate-id and
  // focusable-in-`aria-hidden` hazards of the old per-page copies are gone by
  // construction rather than by discipline. They are still asserted: the checks
  // are what stops a future change from quietly reintroducing a second copy.
  const idCounts = new Map()
  document.querySelectorAll("[id]").forEach((node) => idCounts.set(node.id, (idCounts.get(node.id) || 0) + 1))
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id, count]) => `${id}x${count}`)
  const focusableInAriaHidden = document.querySelectorAll(
    '[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] input, '
    + '[aria-hidden="true"] select, [aria-hidden="true"] textarea, [aria-hidden="true"] [tabindex]',
  ).length

  return {
    sheets: sheets.length,
    windowIsOnePage,
    windowIsOneFrame,
    windowHeight: Math.round(windowHeight),
    pagesVisited: insets.length,
    shownPages,
    duplicateIds,
    focusableInAriaHidden,
    frame: Math.round(pageFrame),
    content: Math.round(pageContent),
    insets,
    filled,
    straddle,
    marginPaint,
    badge,
    pager,
  }
})

const report = (label, m) => {
  // The badge is matched by its number, not by expecting a phrase. The wording is
  // the page's business, and pinning it here broke the check whenever the copy was
  // edited: `parseInt("PDF/DOCX estimate: 3 pages")` is NaN, so a correct preview
  // was reported as disagreeing with itself.
  const pageCount = Number.parseInt(m.badge?.match(/\d+/)?.[0] ?? "", 10)
  // Every page in the document must actually have been turned to. A pager that
  // does not advance would leave this at 1 while the document runs to 4, and
  // every per-page assertion below would pass having only ever seen page one.
  const allPagesVisited = Number.isFinite(pageCount)
    && m.pagesVisited === pageCount
    // Every turn must land on the page that was asked for. Without this, a Next
    // button that renders and does nothing still "visits" every page: the loop
    // runs, and every measurement silently describes page one.
    //
    // Only meaningful once there IS a pager. A one-page invoice deliberately has
    // none, so there is no position to read and the check does not apply.
    && (pageCount <= 1 || (Array.isArray(m.shownPages) && m.shownPages.every((shown, index) => shown === index + 1)))
  // The pager must agree with the document, and must exist at all once there is
  // more than one page. "Page 1 of 1" on a four-page invoice would otherwise
  // report success with no way to reach the other three.
  const pagerTotal = Number.parseInt(m.pager?.match(/of\s+(\d+)/)?.[1] ?? "", 10)
  const pagerOk = pageCount > 1
    ? Number.isFinite(pagerTotal) && pagerTotal === pageCount
    : m.pager === null
  const clean = m.straddle.length === 0
  // Every page must inset its content from the paper edge, not just the first.
  // A sliced strip has no margin of its own, so page two's text lands on the
  // paper edge while page one has a comfortable inset.
  //
  // The threshold is NOT a literal. It used to be `>= 20`, a hand-typed stand-in
  // for a 24px margin, so dropping PAGE_MARGIN_PX to 16 would have left this gate
  // passing against a margin the app no longer has — the same staleness the
  // `canonicalWidth` comment above describes. Instead the bar is the page's OWN
  // first-page inset: every page must indent by the same amount page one does.
  // That catches the real regression (a flush page two, inset 0 against page
  // one's 24) and cannot disagree with whatever the margin is set to.
  const expectedInset = m.insets[0]
  const margined = m.insets.length > 0
    && expectedInset > 0
    && m.insets.every((inset) => inset === expectedInset)

  // One copy of the document, so no `id` may be duplicated and nothing focusable
  // may sit inside an `aria-hidden` subtree (a keyboard user would tab into an
  // invisible duplicate with no way to know where they are).
  const noDuplicateIds = m.duplicateIds.length === 0
  const noFocusableInHidden = m.focusableInAriaHidden === 0

  const filled = m.filled.length > 0 && m.filled.every(Boolean)
  const marginClean = m.marginPaint.length === 0
  const windowed = m.windowIsOnePage && m.windowIsOneFrame
  console.log(`${label}:`, JSON.stringify(m))
  console.log(`  window is one page: ${m.windowIsOnePage} (h=${m.windowHeight} vs frame ${m.frame}) | window is one frame tall: ${m.windowIsOneFrame}`)
  console.log(`  every page reachable: ${allPagesVisited} | pager agrees: ${pagerOk} | every page margined: ${margined} | every page filled: ${filled} | no text crosses a boundary: ${clean}`)
  console.log(`  margins clear of painted rows: ${marginClean} | no duplicate ids: ${noDuplicateIds} | no focusable in aria-hidden: ${noFocusableInHidden}`)
  if (!marginClean) console.log(`  ROWS PAINTED IN A MARGIN: ${JSON.stringify(m.marginPaint)}`)
  return windowed && allPagesVisited && pagerOk && clean && margined && filled && marginClean && noDuplicateIds && noFocusableInHidden
}

let ok = report("single page", await inspect())

// 34 lines is well past the 26-line figure this was written for: enough to force
// several pages, which is where an off-by-one in the tolerance shows up.
for (let index = 2; index <= 34; index += 1) {
  const filled = await page.locator('input[id^="description-"]:visible').count()
  if (filled < index) {
    await page.getByRole("button", { name: "Add another item", exact: true }).click()
    await page.waitForFunction(
      (expected) => document.querySelectorAll('input[id^="description-"]').length >= expected,
      index, { timeout: 10_000 },
    ).catch(() => undefined)
  }
  await page.locator('input[id^="description-"]:visible').nth(index - 1).fill(`Milestone ${index}`)
  await page.locator('input[id^="quantity-"]:visible').nth(index - 1).fill("1")
  await page.locator('input[id^="price-"]:visible').nth(index - 1).fill("1250")
}
await page.waitForTimeout(1200)
const multi = await inspect()
ok = report("multi page ", multi) && ok

// The preview window must not grow with the document. This is the assertion the
// old check could not make: it compared the sheet count to the page count, so a
// preview that grew one sheet per page passed. The requirement now is the
// opposite, and it is stated directly — 34 lines in, the window is still ONE page
// tall, and the reader turns through the document with the pager.
const stillOnePage = multi.sheets === 1 && multi.windowIsOneFrame
console.log(`window after 34 lines: ${multi.sheets} sheet(s), ${multi.windowHeight}px tall vs a ${multi.frame}px frame | all ${multi.pagesVisited} pages reachable`)

await browser.close()
if (!ok || !stillOnePage) {
  console.error("\nFAIL: the preview window is not a fixed single page, or a page was not reachable")
  process.exit(1)
}
console.log("\nOK: the preview is a fixed one-page window, every page is reachable by the pager, every page is margined, and no content crosses a page boundary.")
