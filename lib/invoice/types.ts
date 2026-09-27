export type DiscountType = "none" | "fixed" | "percentage"
export type PaymentStatus = "unpaid" | "partial" | "paid" | "overdue"
export type PaymentMethod = "cash" | "bank" | "mobile" | "card" | "other"
export type InvoiceLifecycle = "draft" | "finalized" | "trashed"

export type TemplateSettings = {
  accent: "slate" | "blue" | "emerald" | "indigo"
  showAddresses: boolean
  showSellerContact: boolean
  showBuyerContact: boolean
  showNotes: boolean
  showQuantityColumn: boolean
  // Stamped across a settled invoice document, so a downloaded PDF is proof of
  // payment rather than just an unpaid-looking bill.
  showPaidStamp: boolean
}

// A raised invoice that settles the remainder of an earlier one. The figures are
// snapshotted when the invoice is raised, so the document keeps showing what was
// true at that moment even if the original is later settled or revised.
export type CarriedForward = {
  amount: number
  invoiceId: string
  invoiceNumber: string | null
  originalTotal: number
  received: number
}

export type InvoiceLine = {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  discountType?: DiscountType
  discountValue?: number
}

export type InvoiceDraft = {
  sellerCompanyName: string
  sellerName: string
  sellerEmail?: string
  sellerPhone?: string
  sellerAddress?: string
  buyerCompanyName: string
  buyerName: string
  buyerEmail?: string
  buyerPhone?: string
  buyerWebsite?: string
  buyerAddress?: string
  issueDate: string
  dueDate: string
  discountType: DiscountType
  discountValue: number
  paymentStatus: PaymentStatus
  templateSettings?: TemplateSettings
  logoAssetId?: string | null
  notes?: string
  paymentTerms?: string
  // Present only on an invoice raised to settle the balance of an earlier one.
  carriedForward?: CarriedForward
  lines: InvoiceLine[]
}

export type InvoiceTotals = {
  subtotal: number
  discountAmount: number
  total: number
}

// The "Bill to" block has one heading and, at most, one secondary line.
//
// A company name is optional, because an invoice is often billed to a person
// rather than a business. When it is present it is the heading and the buyer
// name sits beneath it. When it is absent the buyer name becomes the heading and
// the secondary line is dropped, so the same text is never printed twice.
export type BillToParty = {
  companyName?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
}

export type BillToBlock = {
  heading: string
  contact: string
}

// Settlement state for an invoice, derived from the recorded payments.
//
// An invoice can be paid in instalments, so "how much is still owed" is a
// computed value rather than a stored one. Three outcomes matter to the user:
// nothing received, part received, and settled. Overpayment is a fourth case and
// is reported honestly as a credit rather than clamped to zero, because real
// money arrived that has to be refunded or carried forward.
export type Settlement = {
  total: number
  paid: number
  balance: number
  overpaidBy: number
  percentPaid: number
  isSettled: boolean
  isPartiallyPaid: boolean
  isOverpaid: boolean
}

export function calculateSettlement(total: number, amountPaid: number | null | undefined): Settlement {
  const totalAmount = Math.max(0, Number(total) || 0)
  // A negative paid value cannot reach here through the API, but a legacy row
  // must not be able to render as a negative percentage.
  const paid = Math.max(0, Number(amountPaid) || 0)
  const balance = totalAmount - paid

  return {
    total: totalAmount,
    paid,
    balance,
    overpaidBy: balance < 0 ? -balance : 0,
    percentPaid: totalAmount > 0 ? Math.min(100, Math.round((paid / totalAmount) * 100)) : paid > 0 ? 100 : 0,
    // A fully discounted invoice totals 0 and is settled by definition. Without
    // this it would report as outstanding forever, and "Record payment" and
    // "Mark paid" would be offered for an invoice that can never be paid.
    isSettled: balance <= 0,
    isPartiallyPaid: paid > 0 && balance > 0,
    isOverpaid: balance < 0,
  }
}

// Parses a payment amount typed into the dialog.
//
// Number("") is 0, not an absent value, so an empty field would otherwise look
// like a zero payment: the live hint would claim the invoice was settled and the
// submit guard would report a vague "greater than zero" error. Only a positive
// whole number of currency units is accepted, matching the Zod schema on the
// server and the bigint column in Postgres.
export function parsePaymentAmount(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // A decimal is rejected rather than rounded, because silently altering an
  // amount someone is about to record as money received is not acceptable.
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value <= 0) return null
  return value
}

// The live consequence of the amount currently typed, used to explain the effect
// of saving rather than leaving the seller to work it out after the fact.
export type PaymentHint =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "settles" }
  | { kind: "outstanding"; remaining: number }
  | { kind: "overpay"; excess: number }

export function describePaymentAmount(input: string, balance: number): PaymentHint {
  if (!input.trim()) return { kind: "empty" }

  const amount = parsePaymentAmount(input)
  if (amount === null) return { kind: "invalid" }
  if (balance > 0 && amount > balance) return { kind: "overpay", excess: amount - balance }
  const remaining = balance - amount
  if (remaining > 0) return { kind: "outstanding", remaining }
  return { kind: "settles" }
}

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  bank: "Bank transfer",
  card: "Card",
  cash: "Cash",
  mobile: "Mobile wallet",
  other: "Other",
}

// One formatter for every money surface, so the same amount never renders two
// ways on two pages. The taka sign is part of the format rather than a separate
// branch, and negatives are rendered explicitly because an overpaid invoice has
// a real negative balance that must not be clamped away.
export function formatMoney(value: number | null | undefined) {
  const amount = Math.round(Number(value) || 0)
  return `${amount < 0 ? "-" : ""}৳${new Intl.NumberFormat("en-US").format(Math.abs(amount))}`
}

export type SettlementDisplay = {
  /** The single supporting line beneath the figure. */
  detail: string
  /** The number a seller acts on, or null when the cell should say nothing. */
  headline: string
  /** A progress bar adds nothing once the Status column already says "Paid". */
  showBar: boolean
}

// The wording of the Balance cell, kept out of the component so it can be tested
// without a DOM.
//
// This exists because the cell used to contradict the Status column beside it: a
// fully paid invoice rendered "৳0" over "of ৳2,000 due", so a row marked Paid also
// claimed money was outstanding. Each state below therefore states one fact, and
// no state describes an amount as "due" once it has been received.
export function settlementDisplay(total: number, amountPaid?: number | null): SettlementDisplay {
  const settlement = calculateSettlement(total, amountPaid)

  // Nothing received: the total is the whole story.
  if (settlement.paid === 0) {
    return { detail: "Outstanding", headline: formatMoney(settlement.total), showBar: false }
  }
  // Overpaid is checked before settled, because an overpaid invoice is settled as
  // far as the ledger is concerned (its balance is negative) yet still holds a
  // credit the seller must refund or re-apply. Treating it as merely "paid" would
  // hide the one figure that still needs action.
  if (settlement.isOverpaid) {
    return { detail: `overpaid on ${formatMoney(settlement.total)}`, headline: formatMoney(settlement.overpaidBy), showBar: false }
  }
  // Settled: report the total, not a zero balance the seller cannot act on.
  if (settlement.isSettled) {
    return { detail: "Paid in full", headline: formatMoney(settlement.total), showBar: false }
  }
  // Part paid: what remains, with the total and the received amount as context.
  return {
    detail: `of ${formatMoney(settlement.total)} · ${formatMoney(settlement.paid)} received`,
    headline: formatMoney(settlement.balance),
    showBar: true,
  }
}

export function resolveBillToParty(
  party: BillToParty,
  fallbacks: { heading: string; contact: string } = { heading: "Buyer name", contact: "Company name" },
): BillToBlock {
  const company = (party.companyName ?? "").trim()
  const name = (party.name ?? "").trim()

  // Identical values are a data-entry artefact, and printing the same string
  // twice in the block looks like a rendering bug, so the heading stands alone.
  if (company && company !== name) return { heading: company, contact: name }
  if (name) return { heading: name, contact: "" }
  if (company) return { heading: company, contact: "" }
  return { heading: fallbacks.heading, contact: fallbacks.contact }
}
