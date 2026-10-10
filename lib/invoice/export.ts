// html2canvas, docx and jsPDF are deliberately NOT imported at module scope.
//
// This module is imported by the invoice page and by the pagination component
// for its geometry helpers, and a static import of the three libraries pulled
// all of them into the page's first-load bundle: measured at ~856 KB in one
// chunk (see docs/operations/audit-2026-10-11.md). They are needed only when a
// seller actually exports, which most sessions never do, so each is loaded
// lazily with `await import()` at its single use site instead. The geometry
// constants and functions above stay in the main bundle because the preview
// needs them on every render.
//
// `Document` is aliased in the DOCX path because `docx` exports a class of the
// same name, which would shadow the DOM type. Spell `globalThis.Document` there
// instead of importing a colliding name at module scope.

const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89
/** A4 in twips, which is the unit a DOCX section's page size is declared in. */
const A4_WIDTH_TWIPS = 11906
const A4_HEIGHT_TWIPS = 16838
/**
 * The width the page image is placed at in the DOCX, in CSS pixels.
 *
 * This is the original 620, restored deliberately. It is narrower than the sheet
 * (A4 is about 794px at 96dpi), so the exported document sits at ~78% of the paper
 * width with white space to its right. That was flagged during review as an
 * inconsistency against the PDF, which fills the sheet — but it is a look, not a
 * defect, and it is the look this project shipped with. Deriving the width from
 * the section size "fixed" it by making the DOCX identical to the PDF, which
 * changed the exported document for every existing user. Left as a constant so
 * the two exports can be told apart on purpose.
 */
const DOCX_WIDTH_PX = 620

/**
 * The one page ratio the whole app agrees on.
 *
 * It is deliberately the ratio jsPDF uses for `format: "a4"` (841.89 / 595.28)
 * rather than the exact metric one (297 / 210). They differ in the fifth
 * decimal, but the slicer divides by this number, so anything that draws a
 * page boundary has to divide by the same number or the visible break drifts
 * away from the real one.
 */
export const A4_RATIO = A4_HEIGHT_PT / A4_WIDTH_PT

/**
 * The canonical CSS width of the A4 sheet, in pixels.
 *
 * The document is rendered at exactly this width on every device. It used to be a
 * fluid `w-full` block, which meant the sheet was ~480px wide beside a desktop
 * form but only 268-338px wide on a phone, and the exporter captured whatever it
 * found: a PDF downloaded from a phone was laid out for a 268px sheet and then
 * stretched across A4, so its type was proportionally smaller than the same
 * invoice exported from a laptop. Pinning the width makes the captured geometry
 * identical everywhere, and the preview scales the result down to fit instead of
 * re-flowing it.
 *
 * 480px is a deliberate multiple of 16 so the padding, gutters and rule weights
 * stay on whole pixels and the captured bitmap has no fractional seams.
 */
export const SHEET_WIDTH_PX = 480

/**
 * The margin carried by every printed page, in CSS pixels.
 *
 * This used to live in the sheet's own `p-6` padding, which is the whole reason
 * page two had no top margin: the padding was part of the content flow, so the
 * 24px band above the masthead belonged to page one and the slicer simply cut
 * through the flow afterwards. Page two therefore began flush against the paper
 * edge while page one had a comfortable margin — the preview and the PDF agreed
 * with each other and both looked wrong.
 *
 * The margin is now a property of the PAGE, not of the document. The flow is the
 * bare content and the page frame wraps each slice of it in this margin, so every
 * page gets one, including the last.
 */
export const PAGE_MARGIN_PX = 24

/**
 * The device-pixel ratio html2canvas renders at.
 *
 * Shared rather than repeated because the whole pagination contract depends on
 * it: `pageGeometry` re-derives the slicer's arithmetic from the capture scale,
 * so a capture at a different scale would leave the preview's page boundaries
 * drifting away from the PDF's with nothing to fail. One constant, one capture.
 */
export const CAPTURE_SCALE = 2

/**
 * The shape of the `html2canvas` default export.
 *
 * Declared structurally instead of importing the type, because importing the
 * library — even for its type — is what would pull it back into the main bundle.
 * The real module is loaded with `await import()` inside the export functions and
 * passed down to `capturePages`.
 */
type Html2CanvasFn = (element: HTMLElement, options?: Parameters<typeof import("html2canvas").default>[1]) => Promise<HTMLCanvasElement>

/**
 * The trailing slack, in bitmap pixels, that keeps the last few pixels of a
 * document from printing an almost-empty extra sheet.
 *
 * Factored out of both the preview and the slicer so the two cannot disagree
 * about where a page ends: they used to be written out separately, and the
 * 0.4% multiplier and the 8px floor are exactly the kind of pair that gets
 * edited in one place and not the other.
 */
function sliceTolerance(bitmapSliceHeight: number) {
  return Math.max(8, Math.ceil(bitmapSliceHeight * 0.004))
}

/** The height of one A4 page in bitmap pixels, as the slicer cuts it. */
function sliceHeightFor(bitmapWidth: number) {
  return Math.max(1, Math.floor(bitmapWidth * A4_RATIO))
}

/**
 * The page geometry, in both units the app has to agree on.
 *
 * `frame` is the whole sheet of paper — 480px wide, A4 ratio, margin included.
 * `content` is the box the document actually flows inside once that margin is
 * removed. They are different numbers, and conflating them is what produced a
 * flush-left page two: the flow advances by the CONTENT height while the paper
 * holding it is the FRAME, so slicing on the frame height spent the first page's
 * margin allowance on page one and left every later page with none.
 */
const pageFrameBitmapHeight = () => sliceHeightFor(SHEET_WIDTH_PX * CAPTURE_SCALE)
const pageFrameHeightPx = () => pageFrameBitmapHeight() / CAPTURE_SCALE
const contentBoxWidthPx = () => SHEET_WIDTH_PX - PAGE_MARGIN_PX * 2
const contentBoxHeightPx = () => pageFrameHeightPx() - PAGE_MARGIN_PX * 2

export { pageFrameHeightPx, contentBoxWidthPx, contentBoxHeightPx }

type Rgba = [number, number, number, number]

function parseCssNumber(value: string, percentageScale: number) {
  if (value.trim().toLowerCase() === "none") return 0
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? (value.includes("%") ? number * percentageScale / 100 : number) : 0
}

function parseCssAlpha(value: string | undefined) {
  if (!value) return 1
  return Math.max(0, Math.min(1, parseCssNumber(value, 1)))
}

function toSrgbChannel(value: number) {
  const normalized = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, normalized)) * 255)
}

function labToRgba(lightness: string, aValue: string, bValue: string, alpha?: string): Rgba {
  const l = parseCssNumber(lightness, 100)
  const a = parseCssNumber(aValue, 125)
  const b = parseCssNumber(bValue, 125)
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const epsilon = 216 / 24389
  const kappa = 24389 / 27
  const convert = (value: number) => value ** 3 > epsilon ? value ** 3 : (116 * value - 16) / kappa
  const x = convert(fx) * 0.96422
  const y = convert(fy)
  const z = convert(fz) * 0.82521
  const xD65 = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z
  const yD65 = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z
  const zD65 = 0.0122982 * x - 0.020483 * y + 1.3299098 * z

  return [
    toSrgbChannel(3.2406 * xD65 - 1.5372 * yD65 - 0.4986 * zD65),
    toSrgbChannel(-0.9689 * xD65 + 1.8758 * yD65 + 0.0415 * zD65),
    toSrgbChannel(0.0557 * xD65 - 0.204 * yD65 + 1.057 * zD65),
    parseCssAlpha(alpha),
  ]
}

function oklabToRgba(lightness: string, aValue: string, bValue: string, alpha?: string): Rgba {
  const l = parseCssNumber(lightness, 1)
  const a = parseCssNumber(aValue, 0.4)
  const b = parseCssNumber(bValue, 0.4)
  const lValue = l + 0.3963377774 * a + 0.2158037573 * b
  const mValue = l - 0.1055613458 * a - 0.0638541728 * b
  const sValue = l - 0.0894841775 * a - 1.291485548 * b
  const lCube = lValue ** 3
  const mCube = mValue ** 3
  const sCube = sValue ** 3

  return [
    toSrgbChannel(4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube),
    toSrgbChannel(-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube),
    toSrgbChannel(-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube),
    parseCssAlpha(alpha),
  ]
}

function oklchToRgba(lightness: string, chroma: string, hue: string, alpha?: string): Rgba {
  const l = parseCssNumber(lightness, 1)
  const c = parseCssNumber(chroma, 0.4)
  const angle = parseCssNumber(hue, 360) * Math.PI / 180
  return oklabToRgba(String(l), String(c * Math.cos(angle)), String(c * Math.sin(angle)), alpha)
}

function normalizeUnsupportedColors(value: string) {
  return value.replace(/\b(lab|oklab|oklch)\(([^)]*)\)/gi, (match, functionName?: string, rawContents?: string) => {
    const contents = (rawContents ?? "").replace(/\s*\/\s*/g, " /").trim()
    const [colorPart, alphaPart] = contents.split(" /")
    const components = colorPart.trim().split(/[\s,]+/).filter(Boolean)
    if (components.length < 3) return match
    const rgba = functionName?.toLowerCase() === "lab"
      ? labToRgba(components[0], components[1], components[2], alphaPart)
      : functionName?.toLowerCase() === "oklab"
        ? oklabToRgba(components[0], components[1], components[2], alphaPart)
        : oklchToRgba(components[0], components[1], components[2], alphaPart)
    return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`
  })
}

/**
 * Rewrites the modern colour functions html2canvas cannot parse, and drops the
 * shadows it would otherwise rasterise as grey smudges.
 *
 * Kept separate from the capture so the per-page frames can reuse it: every page
 * is rasterised from its own cloned document, and each of those clones needs the
 * same rewrite.
 *
 * The parameter is the DOM `Document` html2canvas hands to `onclone`. That is
 * unambiguous because the `docx` import is aliased above; it used to need
 * `globalThis.Document` to escape the shadowing.
 */
function normalizeClonedDocument(clonedDocument: Document, root: HTMLElement) {
  clonedDocument.querySelectorAll("style").forEach((style) => {
    if (style.textContent) style.textContent = normalizeUnsupportedColors(style.textContent)
  })

  const roots = [clonedDocument.documentElement, clonedDocument.body, root].filter((node): node is HTMLElement => Boolean(node))
  const nodes = Array.from(new Set(roots.flatMap((r) => [r, ...Array.from(r.querySelectorAll<HTMLElement>("*"))])))
  nodes.forEach((node) => {
    const inlineStyle = node.getAttribute("style")
    if (inlineStyle) node.setAttribute("style", normalizeUnsupportedColors(inlineStyle))

    const computed = clonedDocument.defaultView?.getComputedStyle(node)
    if (!computed) return
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index)
      const value = computed.getPropertyValue(property)
      if (!value.includes("lab(") && !value.includes("oklch(")) continue
      const normalized = normalizeUnsupportedColors(value)
      if (!normalized.includes("lab(") && !normalized.includes("oklch(")) node.style.setProperty(property, normalized)
    }
    node.style.setProperty("box-shadow", "none")
    node.style.setProperty("text-shadow", "none")
  })
}

/**
 * Rasterises one page: a full sheet of paper with a margin all round, holding the
 * slice of the content flow that belongs on it.
 *
 * This replaces capturing the whole document once and cutting the bitmap into
 * strips. A strip can only ever be a horizontal cut, and a horizontal cut has no
 * margin of its own — it inherits whatever the first strip happened to contain.
 * Building the page instead of cutting it is what gives every page, including the
 * last, the same 24px band of paper around the text.
 *
 * The clone is placed at the flow's own coordinates and shifted up by whole
 * content-box heights, so the rows on this page are exactly the rows the preview
 * shows in this page's sheet. The keep-together spacers in the live DOM are part
 * of the clone, which is what guarantees no block is cut across the boundary.
 */
async function capturePage(flow: HTMLElement, index: number, contentHeight: number, html2canvas: Html2CanvasFn): Promise<HTMLCanvasElement> {
  const frameHeight = pageFrameHeightPx()
  const host = document.createElement("div")
  host.setAttribute("data-export-page", String(index))
  host.style.cssText = [
    "position:fixed",
    "left:-20000px",
    "top:0",
    `width:${SHEET_WIDTH_PX}px`,
    `height:${frameHeight}px`,
    "background:#ffffff",
    "overflow:hidden",
    "margin:0",
    "padding:0",
    "border:0",
  ].join(";")

  // The window the flow is seen through, sized to the CONTENT box.
  //
  // The host is the whole sheet of paper, so clipping there left a 48px band at
  // the foot of every page in which the NEXT page's content was still drawn: a
  // line-item row, sliced off by the page edge, printed on this page and then
  // again, whole, at the top of the next one. The host has to stay the full frame
  // — it is the paper the PDF is made of — so the boundary needs its own element.
  const viewport = document.createElement("div")
  viewport.setAttribute("data-export-window", String(index))
  viewport.style.cssText = [
    "position:absolute",
    `left:${PAGE_MARGIN_PX}px`,
    `top:${PAGE_MARGIN_PX}px`,
    `width:${contentBoxWidthPx()}px`,
    `height:${contentHeight}px`,
    "overflow:hidden",
    "margin:0",
    "padding:0",
    "border:0",
  ].join(";")

  const clone = flow.cloneNode(true) as HTMLElement
  // The live element carries a `translateY` for whichever page it is drawing; the
  // clone is positioned by this page's index instead.
  clone.style.setProperty("position", "absolute")
  clone.style.setProperty("left", "0")
  clone.style.setProperty("top", "0")
  clone.style.setProperty("width", `${contentBoxWidthPx()}px`)
  clone.style.setProperty("margin", "0")
  clone.style.setProperty("transform", `translateY(-${index * contentHeight}px)`)
  viewport.appendChild(clone)
  host.appendChild(viewport)
  document.body.appendChild(host)

  try {
    return await html2canvas(host, {
      backgroundColor: "#ffffff",
      height: frameHeight,
      logging: false,
      onclone: (clonedDocument) => {
        const page = clonedDocument.querySelector<HTMLElement>(`[data-export-page="${index}"]`)
        if (page) normalizeClonedDocument(clonedDocument, page)
      },
      scale: CAPTURE_SCALE,
      useCORS: true,
      width: SHEET_WIDTH_PX,
    })
  } finally {
    host.remove()
  }
}

/** Rasterises every page of the document, in order. */
async function capturePages(flow: HTMLElement, html2canvas: Html2CanvasFn): Promise<HTMLCanvasElement[]> {
  const geometry = pageGeometry(flow)
  const contentHeight = geometry.pageHeightPx || contentBoxHeightPx()
  const pages: HTMLCanvasElement[] = []
  for (let index = 0; index < geometry.pageCount; index += 1) {
    pages.push(await capturePage(flow, index, contentHeight, html2canvas))
  }
  return pages
}

export type PageGeometry = {
  /** How far the content flow advances per page, in CSS pixels. */
  pageHeightPx: number
  /** The height of the paper itself, margins included, in CSS pixels. */
  pageFrameHeightPx: number
  pageCount: number
}

/**
 * Measures the content flow and reports where the exporter will break it.
 *
 * This is the single source of truth for pagination. The preview draws its page
 * sheets from this and the exporter consumes the identical numbers, so the visible
 * break can never drift from the real one.
 *
 * The advance is `pageHeightPx` — the CONTENT box, not the page frame. The flow
 * has no margin in it, so page two starts 630.5px after page one, not 678.5px;
 * the extra 48px is the margin the page frame adds back around every page.
 *
 * Slicing on the frame height instead is what left page two without a top
 * margin: the first page consumed the document's own padding as its allowance,
 * and every page after it started flush.
 *
 * The page height is derived from `SHEET_WIDTH_PX` rather than from the measured
 * flow, so it no longer varies with the content's width. That removes the
 * compounding error the old width-derived form had: it was about 0.6px short per
 * page, and multiplied by the page index it had drifted nearly four pixels by
 * page six — enough to cut a table row in a visibly different place from the PDF.
 *
 * The trailing tolerance is measured in bitmap pixels, not CSS pixels. Mixing
 * the two made the badge disagree with the PDF at the boundary case: a document
 * ending 4px into a page is 1 page, but was reported as 2.
 */
export function pageGeometry(element: HTMLElement, scale = CAPTURE_SCALE): PageGeometry {
  const flowHeight = Math.ceil(element.scrollHeight)
  if (element.scrollWidth < 1 || flowHeight < 1) {
    return { pageHeightPx: 0, pageFrameHeightPx: 0, pageCount: 1 }
  }

  const contentBoxBitmapHeight = Math.max(1, pageFrameBitmapHeight() - PAGE_MARGIN_PX * 2 * scale)
  const flowBitmapHeight = Math.max(1, Math.floor(flowHeight * scale))
  const tolerance = sliceTolerance(contentBoxBitmapHeight)

  return {
    pageHeightPx: contentBoxBitmapHeight / scale,
    pageFrameHeightPx: pageFrameHeightPx(),
    pageCount: Math.max(1, Math.ceil((flowBitmapHeight - tolerance) / contentBoxBitmapHeight)),
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportPreviewAsPdf(element: HTMLElement, filename = "invoice-draft.pdf") {
  // Loaded here rather than at module scope so the ~1 MB export stack stays out
  // of the page's first-load bundle. See the note at the top of this file.
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ])
  const pages = await capturePages(element, html2canvas)
  const pdf = new jsPDF({ format: "a4", orientation: "portrait", unit: "pt" })

  // The image is placed at its own aspect ratio, not stretched to the full sheet.
  // The pages are captured as full sheets so the margins are real, but the last one
  // is trimmed to the content it actually holds — that is the original behaviour,
  // and stretching it to A4 left a short final page sitting in a full page of
  // white, with the totals floating in the middle of the paper.
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage()
    const pageHeight = A4_WIDTH_PT * (page.height / page.width)
    pdf.addImage(page.toDataURL("image/png"), "PNG", 0, 0, A4_WIDTH_PT, pageHeight, undefined, "FAST")
  })

  pdf.save(filename)
}

export async function exportPreviewAsDocx(element: HTMLElement, filename = "invoice-draft.docx") {
  // Loaded here rather than at module scope so the export stack stays out of the
  // page's first-load bundle. `Document` is aliased because it would otherwise
  // shadow the DOM type. See the note at the top of this file.
  const [
    { default: html2canvas },
    { Document: DocxDocument, ImageRun, Packer, Paragraph },
  ] = await Promise.all([
    import("html2canvas"),
    import("docx"),
  ])
  const pages = await capturePages(element, html2canvas)
  const children = await Promise.all(pages.map(async (page, index) => {
    const response = await fetch(page.toDataURL("image/png"))
    const data = new Uint8Array(await response.arrayBuffer())
    const height = Math.round(DOCX_WIDTH_PX * (page.height / page.width))
    return new Paragraph({
      pageBreakBefore: index > 0,
      spacing: { before: 0, after: 0 },
      children: [new ImageRun({ type: "png", data, transformation: { height, width: DOCX_WIDTH_PX } })],
    })
  }))

  const document = new DocxDocument({ sections: [{
    children,
    properties: {
      page: {
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        size: { width: A4_WIDTH_TWIPS, height: A4_HEIGHT_TWIPS },
      },
    },
  }] })
  downloadBlob(await Packer.toBlob(document), filename)
}
