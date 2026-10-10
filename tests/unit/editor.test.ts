import { describe, expect, it } from "vitest"

import { addDaysIso, diffDays, formatDate, formatDateLong, getLineAmounts, newLine, type LineItem } from "../../lib/invoice/editor"

// These helpers moved out of app/page.tsx into lib/invoice/editor.ts. The move
// was meant to be behaviour-preserving, so these tests pin the behaviour that was
// previously only exercised through the page: they are the safety net for the
// extraction, and they cover the edges the page happened not to hit.

describe("addDaysIso", () => {
  it("adds whole days", () => {
    expect(addDaysIso("2026-09-27", 14)).toBe("2026-10-11")
  })

  it("crosses a month and a year boundary", () => {
    expect(addDaysIso("2026-12-25", 14)).toBe("2027-01-08")
  })

  it("handles a leap day", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29")
  })

  it("returns an empty string for malformed input", () => {
    expect(addDaysIso("", 14)).toBe("")
    expect(addDaysIso("not-a-date", 14)).toBe("")
  })
})

describe("formatDateLong", () => {
  it("formats an ISO date", () => {
    expect(formatDateLong("2026-09-27")).toBe("27 Sep 2026")
  })

  it("returns empty for blank or malformed input", () => {
    expect(formatDateLong("")).toBe("")
    expect(formatDateLong("2026-13-01")).toBe("")
    expect(formatDateLong("2026-00-10")).toBe("")
  })
})

describe("formatDate", () => {
  it("formats as day/month/year", () => {
    expect(formatDate("2026-09-27")).toBe("27/09/2026")
  })

  it("uses an em dash when empty", () => {
    expect(formatDate("")).toBe("—")
  })
})

describe("diffDays", () => {
  it("counts whole days forward", () => {
    expect(diffDays("2026-09-27", "2026-10-11")).toBe(14)
  })

  it("is negative when the second date is earlier", () => {
    expect(diffDays("2026-10-11", "2026-09-27")).toBe(-14)
  })

  it("Returns null for unparseable input", () => {
    expect(diffDays("", "2026-10-11")).toBeNull()
  })
})

describe("newLine", () => {
  it("starts blank, not pre-priced", () => {
    expect(newLine(3)).toEqual({ id: 3, description: "", quantity: "", unitPrice: "", discountType: "none", discountValue: "" })
  })
})

describe("getLineAmounts", () => {
  const base: LineItem = { id: 1, description: "x", quantity: 2, unitPrice: 100, discountType: "none", discountValue: "" }

  it("computes gross with no discount", () => {
    expect(getLineAmounts(base)).toEqual({ originalAmount: 200, discountAmount: 0, amount: 200 })
  })

  it("clamps a fixed discount to the line total", () => {
    expect(getLineAmounts({ ...base, discountType: "fixed", discountValue: 500 }).amount).toBe(0)
    expect(getLineAmounts({ ...base, discountType: "fixed", discountValue: 500 }).discountAmount).toBe(200)
  })

  it("rounds a percentage discount", () => {
    // 200 * 33% = 66
    expect(getLineAmounts({ ...base, discountType: "percentage", discountValue: 33 }).discountAmount).toBe(66)
  })

  it("caps a percentage discount at 100%", () => {
    expect(getLineAmounts({ ...base, discountType: "percentage", discountValue: 150 }).amount).toBe(0)
  })

  it("treats blank quantity or price as zero", () => {
    expect(getLineAmounts({ ...base, quantity: "", unitPrice: "" }).originalAmount).toBe(0)
  })
})
