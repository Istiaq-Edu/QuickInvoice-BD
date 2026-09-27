// The invoice history sort contract, in one place.
//
// This list is the API's allow-list: a value outside it is rejected with 400
// before any query runs. When the picker and this list drifted apart, choosing a
// sort from the UI produced an error the seller could do nothing about, so the
// options, the type and the allow-list now all derive from the same array.

export const INVOICE_SORT_VALUES = [
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
] as const

export type InvoiceSort = (typeof INVOICE_SORT_VALUES)[number]

const allowed = new Set<string>(INVOICE_SORT_VALUES)

export function isInvoiceSort(value: string): value is InvoiceSort {
  return allowed.has(value)
}
