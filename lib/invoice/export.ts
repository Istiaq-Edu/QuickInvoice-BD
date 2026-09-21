import html2canvas from "html2canvas"
import { Document, ImageRun, Packer, Paragraph } from "docx"
import { jsPDF } from "jspdf"

const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89
const DOCX_WIDTH_PX = 620

async function captureElement(element: HTMLElement) {
  return html2canvas(element, {
    backgroundColor: "#ffffff",
    height: element.scrollHeight,
    logging: false,
    scale: 2,
    useCORS: true,
    width: element.scrollWidth,
  })
}

function splitPages(source: HTMLCanvasElement) {
  const pageHeight = Math.max(1, Math.floor(source.width * (A4_HEIGHT_PT / A4_WIDTH_PT)))
  const pages: HTMLCanvasElement[] = []

  for (let y = 0; y < source.height; y += pageHeight) {
    const height = Math.min(pageHeight, source.height - y)
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

export async function exportPreviewAsPdf(element: HTMLElement) {
  const source = await captureElement(element)
  const pages = splitPages(source)
  const pdf = new jsPDF({ format: "a4", orientation: "portrait", unit: "pt" })

  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage()
    const pageHeight = A4_WIDTH_PT * (page.height / page.width)
    pdf.addImage(page.toDataURL("image/png"), "PNG", 0, 0, A4_WIDTH_PT, pageHeight, undefined, "FAST")
  })

  pdf.save("invoice-draft.pdf")
}

export async function exportPreviewAsDocx(element: HTMLElement) {
  const source = await captureElement(element)
  const pages = splitPages(source)
  const children = await Promise.all(pages.map(async (page, index) => {
    const response = await fetch(page.toDataURL("image/png"))
    const data = new Uint8Array(await response.arrayBuffer())
    const height = Math.round(DOCX_WIDTH_PX * (page.height / page.width))
    return new Paragraph({
      pageBreakBefore: index > 0,
      children: [new ImageRun({ type: "png", data, transformation: { height, width: DOCX_WIDTH_PX } })],
    })
  }))

  const document = new Document({ sections: [{ children }] })
  downloadBlob(await Packer.toBlob(document), "invoice-draft.docx")
}
