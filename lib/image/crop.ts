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
 * Locks the crop to a target width/height ratio while preserving its area, so
 * choosing a preset reshapes the current crop instead of snapping it to the
 * largest rectangle of that shape. The rect is scaled around its centre and
 * re-clamped, so a ratio can never push the crop outside the source image.
 */
export function constrainToAspect(rect: CropRect, aspect: number | null, bounds: ImageBounds, minEdge = MIN_CROP_EDGE): CropRect {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return normalizeCropRect(rect, bounds, minEdge)

  const minWidth = Math.min(minEdge, bounds.width)
  const minHeight = Math.min(minEdge, bounds.height)

  const area = Math.max(1, rect.width * rect.height)
  let width = Math.sqrt(area * aspect)
  let height = width / aspect

  // Shrink to fit the image while holding the ratio.
  let shrink = Math.max(1, width / bounds.width, height / bounds.height)
  width /= shrink
  height /= shrink

  // Grow back if the minimum grab size demands it, still holding the ratio.
  if (width < minWidth) {
    width = minWidth
    height = width / aspect
  }
  if (height < minHeight) {
    height = minHeight
    width = height * aspect
  }

  // The minimum can push the rect past the image; clamp once more.
  shrink = Math.max(1, width / bounds.width, height / bounds.height)
  width /= shrink
  height /= shrink

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

/**
 * A decoded image that owns no object URL.
 *
 * An earlier version created a blob URL, revoked it as soon as the element had
 * loaded, and then handed the same element back to the caller. The `src` was
 * already dead by the time the cropper rendered it, so the stage showed nothing
 * and every resize interaction appeared broken. Decoding to an ImageBitmap keeps
 * no URL alive at all; the fallback keeps its URL alive until `close()`.
 */
export type DecodedImage = {
  width: number
  height: number
  /** Draws a source region of the image into a 2D context. */
  draw: (
    context: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void
  /** Releases the underlying decoded data. Safe to call more than once. */
  close: () => void
}

function decodeViaElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    const release = () => URL.revokeObjectURL(url)
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height) {
        release()
        reject(new Error("That image could not be read. Try a different file."))
        return
      }
      resolve({
        width,
        height,
        draw: (context, sx, sy, sw, sh, dx, dy, dw, dh) =>
          context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh),
        close: release,
      })
    }
    image.onerror = () => {
      release()
      reject(new Error("That file is not a readable image."))
    }
    image.src = url
  })
}

export async function loadImageFile(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file)
      if (bitmap.width && bitmap.height) {
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw: (context, sx, sy, sw, sh, dx, dy, dw, dh) =>
            context.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh),
          close: () => bitmap.close(),
        }
      }
      bitmap.close()
    } catch {
      // Fall through to the element-based decoder.
    }
  }
  return decodeViaElement(file)
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

function renderToCanvas(image: DecodedImage, rect: CropRect, maxEdge: number) {
  const safe = normalizeCropRect(rect, { width: image.width, height: image.height }, 1)
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
  image.draw(
    context,
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
  image: DecodedImage,
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
  const { width, height } = image
  const longest = Math.max(width, height)
  if (file.size <= MAX_UPLOAD_BYTES && longest <= maxEdge) {
    image.close()
    return file
  }
  try {
    return await renderCropToFile(image, { x: 0, y: 0, width, height }, file.name, { maxEdge })
  } finally {
    image.close()
  }
}
