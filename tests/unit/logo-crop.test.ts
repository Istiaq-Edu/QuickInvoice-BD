import { describe, expect, it } from "vitest"
import {
  applyHandleDelta,
  applyMoveDelta,
  clamp,
  constrainToAspect,
  fitAspectRect,
  normalizeCropRect,
  type ImageBounds,
} from "../../lib/image/crop"

const bounds: ImageBounds = { width: 1000, height: 500 }
const centre: { x: number; y: number; width: number; height: number } = { x: 250, y: 125, width: 500, height: 250 }

describe("clamp", () => {
  it("bounds values and survives NaN", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(50, 0, 10)).toBe(10)
    expect(clamp(Number.NaN, 2, 10)).toBe(2)
  })
})

describe("normalizeCropRect", () => {
  it("keeps a valid rect unchanged", () => {
    expect(normalizeCropRect(centre, bounds)).toEqual(centre)
  })

  it("pulls a rect back inside the image", () => {
    expect(normalizeCropRect({ x: -50, y: 900, width: 500, height: 250 }, bounds)).toEqual({
      x: 0,
      y: 250,
      width: 500,
      height: 250,
    })
  })

  it("never shrinks a rect below the minimum edge", () => {
    const result = normalizeCropRect({ x: 0, y: 0, width: 2, height: 2 }, bounds)
    expect(result.width).toBe(24)
    expect(result.height).toBe(24)
  })

  it("allows the minimum to exceed a tiny image", () => {
    const tiny: ImageBounds = { width: 10, height: 10 }
    expect(normalizeCropRect({ x: 0, y: 0, width: 4, height: 4 }, tiny)).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })
})

describe("applyHandleDelta", () => {
  it("drags the west edge and pins the east edge", () => {
    const result = applyHandleDelta(centre, "w", 100, 0, bounds)
    expect(result).toEqual({ x: 350, y: 125, width: 400, height: 250 })
  })

  it("drags the east edge and pins the west edge", () => {
    expect(applyHandleDelta(centre, "e", 100, 0, bounds)).toEqual({ x: 250, y: 125, width: 600, height: 250 })
  })

  it("drags the north edge and pins the south edge", () => {
    expect(applyHandleDelta(centre, "n", 0, 50, bounds)).toEqual({ x: 250, y: 175, width: 500, height: 200 })
  })

  it("drags a corner on both axes", () => {
    expect(applyHandleDelta(centre, "se", -100, -50, bounds)).toEqual({ x: 250, y: 125, width: 400, height: 200 })
  })

  it("stops a west drag at the left edge instead of inverting", () => {
    const result = applyHandleDelta(centre, "w", -5000, 0, bounds)
    expect(result.x).toBe(0)
    expect(result.width).toBe(750)
    expect(result.width).toBeGreaterThan(0)
  })

  it("stops an east drag at the right edge", () => {
    const result = applyHandleDelta(centre, "e", 5000, 0, bounds)
    expect(result.x + result.width).toBe(1000)
  })

  it("clamps to the minimum edge rather than flipping", () => {
    const result = applyHandleDelta(centre, "e", -5000, 0, bounds)
    expect(result.width).toBe(24)
    expect(result.height).toBe(250)
  })
})

describe("applyMoveDelta", () => {
  it("moves the crop without resizing it", () => {
    expect(applyMoveDelta(centre, 50, -25, bounds)).toEqual({ x: 300, y: 100, width: 500, height: 250 })
  })

  it("stops at the left and top edges", () => {
    expect(applyMoveDelta(centre, -5000, -5000, bounds)).toEqual({ x: 0, y: 0, width: 500, height: 250 })
  })

  it("stops at the right and bottom edges", () => {
    const result = applyMoveDelta(centre, 5000, 5000, bounds)
    expect(result.x + result.width).toBe(1000)
    expect(result.y + result.height).toBe(500)
  })
})

describe("constrainToAspect", () => {
  it("leaves the rect alone when no aspect is set", () => {
    expect(constrainToAspect(centre, null, bounds)).toEqual(centre)
  })

  it("locks a square crop around the centre", () => {
    const result = constrainToAspect(centre, 1, bounds)
    expect(result.width).toBeCloseTo(result.height)
    expect(result.x + result.width / 2).toBeCloseTo(centre.x + centre.width / 2)
  })

  it("keeps a locked rect inside the image", () => {
    const result = constrainToAspect({ x: 900, y: 400, width: 100, height: 100 }, 1, bounds)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
    expect(result.x + result.width).toBeLessThanOrEqual(1000)
    expect(result.y + result.height).toBeLessThanOrEqual(500)
  })

  it("respects a tall aspect on a wide image", () => {
    const result = constrainToAspect(centre, 0.25, bounds)
    expect(result.width / result.height).toBeCloseTo(0.25)
  })

  it("preserves the crop area instead of snapping to the largest rect", () => {
    // A small crop must stay small when a ratio is chosen.
    const small = { x: 100, y: 100, width: 100, height: 200 }
    const result = constrainToAspect(small, 1, bounds)
    expect(result.width / result.height).toBeCloseTo(1)
    // Area 20000 -> 141.4 x 141.4, not the 500 x 500 max fit.
    expect(result.width).toBeCloseTo(Math.sqrt(20000))
    expect(result.width).toBeLessThan(200)
  })

  it("preserves area when locking an already-constrained crop", () => {
    const wide = constrainToAspect(centre, 1, bounds)
    const tall = constrainToAspect(wide, 0.5, bounds)
    const wideArea = wide.width * wide.height
    const tallArea = tall.width * tall.height
    expect(tall.width / tall.height).toBeCloseTo(0.5)
    expect(tallArea).toBeCloseTo(wideArea, -1)
  })

  it("never exceeds the image even when the minimum forces growth", () => {
    const result = constrainToAspect({ x: 0, y: 0, width: 20, height: 20 }, 10, bounds, 24)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
    expect(result.x + result.width).toBeLessThanOrEqual(1000)
    expect(result.y + result.height).toBeLessThanOrEqual(500)
  })

  it("keeps the crop centre fixed through a ratio change", () => {
    const result = constrainToAspect({ x: 300, y: 150, width: 120, height: 90 }, 1, bounds)
    expect(result.x + result.width / 2).toBeCloseTo(360)
    expect(result.y + result.height / 2).toBeCloseTo(195)
  })
})

describe("fitAspectRect", () => {
  it("centres a square crop", () => {
    const result = fitAspectRect(1, bounds)
    expect(result.width).toBeCloseTo(result.height)
    expect(result.x + result.width / 2).toBeCloseTo(500)
    expect(result.y + result.height / 2).toBeCloseTo(250)
  })

  it("is limited by width for a wide aspect on a wider image", () => {
    // A 4:1 rect in a 2:1 image runs out of width first: 900 * 1/4 = 225 tall.
    const result = fitAspectRect(4, bounds)
    expect(result.width).toBeCloseTo(900)
    expect(result.height).toBeCloseTo(225)
    expect(result.x).toBeCloseTo(50)
    expect(result.y).toBeCloseTo((500 - 225) / 2)
  })

  it("is limited by height for a tall aspect", () => {
    // A 0.5:1 rect runs out of height first: 450 tall implies 225 wide.
    const result = fitAspectRect(0.5, bounds)
    expect(result.height).toBeCloseTo(450)
    expect(result.width).toBeCloseTo(225)
    expect(result.y).toBeCloseTo(25)
  })

  it("fills the image when the inset is 1", () => {
    const result = fitAspectRect(1, bounds, 1)
    expect(result.width).toBeCloseTo(500)
    expect(result.height).toBeCloseTo(500)
    expect(result.x).toBeCloseTo(250)
  })
})
