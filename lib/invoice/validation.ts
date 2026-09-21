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

export const invoiceDraftSchema = z.object({
  sellerCompanyName: z.string().trim().min(1, "Seller company name is required").max(500),
  sellerName: z.string().trim().min(1, "Seller name is required").max(500),
  sellerEmail: z.string().trim().email().optional().or(z.literal("")),
  sellerPhone: z.string().trim().max(100).optional().default(""),
  sellerAddress: z.string().trim().max(2_000).optional().default(""),
  buyerCompanyName: z.string().trim().min(1, "Buyer company name is required").max(500),
  buyerName: z.string().trim().min(1, "Buyer name is required").max(500),
  buyerEmail: z.string().trim().email().optional().or(z.literal("")),
  buyerPhone: z.string().trim().max(100).optional().default(""),
  buyerWebsite: z.string().trim().url().optional().or(z.literal("")),
  buyerAddress: z.string().trim().max(2_000).optional().default(""),
  issueDate: z.string().date(),
  dueDate: z.string().date(),
  discountType: z.enum(["none", "fixed", "percentage"]),
  discountValue: integerAmount,
  paymentStatus: z.enum(["unpaid", "paid", "overdue"]),
  notes: optionalText,
  paymentTerms: optionalText,
  lines: z.array(invoiceLineSchema).min(1),
}).superRefine((invoice, context) => {
  if (invoice.discountType === "percentage" && invoice.discountValue > 100) {
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
