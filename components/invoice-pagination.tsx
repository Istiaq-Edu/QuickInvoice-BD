"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { pageGeometry, SHEET_WIDTH_PX } from "@/lib/invoice/export"

export type PaperGeometry = { pageCount: number; pageHeightPx: number; pageFrameHeightPx: number }

const UNMEASURED: PaperGeometry = { pageCount: 1, pageHeightPx: 0, pageFrameHeightPx: 0 }

/**
 * Reports where the exporter will cut the rendered document.
 *
 * A ResizeObserver on the paper is enough on its own: the sheet is height:auto,
 * so any content change grows the border box and fires the observer. What it
 * cannot see is the web font. The taka sign is drawn by a Bengali fallback that
 * loads with `display: swap`, and measuring before it lands puts every boundary
 * against fallback metrics, so `document.fonts.ready` re-measures once the real
 * face is in.
 *
 * The identity check in the setter keeps React from re-rendering on every
 * sub-pixel jitter the observer reports.
 */
export function usePaperGeometry(ref: React.RefObject<HTMLElement | null>) {
  const [geometry, setGeometry] = useState<PaperGeometry>(UNMEASURED)
  const frame = useRef(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      window.cancelAnimationFrame(frame.current)
      frame.current = window.requestAnimationFrame(() => {
        // A hidden step (the mobile wizard keeps the preview off-screen until
        // the last step) reports a zero width. Dividing by that would produce a
        // one-pixel page height and a nonsense page count.
        if (!element.isConnected || element.scrollWidth === 0) {
          setGeometry(UNMEASURED)
          return
        }
        const next = pageGeometry(element)
        setGeometry((current) =>
          current.pageCount === next.pageCount
            && current.pageHeightPx === next.pageHeightPx
            && current.pageFrameHeightPx === next.pageFrameHeightPx
            ? current
            : next,
        )
      })
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    void document.fonts?.ready.then(measure)
    measure()

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame.current)
    }
  }, [ref])

  useEffect(() => () => window.cancelAnimationFrame(frame.current), [])

  return geometry
}

/**
 * Scales the fixed-width sheet down to whatever room the preview column has.
 *
 * The sheet is pinned to `SHEET_WIDTH_PX` so that the document — and therefore
 * the exported PDF — is laid out identically on every device. On a phone the
 * column is far narrower than that, and a `w-full` sheet would re-flow the
 * layout to fit, which is what used to squeeze the description column to 10px and
 * inflate the page count. Scaling instead keeps the layout intact: the sheet is
 * laid out once, at the canonical width, and simply drawn smaller.
 *
 * A transform does not change `scrollWidth` or `scrollHeight`, so `pageGeometry`
 * keeps reporting the real unscaled geometry while the page-break rules are
 * positioned inside the same scaled box — they land on the same content rows
 * either way.
 *
 * The outer element is given the SCALED width and height rather than leaving the
 * sheet's layout box intact, because a transform does not reclaim layout space:
 * without this the preview would reserve 480px of width on a 296px phone and
 * push the whole page into a horizontal scroll.
 */
export function useFittedSheet(
  paperRef: React.RefObject<HTMLElement | null>,
  fitRef: React.RefObject<HTMLElement | null>,
  stackRef?: React.RefObject<HTMLElement | null>,
) {
  const [fit, setFit] = useState({ scale: 1, width: SHEET_WIDTH_PX, height: 0 })
  const frame = useRef(0)

  useLayoutEffect(() => {
    const paper = paperRef.current
    const target = fitRef.current
    const stack = stackRef?.current
    if (!paper || !target) return

    // The room available is the COLUMN's width, not this element's own.
    //
    // This element is given the SCALED width — a transform does not reclaim layout
    // space, so without it the preview would reserve 480px on a 296px phone. But
    // that made measuring it circular: it reported its own assigned width back,
    // the scale came out as `480 / 480`, and the sheet was never scaled down at
    // all. On a phone it sat at full size inside a card that clips, so the right
    // hand of every page — price, discount, amount, and the totals block — was
    // simply cut off, while the page reported no horizontal overflow because the
    // card swallowed it. The parent is what actually constrains the layout.
    const column = target.parentElement
    if (!column) return

    const apply = () => {
      window.cancelAnimationFrame(frame.current)
      frame.current = window.requestAnimationFrame(() => {
        const columnStyle = window.getComputedStyle(column)
        const available = column.clientWidth
          - Number.parseFloat(columnStyle.paddingLeft || "0")
          - Number.parseFloat(columnStyle.paddingRight || "0")
        if (available <= 0) return
        // Never scale UP: a wide desktop column should show the document at its
        // true size with the card's own margin around it, not magnified.
        const scale = Math.min(1, available / SHEET_WIDTH_PX)
        // Reserve the height of the whole PAGE STACK when there is one. The
        // stack is taller than the content it holds, because each page sheet is
        // a full page with the gaps between them; sizing the box to the content
        // instead would clip the last page off the bottom of the preview.
        const height = stack?.scrollHeight || paper.scrollHeight
        setFit((current) =>
          current.scale === scale && current.width === Math.round(SHEET_WIDTH_PX * scale) && current.height === Math.round(height * scale)
            ? current
            : { scale, width: Math.round(SHEET_WIDTH_PX * scale), height: Math.round(height * scale) },
        )
      })
    }

    // The fit depends on the COLUMN width, so that is what is observed, while the
    // sheet's own height is what the reserved box has to match. Both change
    // independently: a narrower window reflows nothing but the scale, and an
    // added line changes the height while leaving the scale alone.
    const widthObserver = new ResizeObserver(apply)
    widthObserver.observe(column)
    const content = new ResizeObserver(apply)
    content.observe(paper)
    if (stack) content.observe(stack)
    void document.fonts?.ready.then(apply)
    apply()

    return () => {
      widthObserver.disconnect()
      content.disconnect()
      window.cancelAnimationFrame(frame.current)
    }
  }, [paperRef, fitRef, stackRef])

  useEffect(() => () => window.cancelAnimationFrame(frame.current), [])

  return fit
}
