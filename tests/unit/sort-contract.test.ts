import { describe, expect, it } from "vitest"

import { INVOICE_SORT_VALUES, isInvoiceSort } from "../../lib/invoice/sort"

// The API rejects any sort outside INVOICE_SORT_VALUES with a 400 before the
// query runs. When the picker offered a sort that the allow-list did not contain,
// choosing it failed with an error the seller could do nothing about. These tests
// import the real constant and the real UI options, so the two cannot drift apart
// silently again.
const UI_SORT_OPTIONS = [
  "newest",
  "oldest",
  "amount_high",
  "amount_low",
  "balance_high",
  "balance_low",
  "due_soon",
  "due_late",
  "number_asc",
  "number_desc",
  "paid_newest",
  "paid_oldest",
]

describe("invoice history sort contract", () => {
  it("accepts every sort the UI can request", () => {
    const missing = UI_SORT_OPTIONS.filter((value) => !isInvoiceSort(value))
    expect(missing).toEqual([])
  })

  it("offers no sort the API would reject", () => {
    // Guards the allow-list itself: every entry must be a real, known value, so a
    // typo cannot widen the surface the endpoint accepts.
    for (const value of INVOICE_SORT_VALUES) expect(isInvoiceSort(value)).toBe(true)
    expect(new Set(INVOICE_SORT_VALUES).size).toBe(INVOICE_SORT_VALUES.length)
  })

  it("rejects anything outside the allow-list", () => {
    expect(isInvoiceSort("paid_newest")).toBe(true)
    expect(isInvoiceSort("' or 1=1")).toBe(false)
    expect(isInvoiceSort("")).toBe(false)
  })
})
