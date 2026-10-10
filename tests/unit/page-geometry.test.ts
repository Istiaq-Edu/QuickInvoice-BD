import { describe, expect, it } from "vitest"

import {
  A4_RATIO,
  CAPTURE_SCALE,
  PAGE_MARGIN_PX,
  SHEET_WIDTH_PX,
  contentBoxHeightPx,
  contentBoxWidthPx,
  pageFrameHeightPx,
  pageGeometry,
} from "../../lib/invoice/export"

/**
 * pageGeometry is the contract between what the preview draws and what the
 * exporter writes. The flow advances by `pageHeightPx` per page and the exporter
 * wraps each advance in a page frame with `PAGE_MARGIN_PX` of paper around it. If
 * those two ever disagree, the preview shows a boundary the PDF does not have,
 * which is worse than showing nothing at all: the user trusts it.
 *
 * The bug these tests pin is the margin. The margin used to live in the sheet's
 * own padding, so it was part of the content flow: page one spent it, and every
 * page after it began flush against the paper edge. Slicing the flow by the
 * content box and framing each slice separately is what fixed it, and that is why
 * the advance is now shorter than the paper.
 */

/** Stands in for the content flow: pageGeometry only reads these two. */
function paper(scrollWidth: number, scrollHeight: number) {
  return { scrollWidth, scrollHeight } as HTMLElement
}

/**
 * The exporter's arithmetic, written out independently of pageGeometry.
 *
 * Deliberately a second implementation rather than a call into the module: a test
 * that reuses the function under test can only confirm the function agrees with
 * itself. This mirrors `capturePages`, so a change to either side has to be made
 * twice to keep them equal.
 */
function exporterPageCount(flowHeight: number, scale = CAPTURE_SCALE) {
  const frameBitmap = Math.max(1, Math.floor(SHEET_WIDTH_PX * scale * A4_RATIO))
  const contentBoxBitmap = Math.max(1, frameBitmap - PAGE_MARGIN_PX * 2 * scale)
  const flowBitmap = Math.max(1, Math.floor(flowHeight * scale))
  const tolerance = Math.max(8, Math.ceil(contentBoxBitmap * 0.004))
  return Math.max(1, Math.ceil((flowBitmap - tolerance) / contentBoxBitmap))
}

describe("pageGeometry", () => {
  it("advances the flow by the content box, not by the page frame", () => {
    const { pageHeightPx, pageFrameHeightPx: framePx } = pageGeometry(paper(432, 1000))

    // The paper is taller than the space the text gets, by exactly the two
    // margins. Collapsing these two numbers is what removed page two's margin.
    expect(framePx).toBe(pageFrameHeightPx())
    expect(framePx - pageHeightPx).toBeCloseTo(PAGE_MARGIN_PX * 2, 5)
    expect(pageHeightPx).toBe(contentBoxHeightPx())
  })

  it("reserves the margin on every page, not just the first", () => {
    // A flow exactly as tall as a whole sheet of paper used to be one page,
    // because the sheet's padding was inside the flow and counted as content.
    // It is two pages now, which is correct: the text alone is taller than one
    // page's content box.
    const frame = pageFrameHeightPx()
    expect(pageGeometry(paper(432, Math.ceil(frame))).pageCount).toBe(2)

    // And one pixel less than the content box is still a single page.
    const content = contentBoxHeightPx()
    expect(pageGeometry(paper(432, Math.ceil(content) - 1)).pageCount).toBe(1)
  })

  it("does not let the measured width move the page height", () => {
    // The old form derived the page height from the element's own width, which
    // was ~0.6px short per page and compounded with the page index. The page is
    // A4 and the sheet is pinned, so the content's width cannot change it.
    const heights = [320, 432, 482, 720, 1280].map((width) => pageGeometry(paper(width, 3000)).pageHeightPx)
    expect(new Set(heights).size).toBe(1)
  })

  it("agrees with the exporter on the page count, at every length tried", () => {
    for (const height of [100, 600, 1019, 1023, 2100, 4567, 9000]) {
      const { pageCount } = pageGeometry(paper(contentBoxWidthPx(), height))
      expect(
        { height, pageCount },
        `preview and exporter must agree at ${height}px of flow`,
      ).toEqual({ height, pageCount: exporterPageCount(height) })
    }
  })

  it("counts one page for a document that ends inside the first page", () => {
    const { pageCount, pageHeightPx } = pageGeometry(paper(432, 600))
    expect(pageCount).toBe(1)
    expect(pageHeightPx).toBeGreaterThan(600)
  })

  it("absorbs a few pixels of overflow, but still counts a real second page", () => {
    // Probed against the real slack, not a guessed one: the earlier version
    // stepped 5px either side of the boundary while the slack is only a few
    // pixels, so it passed identically with the tolerance deleted outright.
    const { pageHeightPx } = pageGeometry(paper(432, 600))
    const slackCss = Math.ceil(sliceToleranceOf(contentBoxHeightPx() * CAPTURE_SCALE) / CAPTURE_SCALE)
    expect(slackCss).toBeGreaterThan(1)

    // Inside the slack: still one page.
    expect(pageGeometry(paper(432, Math.ceil(pageHeightPx + slackCss - 1))).pageCount).toBe(1)
    // Past the slack: a genuine second page.
    expect(pageGeometry(paper(432, Math.ceil(pageHeightPx + slackCss + 1))).pageCount).toBe(2)
  })

  it("reports one page, not a division by zero, for a hidden or unlaid-out flow", () => {
    // The mobile wizard keeps the preview off-screen until the last step, so the
    // hook can legitimately be handed an element with no width.
    expect(pageGeometry(paper(0, 0))).toEqual({ pageCount: 1, pageHeightPx: 0, pageFrameHeightPx: 0 })
  })
})

/** The tolerance the exporter applies, restated so the test can size its probe. */
function sliceToleranceOf(bitmapSliceHeight: number) {
  return Math.max(8, Math.ceil(bitmapSliceHeight * 0.004))
}

