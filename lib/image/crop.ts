export type CropRect = { x: number; y: number; width: number; height: number }
export type ImageBounds = { width: number; height: number }
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

export const MIN_CROP_EDGE = 24

export function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * Fits a crop rectangle inside the image, guaranteeing a minimum edge length
 * and never allowing it to escape the image bounds. Handles are clamped before
 * the size so that dragging a side past an edge shrinks the rect down to the
 * minimum instead of flipping it inside out.
 */
export function normalizeCropRect(rect: CropRect, bounds: ImageBounds, minEdge = MIN_CROP_EDGE): CropRect {
  const minWidth = Math.min(minEdge, bounds.width)
  const minHeight = Math.min(minEdge, bounds.height)

  const width = clamp(rect.width, minWidth, bounds.width)
  const height = clamp(rect.height, minHeight, bounds.height)

  return {
    x: clamp(rect.x, 0, bounds.width - width),
    y: clamp(rect.y, 0, bounds.height - height),
    width,
    height,
  }
}

/**
 * Applies a pointer movement to a single crop handle. Corners move both axes,
 * edges move one, and the opposite edge stays pinned so the crop grows and
 * shrinks from the side the user grabbed.
 */
export function applyHandleDelta(
  start: CropRect,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
  bounds: ImageBounds,
  minEdge = MIN_CROP_EDGE,
): CropRect {
  let { x, y, width, height } = start
  const right = x + width
  const bottom = y + height

  if (handle.includes("w")) {
    const nextX = clamp(x + deltaX, 0, right - minEdge)
    x = nextX
    width = right - nextX
  }
  if (handle.includes("e")) {
    width = clamp(right + deltaX - x, minEdge, bounds.width - x)
  }
  if (handle.includes("n")) {
    const nextY = clamp(y + deltaY, 0, bottom - minEdge)
    y = nextY
    height = bottom - nextY
  }
  if (handle.includes("s")) {
    height = clamp(bottom + deltaY - y, minEdge, bounds.height - y)
  }

  return normalizeCropRect({ x, y, width, height }, bounds, minEdge)
}

/** Moves the whole crop rectangle, keeping it fully inside the image. */
export function applyMoveDelta(start: CropRect, deltaX: number, deltaY: number, bounds: ImageBounds): CropRect {
  return normalizeCropRect(
    { ...start, x: start.x + deltaX, y: start.y + deltaY },
    bounds,
    Math.min(MIN_CROP_EDGE, bounds.width, bounds.height),
  )
}

/**
 * Locks the crop to a target width/height ratio while preserving area. The
 * rect is scaled around its centre, then re-clamped, so a ratio can never push
 * the crop outside the source image.
 */
export function constrainToAspect(rect: CropRect, aspect: number | null, bounds: ImageBounds, minEdge = MIN_CROP_EDGE): CropRect {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return normalizeCropRect(rect, bounds, minEdge)

  const minWidth = Math.min(minEdge, bounds.width)
  const minHeight = Math.min(minEdge, bounds.height)
  const maxWidth = bounds.width
  const maxHeight = bounds.height

  // Largest rect with this ratio that still fits the image.
  let width = Math.min(maxWidth, maxHeight * aspect)
  let height = width / aspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }
  width = Math.max(width, minWidth)
  height = width / aspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }
  height = Math.max(height, minHeight)

  const centreX = rect.x + rect.width / 2
  const centreY = rect.y + rect.height / 2
  return normalizeCropRect(
    { x: centreX - width / 2, y: centreY - height / 2, width, height },
    bounds,
    minEdge,
  )
}

/** Largest centred crop with the requested ratio, used when a preset is chosen. */
export function fitAspectRect(aspect: number, bounds: ImageBounds, inset = 0.9): CropRect {
  const available = { width: bounds.width * inset, height: bounds.height * inset }
  let width = available.width
  let height = width / aspect
  if (height > available.height) {
    height = available.height
    width = height * aspect
  }
  return normalizeCropRect(
    { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height },
    bounds,
    1,
  )
}


/** Logos are printed on A4 documents; 1024px is well past print resolution. */
export const MAX_LOGO_EDGE = 1024
/** Matches the storage bucket limit so a rendered file can never be rejected. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export type RenderOptions = {
  maxEdge?: number
  mimeType?: "image/png" | "image/webp"
  quality?: number
}

function scaleToFit(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scale: 1 }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      // Guard against zero-sized images that would make the crop maths divide by zero.
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("That image could not be read. Try a different file."))
        return
      }
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("That file is not a readable image."))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be processed."))),
      mimeType,
      quality,
    )
  })
}

function renderToCanvas(image: HTMLImageElement, rect: CropRect, maxEdge: number) {
  const safe = normalizeCropRect(rect, { width: image.naturalWidth, height: image.naturalHeight }, 1)
  const { width, height } = scaleToFit(safe.width, safe.height, maxEdge)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Your browser could not process the image.")
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  // Transparent backgrounds are meaningful for logos, so clear before drawing.
  context.clearRect(0, 0, width, height)
  context.drawImage(
    image,
    Math.round(safe.x),
    Math.round(safe.y),
    Math.round(safe.width),
    Math.round(safe.height),
    0,
    0,
    width,
    height,
  )
  return canvas
}

/**
 * Renders a crop to a File ready for upload. Uses lossless PNG first so logo
 * edges stay sharp, and only falls back to WebP when the PNG would exceed the
 * bucket limit, which happens with photographic logos.
 */
export async function renderCropToFile(
  image: HTMLImageElement,
  rect: CropRect,
  originalName: string,
  options: RenderOptions = {},
): Promise<File> {
  const canvas = renderToCanvas(image, rect, options.maxEdge ?? MAX_LOGO_EDGE)

  let blob: Blob | null = null
  try {
    blob = await canvasToBlob(canvas, "image/png")
  } catch {
    blob = null
  }
  let mimeType: "image/png" | "image/webp" = "image/png"
  let extension = "png"

  if (!blob || blob.size > MAX_UPLOAD_BYTES) {
    const fallback = await canvasToBlob(canvas, "image/webp", options.quality ?? 0.92)
    if (!fallback.size || fallback.size > MAX_UPLOAD_BYTES) {
      throw new Error("The cropped logo is still too large. Try a smaller crop area.")
    }
    blob = fallback
    mimeType = "image/webp"
    extension = "webp"
  }

  const baseName = originalName.replace(/\.[^.]+$/, "").slice(0, 60) || "logo"
  return new File([blob], `${baseName}.${extension}`, { type: mimeType })
}

/** Downscales an untouched image so a large photo does not need a 2 MB upload. */
export async function prepareLogoFile(file: File, maxEdge = MAX_LOGO_EDGE): Promise<File> {
  const image = await loadImageFile(file)
  const { width, height } = { width: image.naturalWidth, height: image.naturalHeight }
  const longest = Math.max(width, height)
  if (file.size <= MAX_UPLOAD_BYTES && longest <= maxEdge) return file
  return renderCropToFile(image, { x: 0, y: 0, width, height }, file.name, { maxEdge })
}
