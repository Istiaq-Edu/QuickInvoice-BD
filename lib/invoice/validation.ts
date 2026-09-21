import { z } from "zod"
import type { InvoiceDraft, InvoiceTotals } from "./types"

const integerAmount = z.number().int().nonnegative()
const optionalText = z.string().trim().max(10_000).optional().default("")

export const invoiceLineSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, "Description is required").max(2_000),
  quantity: z.number().int().min(1),
  unitPrice: integerAmount,
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
  buyerPhone: z.string().trim().max(100).default(""),
  buyerWebsite: z.string().trim().url().or(z.literal("")).default(""),
  buyerAddress: z.string().trim().max(2_000).default(""),
  issueDate: z.string().date(),
  dueDate: z.string().date(),
  discountType: z.enum(["none", "fixed", "percentage"]),
  paymentStatus: z.enum(["unpaid", "paid", "overdue"]),
  notes: optionalText,
  paymentTerms: optionalText,
}

const invoiceDraftLineSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().max(2_000).default(""),
  quantity: z.union([z.literal(""), z.number().int().min(1)]),
  unitPrice: z.union([z.literal(""), integerAmount]),
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

export function calculateTotals(invoice: Pick<InvoiceDraft, "discountType" | "discountValue" | "lines">): InvoiceTotals {
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const discountAmount = invoice.discountType === "fixed"
    ? Math.min(subtotal, invoice.discountValue)
    : invoice.discountType === "percentage"
      ? Math.round((subtotal * Math.min(100, invoice.discountValue)) / 100)
      : 0

  return { subtotal, discountAmount, total: Math.max(0, subtotal - discountAmount) }
}
