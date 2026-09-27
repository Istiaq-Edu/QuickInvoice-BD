import { describe, expect, it } from "vitest"

import { settlementDisplay } from "../../lib/invoice/types"

const TAKA = "৳"

// The Balance cell used to contradict the Status column beside it: a fully paid
// invoice rendered "৳0" over "of ৳2,000 due", so a row badged Paid also claimed
// money was outstanding. These tests pin the wording so that cannot come back.
describe("settlementDisplay", () => {
  it("leads with the total and says outstanding when nothing has been received", () => {
    const display = settlementDisplay(2000, 0)
    expect(display.headline).toBe(`${TAKA}2,000`)
    expect(display.detail).toBe("Outstanding")
    expect(display.showBar).toBe(false)
  })

  it("never shows a zero balance on a settled invoice", () => {
    const display = settlementDisplay(2000, 2000)
    // The old output was "৳0" over "of ৳2,000 due".
    expect(display.headline).toBe(`${TAKA}2,000`)
    expect(display.headline).not.toBe(`${TAKA}0`)
    expect(display.detail).toBe("Paid in full")
    expect(display.detail).not.toMatch(/due/i)
    expect(display.showBar).toBe(false)
  })

  it("leads with the credit on an overpaid invoice, not 'Paid in full'", () => {
    // An overpaid invoice is settled by the ledger, but the credit still needs
    // refunding, so it must not be reported as merely paid.
    const display = settlementDisplay(2000, 2500)
    expect(display.headline).toBe(`${TAKA}500`)
    expect(display.detail).toBe(`overpaid on ${TAKA}2,000`)
    expect(display.detail).not.toMatch(/paid in full/i)
  })

  it("shows what remains on a part paid invoice, with no 'due' on the total", () => {
    const display = settlementDisplay(2000, 800)
    expect(display.headline).toBe(`${TAKA}1,200`)
    expect(display.detail).toBe(`of ${TAKA}2,000 · ${TAKA}800 received`)
    expect(display.detail).not.toMatch(/due/i)
    // A ratio is only meaningful while money is still outstanding.
    expect(display.showBar).toBe(true)
  })

  it("treats a missing paid amount as nothing received", () => {
    expect(settlementDisplay(2000, null)).toEqual(settlementDisplay(2000, 0))
    expect(settlementDisplay(2000, undefined)).toEqual(settlementDisplay(2000, 0))
  })

  it("never contradicts itself in any state", () => {
    for (const paid of [0, 500, 2000, 2500]) {
      const display = settlementDisplay(2000, paid)
      // A single supporting line, and no zero headline dressed up as a figure.
      expect(display.detail.length).toBeGreaterThan(0)
      expect(display.headline).not.toBe(`${TAKA}0`)
    }
  })
})
