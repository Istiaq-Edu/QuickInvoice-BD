import html2canvas from "html2canvas"
import { Document, ImageRun, Packer, Paragraph } from "docx"
import { jsPDF } from "jspdf"

const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89
const DOCX_WIDTH_PX = 620
const A4_HEIGHT_RATIO = A4_HEIGHT_PT / A4_WIDTH_PT

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

async function captureElement(element: HTMLElement) {
  const exportRoot = "invoice-export-root"
  element.setAttribute("data-export-root", exportRoot)
  try {
    return await html2canvas(element, {
      backgroundColor: "#ffffff",
      height: element.scrollHeight,
      logging: false,
      onclone: (clonedDocument) => {
        const clone = clonedDocument.querySelector<HTMLElement>(`[data-export-root="${exportRoot}"]`)
        if (!clone) return

        clonedDocument.querySelectorAll("style").forEach((style) => {
          if (style.textContent) style.textContent = normalizeUnsupportedColors(style.textContent)
        })

        const roots = [clonedDocument.documentElement, clonedDocument.body, clone].filter((node): node is HTMLElement => Boolean(node))
        const nodes = Array.from(new Set(roots.flatMap((root) => [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))])))
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
      },
      scale: 2,
      useCORS: true,
      width: element.scrollWidth,
    })
  } finally {
    element.removeAttribute("data-export-root")
  }
}

export function estimateExportPageCount(element: HTMLElement) {
  const pageHeight = Math.max(1, element.scrollWidth * A4_HEIGHT_RATIO)
  const trailingOverflowTolerance = Math.max(8, Math.ceil(pageHeight * 0.004))
  return Math.max(1, Math.ceil((element.scrollHeight - trailingOverflowTolerance) / pageHeight))
}

function splitPages(source: HTMLCanvasElement) {
  const pageHeight = Math.max(1, Math.floor(source.width * A4_HEIGHT_RATIO))
  const trailingOverflowTolerance = Math.max(8, Math.ceil(pageHeight * 0.004))
  const pageCount = Math.max(1, Math.ceil((source.height - trailingOverflowTolerance) / pageHeight))
  const effectiveHeight = Math.min(source.height, pageCount * pageHeight)
  const pages: HTMLCanvasElement[] = []

  for (let y = 0; y < effectiveHeight; y += pageHeight) {
    const height = Math.min(pageHeight, effectiveHeight - y)
    const page = document.createElement("canvas")
    page.width = source.width
    page.height = height
    const context = page.getContext("2d")
    if (!context) throw new Error("Could not create an invoice export canvas.")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, page.width, page.height)
    context.drawImage(source, 0, y, source.width, height, 0, 0, page.width, height)
    pages.push(page)
  }

  return pages
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
  const source = await captureElement(element)
  const pages = splitPages(source)
  const pdf = new jsPDF({ format: "a4", orientation: "portrait", unit: "pt" })

  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage()
    const pageHeight = A4_WIDTH_PT * (page.height / page.width)
    pdf.addImage(page.toDataURL("image/png"), "PNG", 0, 0, A4_WIDTH_PT, pageHeight, undefined, "FAST")
  })

  pdf.save(filename)
}

export async function exportPreviewAsDocx(element: HTMLElement, filename = "invoice-draft.docx") {
  const source = await captureElement(element)
  const pages = splitPages(source)
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

  const document = new Document({ sections: [{
    children,
    properties: {
      page: {
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        size: { width: 11906, height: 16838 },
      },
    },
  }] })
  downloadBlob(await Packer.toBlob(document), filename)
}
