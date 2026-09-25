import { describe, expect, it } from "vitest"
import { calculateTotals, invoiceDraftSaveSchema, invoiceDraftSchema } from "../../lib/invoice/validation"

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
