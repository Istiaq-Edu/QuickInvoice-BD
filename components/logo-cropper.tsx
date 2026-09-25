"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, Crop, Maximize2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  applyHandleDelta,
  applyMoveDelta,
  constrainToAspect,
  fitAspectRect,
  loadImageFile,
  MAX_LOGO_EDGE,
  MIN_CROP_EDGE,
  renderCropToFile,
  type CropHandle,
  type CropRect,
  type ImageBounds,
} from "@/lib/image/crop"

const ASPECTS: Array<{ label: string; value: number | null }> = [
  { label: "Free", value: null },
  { label: "Square", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
]

const handlePositions: Array<{ id: CropHandle; className: string; cursor: string; label: string }> = [
  { id: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "nwse-resize", label: "Crop top left" },
  { id: "n", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "ns-resize", label: "Crop top edge" },
  { id: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "nesw-resize", label: "Crop top right" },
  { id: "e", className: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2", cursor: "ew-resize", label: "Crop right edge" },
  { id: "se", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2", cursor: "nwse-resize", label: "Crop bottom right" },
  { id: "s", className: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2", cursor: "ns-resize", label: "Crop bottom edge" },
  { id: "sw", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2", cursor: "nesw-resize", label: "Crop bottom left" },
  { id: "w", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2", cursor: "ew-resize", label: "Crop left edge" },
]

type DragState = { mode: "move" | CropHandle; startX: number; startY: number; startCrop: CropRect }

export type CroppedLogo = { file: File; width: number; height: number }

type LogoCropperProps = {
  file: File
  onCancel: () => void
  onConfirm: (result: CroppedLogo) => void
}

export function LogoCropper({ file, onCancel, onConfirm }: LogoCropperProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = useState("")
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const titleId = useId()

  const bounds: ImageBounds = useMemo(
    () => ({ width: image?.naturalWidth ?? 1, height: image?.naturalHeight ?? 1 }),
    [image],
  )

  useEffect(() => {
    let active = true
    loadImageFile(file)
      .then((loaded) => {
        if (!active) return
        setImage(loaded)
        // Seed the crop from the image's own shape so the first frame is valid
        // without a follow-up effect that would trigger a cascading render.
        const natural = { width: loaded.naturalWidth, height: loaded.naturalHeight }
        setCrop(fitAspectRect(loaded.naturalWidth / loaded.naturalHeight, natural, 0.92))
      })
      .catch((loadFailure: unknown) => {
        if (active) setLoadError(loadFailure instanceof Error ? loadFailure.message : "That image could not be read.")
      })
    return () => {
      active = false
    }
  }, [file])

  // Track the stage so the crop can be expressed in natural image pixels while
  // the on-screen size changes with zoom and viewport width.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [image])

  const fitScale = useMemo(() => {
    if (!image || !stageSize.width || !stageSize.height) return 1
    return Math.min(stageSize.width / image.naturalWidth, stageSize.height / image.naturalHeight)
  }, [image, stageSize])

  const displayScale = fitScale * zoom
  const displayWidth = image ? image.naturalWidth * displayScale : 0
  const displayHeight = image ? image.naturalHeight * displayScale : 0

  // A comfortable minimum grab size, expressed in image pixels.
  const minEdge = Math.max(16, Math.round(MIN_CROP_EDGE / (displayScale || 1)))

  const resetCrop = useCallback(
    (nextAspect: number | null = aspect) => {
      if (!image) return
      const base = fitAspectRect(nextAspect ?? image.naturalWidth / image.naturalHeight, bounds, 0.92)
      setCrop(base)
    },
    [aspect, bounds, image],
  )

  useEffect(() => {
    if (!crop) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancel()
        return
      }
      const step = event.shiftKey ? 40 : 8
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const delta = deltas[event.key]
      if (!delta) return
      event.preventDefault()
      setCrop((current) => (current ? applyMoveDelta(current, delta[0], delta[1], bounds) : current))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [bounds, crop, onCancel])

  useEffect(() => {
    if (!crop || !image) return

    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      // Pointer deltas arrive in screen pixels; the crop lives in image pixels.
      const deltaX = (event.clientX - drag.startX) / displayScale
      const deltaY = (event.clientY - drag.startY) / displayScale
      setCrop(() => {
        const moved =
          drag.mode === "move"
            ? applyMoveDelta(drag.startCrop, deltaX, deltaY, bounds)
            : applyHandleDelta(drag.startCrop, drag.mode, deltaX, deltaY, bounds, minEdge)
        return aspect ? constrainToAspect(moved, aspect, bounds, minEdge) : moved
      })
    }

    const stop = () => {
      dragRef.current = null
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [aspect, bounds, crop, displayScale, image, minEdge])

  const startDrag = (event: React.PointerEvent, mode: "move" | CropHandle) => {
    if (!crop) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, startCrop: crop }
  }

  const output = useMemo(() => {
    if (!crop) return { width: 0, height: 0 }
    const longest = Math.max(crop.width, crop.height)
    const scale = longest > MAX_LOGO_EDGE ? MAX_LOGO_EDGE / longest : 1
    return { width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)) }
  }, [crop])

  const confirm = async () => {
    if (!image || !crop) return
    setSaving(true)
    setError("")
    try {
      onConfirm({
        file: await renderCropToFile(image, crop, file.name),
        width: output.width,
        height: output.height,
      })
    } catch (renderFailure: unknown) {
      setError(renderFailure instanceof Error ? renderFailure.message : "The logo could not be processed.")
      setSaving(false)
    }
  }

  const cropBox = crop
    ? {
        left: crop.x * displayScale,
        top: crop.y * displayScale,
        width: crop.width * displayScale,
        height: crop.height * displayScale,
      }
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/45 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Crop size={18} className="shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-sm font-semibold">Crop company logo</h2>
              <p className="truncate text-xs text-muted-foreground">{file.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onCancel} aria-label="Cancel cropping">
            <X />
          </Button>
        </div>

        {loadError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button className="mt-4" variant="outline" size="sm" type="button" onClick={onCancel}>Close</Button>
          </div>
        ) : !image || !crop || !cropBox ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">Preparing image…</div>
        ) : (
          <>
            <div ref={stageRef} className="relative h-[46vh] min-h-56 touch-none overflow-hidden bg-foreground/5 select-none sm:h-[420px]">
              <div className="absolute inset-0 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.src} alt="" className="max-w-none" style={{ width: displayWidth, height: displayHeight }} draggable={false} />
              </div>
              <div
                className="absolute cursor-move touch-none"
                style={{ left: cropBox.left, top: cropBox.top, width: cropBox.width, height: cropBox.height, boxShadow: "0 0 0 9999px rgba(20,28,24,0.55)" }}
                onPointerDown={(event) => startDrag(event, "move")}
                role="application"
                aria-label="Crop area. Use the arrow keys to move it."
                tabIndex={0}
              >
                <div className="pointer-events-none absolute inset-0 border-2 border-white shadow-[0_0_0_1px_rgba(20,28,24,0.4)]" />
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-45">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <span key={index} className="border border-white/70" />
                  ))}
                </div>
                {handlePositions.map((handle) => (
                  <div
                    key={handle.id}
                    aria-label={handle.label}
                    className={`absolute z-10 size-4 rounded-full border-2 border-white bg-primary shadow-md ${handle.className}`}
                    style={{ cursor: handle.cursor, touchAction: "none" }}
                    onPointerDown={(event) => startDrag(event, handle.id)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-4 border-t border-border px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Aspect</span>
                {ASPECTS.map((option) => {
                  const active = option.value === aspect
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setAspect(option.value)
                        setCrop(constrainToAspect(crop, option.value, bounds, minEdge))
                      }}
                      className={`min-h-8 rounded-md border px-3 text-xs font-semibold transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"}`}
                    >
                      {option.label}
                    </button>
                  )
                })}
                <Button variant="ghost" size="sm" type="button" onClick={() => resetCrop()} className="ml-auto">
                  <Maximize2 data-icon="inline-start" />
                  Reset
                </Button>
              </div>

              <label className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                <span className="w-14 shrink-0">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.05}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="h-2 min-w-0 flex-1 accent-primary"
                  aria-label="Zoom"
                />
                <span className="w-10 shrink-0 text-right tnum">{zoom.toFixed(1)}×</span>
              </label>

              <p className="text-xs text-muted-foreground" role="status">
                Uploads at {output.width} × {output.height}px. Oversized images are shrunk automatically so the logo stays sharp on paper.
              </p>

              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" type="button" onClick={onCancel} disabled={saving}>Cancel</Button>
                <Button type="button" onClick={() => void confirm()} disabled={saving}>
                  <Check data-icon="inline-start" />
                  {saving ? "Preparing…" : "Use this crop"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
