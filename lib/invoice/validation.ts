import { z } from "zod"
import type { InvoiceDraft, InvoiceTotals } from "./types"

const integerAmount = z.number().int().nonnegative()
const optionalText = z.string().trim().max(10_000).optional().default("")
export const templateSettingsSchema = z.object({
  accent: z.enum(["slate", "blue", "emerald", "indigo"]),
  showAddresses: z.boolean(),
  showSellerContact: z.boolean(),
  showBuyerContact: z.boolean(),
  showNotes: z.boolean(),
  showQuantityColumn: z.boolean().default(true),
})

export const invoiceLineSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, "Description is required").max(2_000),
  quantity: z.number().int().min(1),
  unitPrice: integerAmount,
  discountType: z.enum(["none", "fixed", "percentage"]).default("none"),
  discountValue: integerAmount.default(0),
}).superRefine((line, context) => {
  if (line.discountType === "percentage" && line.discountValue > 100) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Line discount cannot exceed 100%." })
  }
  if (line.discountType === "fixed" && line.discountValue > line.quantity * line.unitPrice) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Line discount cannot exceed the original amount." })
  }
})

const invoiceCommonFields = {
  sellerCompanyName: z.string().trim().max(500).default(""),
  sellerName: z.string().trim().max(500).default(""),
  sellerEmail: z.string().trim().email().or(z.literal("")).default(""),
  sellerPhone: z.string().trim().max(100).default(""),
  sellerAddress: z.string().trim().max(2_000).default(""),
  buyerCompanyName: z.string().trim().max(500).default(""),
  buyerName: z.string().trim().max(500).default(""),
  buyerEmail: z.string().trim().email().or(z.literal("")).default(""),
  buyerPhone: z.string().trim().min(1, "Buyer phone is required").max(100),
  buyerWebsite: z.string().trim().url().or(z.literal("")).default(""),
  buyerAddress: z.string().trim().max(2_000).default(""),
  issueDate: z.string().date(),
  dueDate: z.string().date(),
  discountType: z.enum(["none", "fixed", "percentage"]),
  paymentStatus: z.enum(["unpaid", "paid", "overdue"]),
  templateSettings: templateSettingsSchema.optional(),
  logoAssetId: z.string().uuid().nullable().optional(),
  notes: optionalText,
  paymentTerms: optionalText,
}

const invoiceDraftLineSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().max(2_000).default(""),
  quantity: z.union([z.literal(""), z.number().int().min(1)]),
  unitPrice: z.union([z.literal(""), integerAmount]),
  discountType: z.enum(["none", "fixed", "percentage"]).default("none"),
  discountValue: z.union([z.literal(""), integerAmount]).default(0),
}).superRefine((line, context) => {
  if (line.discountType === "percentage" && typeof line.discountValue === "number" && line.discountValue > 100) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Line discount cannot exceed 100%." })
  }
  if (line.discountType === "fixed" && typeof line.discountValue === "number" && typeof line.quantity === "number" && typeof line.unitPrice === "number" && line.discountValue > line.quantity * line.unitPrice) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Line discount cannot exceed the original amount." })
  }
})

export const invoiceDraftSchema = z.object({
  ...invoiceCommonFields,
  sellerCompanyName: z.string().trim().min(1, "Seller company name is required").max(500),
  sellerName: z.string().trim().min(1, "Seller name is required").max(500),
  buyerCompanyName: z.string().trim().min(1, "Buyer company name is required").max(500),
  buyerName: z.string().trim().min(1, "Buyer name is required").max(500),
  discountValue: integerAmount,
  lines: z.array(invoiceLineSchema).min(1),
}).superRefine((invoice, context) => {
  if (invoice.discountType === "percentage" && invoice.discountValue > 100) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount cannot exceed 100%." })
  }
})

export const invoiceDraftSaveSchema = z.object({
  ...invoiceCommonFields,
  discountValue: z.union([z.literal(""), integerAmount]),
  lines: z.array(invoiceDraftLineSchema).min(1).max(200),
}).superRefine((invoice, context) => {
  if (invoice.discountType === "percentage" && typeof invoice.discountValue === "number" && invoice.discountValue > 100) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount cannot exceed 100%." })
  }
})

export function calculateLineTotals(line: Pick<InvoiceDraft["lines"][number], "quantity" | "unitPrice" | "discountType" | "discountValue">) {
  const originalAmount = line.quantity * line.unitPrice
  const discountType = line.discountType ?? "none"
  const discountValue = line.discountValue ?? 0
  const discountAmount = discountType === "fixed"
    ? Math.min(originalAmount, discountValue)
    : discountType === "percentage"
      ? Math.round((originalAmount * Math.min(100, discountValue)) / 100)
      : 0
  return { originalAmount, discountAmount, amount: Math.max(0, originalAmount - discountAmount) }
}

export function calculateTotals(invoice: Pick<InvoiceDraft, "discountType" | "discountValue" | "lines">): InvoiceTotals {
  const lineTotals = invoice.lines.map(calculateLineTotals)
  const subtotal = lineTotals.reduce((sum, line) => sum + line.originalAmount, 0)
  const hasLineDiscount = invoice.lines.some((line) => (line.discountType ?? "none") !== "none" || (line.discountValue ?? 0) > 0)
  const legacyDiscountAmount = invoice.discountType === "fixed"
    ? Math.min(subtotal, invoice.discountValue)
    : invoice.discountType === "percentage"
      ? Math.round((subtotal * Math.min(100, invoice.discountValue)) / 100)
      : 0
  const discountAmount = hasLineDiscount
    ? lineTotals.reduce((sum, line) => sum + line.discountAmount, 0)
    : legacyDiscountAmount

  return { subtotal, discountAmount, total: Math.max(0, subtotal - discountAmount) }
}
