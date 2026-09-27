import { describe, expect, it } from "vitest"
import { calculateTotals, invoiceDraftSaveSchema, invoiceDraftSchema } from "../../lib/invoice/validation"
import { resolveBillToParty, calculateSettlement, parsePaymentAmount, describePaymentAmount, formatMoney } from "../../lib/invoice/types"

const validInvoice = {
  sellerCompanyName: "Seller Co",
  sellerName: "Seller",
  sellerEmail: "seller@example.com",
  sellerPhone: "01700000000",
  sellerAddress: "Dhaka",
  buyerCompanyName: "Buyer Co",
  buyerName: "Buyer",
  buyerEmail: "buyer@example.com",
  buyerPhone: "01800000000",
  buyerWebsite: "https://buyer.example.com",
  buyerAddress: "Chattogram",
  issueDate: "2026-09-21",
  dueDate: "2026-09-28",
  discountType: "none" as const,
  discountValue: 0,
  paymentStatus: "unpaid" as const,
  lines: [{ description: "Consulting", quantity: 2, unitPrice: 1250 }],
}

describe("calculateTotals", () => {
  it("calculates a multi-line subtotal with no discount", () => {
    expect(calculateTotals({
      discountType: "none",
      discountValue: 0,
      lines: [
        { description: "Design", quantity: 2, unitPrice: 1250 },
        { description: "Review", quantity: 1, unitPrice: 500 },
      ],
    })).toEqual({ subtotal: 3000, discountAmount: 0, total: 3000 })
  })

  it("caps a fixed discount at each line original amount", () => {
    expect(calculateTotals({
      discountType: "none",
      discountValue: 0,
      lines: [{ description: "Service", quantity: 1, unitPrice: 1500, discountType: "fixed", discountValue: 2000 }],
    })).toEqual({ subtotal: 1500, discountAmount: 1500, total: 0 })
  })

  it("calculates different fixed and percentage discounts across multiple lines", () => {
    expect(calculateTotals({
      discountType: "none",
      discountValue: 0,
      lines: [
        { description: "Design", quantity: 2, unitPrice: 1250, discountType: "fixed", discountValue: 100 },
        { description: "Review", quantity: 1, unitPrice: 500, discountType: "percentage", discountValue: 10 },
      ],
    })).toEqual({ subtotal: 3000, discountAmount: 150, total: 2850 })
  })

  it("rounds percentage line discounts and caps them at 100 percent", () => {
    expect(calculateTotals({
      discountType: "none",
      discountValue: 0,
      lines: [{ description: "Service", quantity: 1, unitPrice: 125, discountType: "percentage", discountValue: 2 }],
    })).toEqual({ subtotal: 125, discountAmount: 3, total: 122 })

    expect(calculateTotals({
      discountType: "none",
      discountValue: 0,
      lines: [{ description: "Service", quantity: 1, unitPrice: 125, discountType: "percentage", discountValue: 150 }],
    })).toEqual({ subtotal: 125, discountAmount: 125, total: 0 })
  })

  it("keeps the legacy invoice-level discount fallback when lines have no discounts", () => {
    expect(calculateTotals({
      discountType: "percentage",
      discountValue: 10,
      lines: [{ description: "Legacy service", quantity: 2, unitPrice: 1000 }],
    })).toEqual({ subtotal: 2000, discountAmount: 200, total: 1800 })
  })
})

describe("invoice schemas", () => {
  it("accepts a complete invoice and trims text fields", () => {
    const result = invoiceDraftSchema.parse({
      ...validInvoice,
      sellerCompanyName: "  Seller Co  ",
      lines: [{ description: "  Consulting  ", quantity: 2, unitPrice: 1250 }],
    })

    expect(result.sellerCompanyName).toBe("Seller Co")
    expect(result.lines[0].description).toBe("Consulting")
    expect(result.lines[0].discountType).toBe("none")
    expect(result.lines[0].discountValue).toBe(0)
  })

  it("rejects incomplete final invoices and invalid line discounts", () => {
    const incomplete = invoiceDraftSchema.safeParse({
      ...validInvoice,
      buyerPhone: "",
      lines: [{ description: "", quantity: 0, unitPrice: -1 }],
    })
    const invalidDiscount = invoiceDraftSchema.safeParse({
      ...validInvoice,
      lines: [{ description: "Service", quantity: 1, unitPrice: 100, discountType: "percentage", discountValue: 101 }],
    })

    expect(incomplete.success).toBe(false)
    expect(invalidDiscount.success).toBe(false)
    if (!invalidDiscount.success) {
      expect(invalidDiscount.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["lines", 0, "discountValue"] }),
      ]))
    }
  })

  it("treats the buyer company as optional but keeps the buyer name required", () => {
    const individual = invoiceDraftSchema.safeParse({ ...validInvoice, buyerCompanyName: "" })
    const whitespace = invoiceDraftSchema.safeParse({ ...validInvoice, buyerCompanyName: "   " })
    const missingName = invoiceDraftSchema.safeParse({ ...validInvoice, buyerCompanyName: "", buyerName: "" })

    expect(individual.success).toBe(true)
    expect(whitespace.success).toBe(true)
    if (individual.success) expect(individual.data.buyerCompanyName).toBe("")

    // An invoice is always addressed to someone, so the name is still required.
    expect(missingName.success).toBe(false)
    if (!missingName.success) {
      expect(missingName.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["buyerName"] }),
      ]))
    }
  })

  it("defaults a missing buyer company to an empty string", () => {
    const withoutCompany = { ...validInvoice, buyerCompanyName: undefined }
    const result = invoiceDraftSchema.parse(withoutCompany)

    expect(result.buyerCompanyName).toBe("")
  })

  it("still requires the seller company name", () => {
    expect(invoiceDraftSchema.safeParse({ ...validInvoice, sellerCompanyName: "" }).success).toBe(false)
  })

  it("allows blank editable fields in an autosave draft", () => {
    const result = invoiceDraftSaveSchema.parse({
      ...validInvoice,
      sellerCompanyName: "",
      sellerName: "",
      buyerCompanyName: "",
      buyerName: "",
      buyerPhone: "01800000000",
      lines: [{ description: "", quantity: "", unitPrice: "", discountType: "none", discountValue: "" }],
    })

    expect(result.lines).toEqual([{ description: "", quantity: "", unitPrice: "", discountType: "none", discountValue: "" }])
  })

  it("defaults the quantity column and line discounts for legacy payloads", () => {
    const result = invoiceDraftSchema.parse({
      ...validInvoice,
      templateSettings: {
        accent: "slate",
        showAddresses: true,
        showSellerContact: true,
        showBuyerContact: true,
        showNotes: true,
      },
    })

    expect(result.templateSettings?.showQuantityColumn).toBe(true)
    expect(result.lines[0].discountType).toBe("none")
    expect(result.lines[0].discountValue).toBe(0)
  })
})

describe("resolveBillToParty", () => {
  it("uses the company as the heading and keeps the contact beneath it", () => {
    expect(resolveBillToParty({ companyName: "Acme Ltd", name: "Rahim Uddin" })).toEqual({
      heading: "Acme Ltd",
      contact: "Rahim Uddin",
    })
  })

  it("promotes the buyer name to the heading when no company is given", () => {
    expect(resolveBillToParty({ companyName: "", name: "Rahim Uddin" })).toEqual({
      heading: "Rahim Uddin",
      contact: "",
    })
  })

  it("treats a whitespace-only company as absent", () => {
    expect(resolveBillToParty({ companyName: "   ", name: "Rahim Uddin" }).heading).toBe("Rahim Uddin")
  })

  it("never prints the same text as both the heading and the contact", () => {
    const { heading, contact } = resolveBillToParty({ companyName: "Acme Ltd", name: "Acme Ltd" })
    // Same value in both fields is a user data-entry artefact, not a layout rule.
    expect(heading === contact).toBe(false)
  })

  it("falls back to placeholders only when both are empty", () => {
    expect(resolveBillToParty({ companyName: "", name: "" })).toEqual({
      heading: "Buyer name",
      contact: "Company name",
    })
  })

  it("supports a single-line fallback for compact surfaces", () => {
    expect(resolveBillToParty({ companyName: "", name: "" }, { heading: "Customer name", contact: "" })).toEqual({
      heading: "Customer name",
      contact: "",
    })
  })

  it("tolerates a null snapshot from a legacy row", () => {
    expect(resolveBillToParty({ companyName: null, name: null }).heading).toBe("Buyer name")
  })
})

describe("calculateSettlement", () => {
  it("reports an untouched invoice as fully outstanding", () => {
    const settlement = calculateSettlement(10_000, 0)

    expect(settlement).toMatchObject({ balance: 10_000, paid: 0, isSettled: false, isPartiallyPaid: false, isOverpaid: false })
    expect(settlement.percentPaid).toBe(0)
  })

  it("treats a missing amount_paid as nothing received", () => {
    // Legacy rows predate the column, so a null must not read as settled.
    expect(calculateSettlement(10_000, null)).toMatchObject({ paid: 0, balance: 10_000, isSettled: false })
    expect(calculateSettlement(10_000, undefined)).toMatchObject({ paid: 0, balance: 10_000, isSettled: false })
  })

  it("splits a part payment into paid and balance", () => {
    // The reported case: billed 10000, received 8000.
    const settlement = calculateSettlement(10_000, 8_000)

    expect(settlement).toMatchObject({ total: 10_000, paid: 8_000, balance: 2_000, percentPaid: 80, isSettled: false, isPartiallyPaid: true, isOverpaid: false })
  })

  it("settles when the payment exactly matches the total", () => {
    expect(calculateSettlement(10_000, 10_000)).toMatchObject({ balance: 0, percentPaid: 100, isSettled: true, isPartiallyPaid: false, isOverpaid: false })
  })

  it("reports overpayment as a credit rather than clamping to zero", () => {
    // Refusing to represent this would hide money that genuinely arrived.
    const settlement = calculateSettlement(10_000, 12_000)

    expect(settlement).toMatchObject({ paid: 12_000, balance: -2_000, overpaidBy: 2_000, isSettled: true, isOverpaid: true })
    expect(settlement.percentPaid).toBe(100)
  })

  it("never reports a negative percentage from a corrupt stored value", () => {
    expect(calculateSettlement(10_000, -500).percentPaid).toBe(0)
    expect(calculateSettlement(10_000, -500).paid).toBe(0)
  })

  it("handles a zero-total invoice without dividing by zero", () => {
    const settlement = calculateSettlement(0, 0)

    expect(settlement.percentPaid).toBe(0)
    // A fully discounted invoice has nothing left to pay, so it is settled rather
    // than outstanding forever with "Record payment" offered for no reason.
    expect(settlement.isSettled).toBe(true)
  })

  it("rounds the percentage so the progress bar never overflows", () => {
    expect(calculateSettlement(3, 1).percentPaid).toBe(33)
    expect(calculateSettlement(3, 2).percentPaid).toBe(67)
  })

describe("parsePaymentAmount", () => {
  it("accepts a positive whole number", () => {
    expect(parsePaymentAmount("8000")).toBe(8000)
    expect(parsePaymentAmount("  8000  ")).toBe(8000)
    expect(parsePaymentAmount("1")).toBe(1)
  })

  it("rejects an empty field instead of reading it as zero", () => {
    // Number("") is 0, which previously made a cleared field look like a zero
    // payment and told the seller the invoice was settled.
    expect(parsePaymentAmount("")).toBeNull()
    expect(parsePaymentAmount("   ")).toBeNull()
    expect(Number("")).toBe(0)
  })

  it("rejects zero, negatives and decimals rather than coercing them", () => {
    expect(parsePaymentAmount("0")).toBeNull()
    expect(parsePaymentAmount("-500")).toBeNull()
    expect(parsePaymentAmount("12.50")).toBeNull()
    expect(parsePaymentAmount("abc")).toBeNull()
    expect(parsePaymentAmount("1e5")).toBeNull()
  })
})

describe("describePaymentAmount", () => {
  it("distinguishes empty from invalid input", () => {
    expect(describePaymentAmount("", 5000)).toEqual({ kind: "empty" })
    expect(describePaymentAmount("abc", 5000)).toEqual({ kind: "invalid" })
    expect(describePaymentAmount("0", 5000)).toEqual({ kind: "invalid" })
  })

  it("explains the outcome of the typed amount", () => {
    expect(describePaymentAmount("5000", 5000)).toEqual({ kind: "settles" })
    expect(describePaymentAmount("2000", 5000)).toEqual({ kind: "outstanding", remaining: 3000 })
    expect(describePaymentAmount("6000", 5000)).toEqual({ kind: "overpay", excess: 1000 })
  })

  it("treats the pre-filled balance as settling the invoice", () => {
    // The dialog opens with the outstanding balance, so the default hint has to
    // read as the reassuring one rather than as an error.
    expect(describePaymentAmount("2000", 2000)).toEqual({ kind: "settles" })
  })

  it("does not warn about overpayment when nothing is owed", () => {
    expect(describePaymentAmount("500", 0)).toEqual({ kind: "settles" })
  })
})

describe("formatMoney", () => {
  it("formats whole amounts with the taka sign", () => {
    expect(formatMoney(10_000)).toBe("৳10,000")
    expect(formatMoney(0)).toBe("৳0")
  })

  it("renders a negative balance as a real credit rather than clamping to zero", () => {
    // An overpaid invoice has money owed back; hiding the sign would misreport it.
    expect(formatMoney(-2_000)).toBe("-৳2,000")
  })

  it("rounds and tolerates missing values", () => {
    expect(formatMoney(1_256.4)).toBe("৳1,256")
    expect(formatMoney(null)).toBe("৳0")
    expect(formatMoney(undefined)).toBe("৳0")
  })
})

})
