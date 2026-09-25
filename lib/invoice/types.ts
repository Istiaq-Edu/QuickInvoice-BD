export type DiscountType = "none" | "fixed" | "percentage"
export type PaymentStatus = "unpaid" | "paid" | "overdue"
export type InvoiceLifecycle = "draft" | "finalized" | "trashed"

export type TemplateSettings = {
  accent: "slate" | "blue" | "emerald" | "indigo"
  showAddresses: boolean
  showSellerContact: boolean
  showBuyerContact: boolean
  showNotes: boolean
  showQuantityColumn: boolean
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
  lines: InvoiceLine[]
}

export type InvoiceTotals = {
  subtotal: number
  discountAmount: number
  total: number
}
