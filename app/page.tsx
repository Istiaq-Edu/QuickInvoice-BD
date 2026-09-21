"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { FileDown, Plus, RotateCcw, Trash2, UserRound } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { SignOutButton } from "@/components/sign-out-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { exportPreviewAsDocx, exportPreviewAsPdf } from "@/lib/invoice/export"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type EditableNumber = number | ""
type LineItem = { id: number; description: string; quantity: EditableNumber; unitPrice: EditableNumber }
type DiscountType = "none" | "fixed" | "percentage"

const getDhakaDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Dhaka", year: "numeric" }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const formatMoney = (value: number) => `৳${new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))}`
const formatDate = (value: string) => {
  if (!value) return "—"
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}
const newLine = (id: number): LineItem => ({ id, description: "", quantity: 1, unitPrice: 0 })
const defaultTemplateSettings: TemplateSettings = { accent: "slate", showAddresses: true, showSellerContact: true, showBuyerContact: true, showNotes: true }
const accentStyles = {
  slate: { rule: "border-slate-950", heading: "text-slate-900", total: "border-slate-950" },
  blue: { rule: "border-blue-700", heading: "text-blue-800", total: "border-blue-700" },
  emerald: { rule: "border-emerald-700", heading: "text-emerald-800", total: "border-emerald-700" },
  indigo: { rule: "border-indigo-700", heading: "text-indigo-800", total: "border-indigo-700" },
} as const
type TemplateSettings = {
  accent: "slate" | "blue" | "emerald" | "indigo"
  showAddresses: boolean
  showSellerContact: boolean
  showBuyerContact: boolean
  showNotes: boolean
}
type SavedCustomer = {
  id: string
  companyName: string
  name: string
  address: string
  email: string
  phone: string
}
type PersistedDocument = {
  sellerCompanyName?: string
  sellerName?: string
  sellerEmail?: string
  sellerPhone?: string
  sellerAddress?: string
  buyerCompanyName?: string
  buyerName?: string
  buyerEmail?: string
  buyerPhone?: string
  buyerAddress?: string
  issueDate?: string
  dueDate?: string
  discountType?: DiscountType
  discountValue?: number
  paymentStatus?: "unpaid" | "paid" | "overdue"
  templateSettings?: TemplateSettings
  notes?: string
  lines?: Array<{ description?: string; quantity?: number; unitPrice?: number }>
}

export default function Home() {
  const router = useRouter()
  const previewRef = useRef<HTMLDivElement>(null)
  const nextLineId = useRef(2)
  const draftId = useRef<string | null>(null)
  const loadedDraftId = useRef<string | null>(null)
  const finalizedInvoiceLoaded = useRef(false)
  const draftVersion = useRef<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [savedCustomers, setSavedCustomers] = useState<SavedCustomer[]>([])
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [templateSettings, setTemplateSettings] = useState<TemplateSettings>(defaultTemplateSettings)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [requestedExport, setRequestedExport] = useState<"PDF" | "DOCX" | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [saveState, setSaveState] = useState("Guest mode")
  const [sellerCompanyName, setSellerCompanyName] = useState("")
  const [sellerName, setSellerName] = useState("")
  const [sellerEmail, setSellerEmail] = useState("")
  const [sellerPhone, setSellerPhone] = useState("")
  const [sellerAddress, setSellerAddress] = useState("")
  const [buyerCompanyName, setBuyerCompanyName] = useState("")
  const [buyerName, setBuyerName] = useState("")
  const [buyerEmail, setBuyerEmail] = useState("")
  const [buyerPhone, setBuyerPhone] = useState("")
  const [buyerAddress, setBuyerAddress] = useState("")
  const [issueDate, setIssueDate] = useState(getDhakaDate)
  const [dueDate, setDueDate] = useState(getDhakaDate)
  const [discountType, setDiscountType] = useState<DiscountType>("none")
  const [discountValue, setDiscountValue] = useState<EditableNumber>(0)
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "paid" | "overdue">("unpaid")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<LineItem[]>([newLine(1)])
  const [message, setMessage] = useState("")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) return

    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setAccountEmail(data.user?.email ?? null)
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAccountEmail(session?.user.email ?? null)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!accountEmail) return
    void fetch("/api/seller-logo").then(async (response) => {
      const result = await response.json() as { logo?: { url?: string | null } | null }
      if (response.ok && !finalizedInvoiceLoaded.current) setLogoUrl(result.logo?.url ?? null)
    }).catch(() => undefined)
  }, [accountEmail])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const draftQueryId = searchParams.get("draft")
    const downloadQuery = searchParams.get("download")
    const requestedDownload = downloadQuery === "PDF" || downloadQuery === "DOCX" ? downloadQuery : null
    if (requestedDownload) void Promise.resolve().then(() => setRequestedExport(requestedDownload))
    if (!draftQueryId || loadedDraftId.current === draftQueryId) return
    let active = true
    setLoadingDraft(true)
    setMessage("Loading draft…")

    void fetch(`/api/invoices/detail?id=${encodeURIComponent(draftQueryId)}`).then(async (response) => {
      const result = await response.json() as { id?: string; version?: number; lifecycleStatus?: "draft" | "finalized"; invoiceNumber?: string | null; logoUrl?: string | null; document?: PersistedDocument; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Draft could not be loaded.")
      if (!active || !result.document) return

      const document = result.document
      const sourceLines = Array.isArray(document.lines) ? document.lines : []
      setSellerCompanyName(document.sellerCompanyName ?? "")
      setSellerName(document.sellerName ?? "")
      setSellerEmail(document.sellerEmail ?? "")
      setSellerPhone(document.sellerPhone ?? "")
      setSellerAddress(document.sellerAddress ?? "")
      setBuyerCompanyName(document.buyerCompanyName ?? "")
      setBuyerName(document.buyerName ?? "")
      setBuyerEmail(document.buyerEmail ?? "")
      setBuyerPhone(document.buyerPhone ?? "")
      setBuyerAddress(document.buyerAddress ?? "")
      setIssueDate(document.issueDate ?? getDhakaDate())
      setDueDate(document.dueDate ?? getDhakaDate())
      setDiscountType(document.discountType ?? "none")
      setDiscountValue(typeof document.discountValue === "number" ? document.discountValue : 0)
      setPaymentStatus(document.paymentStatus ?? "unpaid")
      if (document.templateSettings) {
        setTemplateSettings(document.templateSettings)
        setTemplateLoaded(true)
      }
      setNotes(document.notes ?? "")
      setLines(sourceLines.length > 0 ? sourceLines.map((line, index) => ({
        id: index + 1,
        description: line.description ?? "",
        quantity: typeof line.quantity === "number" ? line.quantity : 1,
        unitPrice: typeof line.unitPrice === "number" ? line.unitPrice : 0,
      })) : [newLine(1)])
      nextLineId.current = sourceLines.length + 1
      draftId.current = result.id ?? draftQueryId
      draftVersion.current = result.version ?? 1
      loadedDraftId.current = draftQueryId
      finalizedInvoiceLoaded.current = result.lifecycleStatus === "finalized"
      if (result.lifecycleStatus === "finalized") setLogoUrl(result.logoUrl ?? null)
      setInvoiceNumber(result.lifecycleStatus === "finalized" ? result.invoiceNumber ?? null : null)
      setMessage(result.lifecycleStatus === "finalized" ? "Finalized invoice loaded. Changes save to the same invoice number." : "Draft loaded.")
    }).catch((loadError: unknown) => {
      if (active) setMessage(loadError instanceof Error ? loadError.message : "Draft could not be loaded.")
    }).finally(() => {
      if (active) setLoadingDraft(false)
    })

    return () => {
      active = false
    }
  }, [])

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0), 0), [lines])
  const discount = useMemo(() => {
    const numericDiscount = Number(discountValue) || 0
    if (discountType === "fixed") return Math.min(subtotal, Math.max(0, numericDiscount))
    if (discountType === "percentage") return Math.round((subtotal * Math.min(100, Math.max(0, numericDiscount))) / 100)
    return 0
  }, [discountType, discountValue, subtotal])
  const total = Math.max(0, subtotal - discount)
  const accentStyle = accentStyles[templateSettings.accent]
  const incomplete = !sellerCompanyName.trim() || !sellerName.trim() || !buyerCompanyName.trim() || !buyerName.trim() || !buyerPhone.trim() || lines.length === 0 || lines.some((line) => !line.description.trim() || line.quantity === "" || Number(line.quantity) < 1 || line.unitPrice === "" || Number(line.unitPrice) < 0)

  useEffect(() => {
    if (!accountEmail || loadingDraft || !issueDate || !dueDate) return
    let active = true

    const timeout = window.setTimeout(async () => {
      setSaveState("Saving…")
      const invoice = {
        sellerCompanyName,
        sellerName,
        sellerEmail,
        sellerPhone,
        sellerAddress,
        buyerCompanyName,
        buyerName,
        buyerEmail,
        buyerPhone,
        buyerAddress,
        issueDate,
        dueDate,
        discountType,
        discountValue: Number(discountValue) || 0,
        paymentStatus,
        templateSettings,
        notes,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity) || 1,
          unitPrice: Number(line.unitPrice) || 0,
        })),
      }

      const response = await fetch(invoiceNumber ? "/api/invoices/update" : "/api/invoices/drafts", {
        body: JSON.stringify({ invoice, invoiceId: draftId.current, version: draftVersion.current }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })

      if (!active) return
      if (response.ok) {
        const result = await response.json() as { id: string; version: number }
        draftId.current = result.id
        draftVersion.current = result.version
        setSaveState("Saved")
      } else if (response.status === 409) {
        setSaveState("Conflict detected")
      } else {
        setSaveState("Not saved")
      }
    }, 800)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [accountEmail, buyerAddress, buyerCompanyName, buyerEmail, buyerName, buyerPhone, discountType, discountValue, dueDate, incomplete, invoiceNumber, issueDate, lines, loadingDraft, notes, paymentStatus, sellerAddress, sellerCompanyName, sellerEmail, sellerName, sellerPhone, templateSettings])

  const updateLine = (id: number, patch: Partial<LineItem>) => setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  const removeLine = (id: number) => setLines((current) => current.filter((line) => line.id !== id))
  const loadSellerProfile = async () => {
    setLoadingProfile(true)
    try {
      const response = await fetch("/api/seller-profile")
      const result = await response.json() as { companyName?: string; sellerName?: string; email?: string; phone?: string; address?: string; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Seller profile could not be loaded.")
      setSellerCompanyName(result.companyName ?? "")
      setSellerName(result.sellerName ?? "")
      setSellerEmail(result.email ?? "")
      setSellerPhone(result.phone ?? "")
      setSellerAddress(result.address ?? "")
      setMessage("Saved seller profile loaded.")
    } catch (loadError: unknown) {
      setMessage(loadError instanceof Error ? loadError.message : "Seller profile could not be loaded.")
    } finally {
      setLoadingProfile(false)
    }
  }
  const loadCustomers = async () => {
    if (savedCustomers.length > 0) {
      setShowCustomerPicker((current) => !current)
      return
    }
    setLoadingCustomers(true)
    try {
      const response = await fetch("/api/customers")
      const result = await response.json() as { customers?: SavedCustomer[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Customers could not be loaded.")
      setSavedCustomers(result.customers ?? [])
      setShowCustomerPicker(true)
    } catch (loadError: unknown) {
      setMessage(loadError instanceof Error ? loadError.message : "Customers could not be loaded.")
    } finally {
      setLoadingCustomers(false)
    }
  }
  const applyCustomer = (customerId: string) => {
    const customer = savedCustomers.find((item) => item.id === customerId)
    if (!customer) return
    setBuyerCompanyName(customer.companyName)
    setBuyerName(customer.name)
    setBuyerEmail(customer.email)
    setBuyerPhone(customer.phone)
    setBuyerAddress(customer.address)
    setShowCustomerPicker(false)
    setMessage("Saved customer loaded into this invoice.")
  }
  const openTemplateSettings = async () => {
    if (templateOpen) {
      setTemplateOpen(false)
      return
    }
    if (accountEmail && !templateLoaded) {
      setTemplateSaving(true)
      try {
        const response = await fetch("/api/template")
        const result = await response.json() as { settings?: TemplateSettings; error?: string }
        if (!response.ok) throw new Error(result.error ?? "Template settings could not be loaded.")
        if (result.settings) setTemplateSettings(result.settings)
        setTemplateLoaded(true)
      } catch (loadError: unknown) {
        setMessage(loadError instanceof Error ? loadError.message : "Template settings could not be loaded.")
      } finally {
        setTemplateSaving(false)
      }
    }
    setTemplateOpen(true)
  }
  const saveTemplateSettings = async () => {
    if (!accountEmail) {
      setTemplateOpen(false)
      setMessage("Template settings will apply to this guest invoice only.")
      return
    }
    setTemplateSaving(true)
    try {
      const response = await fetch("/api/template", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(templateSettings) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Template settings could not be saved.")
      setTemplateLoaded(true)
      setTemplateOpen(false)
      setMessage("Template settings saved for future invoices.")
    } catch (saveError: unknown) {
      setMessage(saveError instanceof Error ? saveError.message : "Template settings could not be saved.")
    } finally {
      setTemplateSaving(false)
    }
  }
  const finalizeInvoice = async () => {
    if (!accountEmail) {
      setMessage("Sign in before finalizing an invoice.")
      return
    }
    if (incomplete) {
      setMessage("Complete the required company, name, buyer phone, and line-item fields before finalizing.")
      return
    }
    if (!draftId.current || draftVersion.current === null) {
      setMessage("Wait for the draft to finish saving, then try again.")
      return
    }
    if (!window.confirm("Finalizing assigns a permanent invoice number and cannot be undone. Continue?")) return

    setFinalizing(true)
    setMessage("Finalizing invoice…")
    try {
      const response = await fetch("/api/invoices/finalize", {
        body: JSON.stringify({ invoiceId: draftId.current, idempotencyKey: crypto.randomUUID(), version: draftVersion.current }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const result = await response.json() as { invoiceNumber?: string; version?: number; error?: string }
      if (!response.ok) {
        setMessage(result.error ?? "Invoice could not be finalized.")
        return
      }
      setInvoiceNumber(result.invoiceNumber ?? null)
      draftVersion.current = result.version ?? draftVersion.current
      setMessage(`Invoice ${result.invoiceNumber ?? ""} finalized. You can now download it.`)
    } catch {
      setMessage("Invoice finalization failed. Your draft was not changed. Please try again.")
    } finally {
      setFinalizing(false)
    }
  }

  const exportInvoice = async (format: "PDF" | "DOCX") => {
    if (accountEmail && !invoiceNumber) {
      setMessage("Finalize the invoice before downloading it.")
      return
    }
    if (incomplete) {
      setMessage("Add both company names, seller/customer names, buyer phone, and a description for every item before exporting.")
      return
    }
    if (!previewRef.current) return

    setExporting(true)
    setMessage(`Preparing ${format}…`)
    try {
      if (format === "PDF") await exportPreviewAsPdf(previewRef.current, invoiceNumber ? `${invoiceNumber}.pdf` : "invoice-draft.pdf")
      else await exportPreviewAsDocx(previewRef.current, invoiceNumber ? `${invoiceNumber}.docx` : "invoice-draft.docx")
      setMessage(`${format} downloaded.`)
    } catch {
      setMessage(`${format} export failed. Please try again.`)
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!requestedExport || loadingDraft || exporting) return
    if (accountEmail && !invoiceNumber) {
      void Promise.resolve().then(() => {
        setMessage("Finalize the invoice before downloading it.")
        setRequestedExport(null)
      })
      return
    }
    if (incomplete || !previewRef.current) return
    const format = requestedExport
    void Promise.resolve().then(async () => {
      setRequestedExport(null)
      setExporting(true)
      setMessage(`Preparing ${format}…`)
      try {
        if (format === "PDF") await exportPreviewAsPdf(previewRef.current as HTMLDivElement, invoiceNumber ? `${invoiceNumber}.pdf` : "invoice-draft.pdf")
        else await exportPreviewAsDocx(previewRef.current as HTMLDivElement, invoiceNumber ? `${invoiceNumber}.docx` : "invoice-draft.docx")
        setMessage(`${format} downloaded.`)
      } catch {
        setMessage(`${format} export failed. Please try again.`)
      } finally {
        setExporting(false)
      }
    })
  }, [accountEmail, exporting, incomplete, invoiceNumber, loadingDraft, requestedExport])

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          <BrandLogo />
          {accountEmail ? <div className="flex items-center gap-2"><Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/invoices"><UserRound data-icon="inline-start" />View history</Link><SignOutButton /></div> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}><UserRound data-icon="inline-start" />Sign in to save</Button>}
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">New invoice</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create an invoice in minutes.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">Fill in the essentials, review the live A4 preview, and download when your invoice is ready.</p></div><div className="flex items-center gap-2 text-xs text-slate-500"><span className={`size-2 rounded-full ${accountEmail ? "bg-emerald-500" : "bg-slate-300"}`} />{accountEmail ? `${saveState} · ${accountEmail}` : "Guest mode · nothing is saved yet"}</div></div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.86fr)]">
          <fieldset disabled={loadingDraft || finalizing} className="space-y-5 disabled:opacity-90" aria-label="Invoice form">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-6 flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold">Invoice details</h2><p className="mt-1 text-sm text-slate-500">Required fields are marked with an asterisk.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{invoiceNumber ? "Finalized" : "Draft"}</span></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Issue date" htmlFor="issue-date"><input id="issue-date" className="field" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></Field><Field label="Due date" htmlFor="due-date" required><input id="due-date" className="field" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field><Field label="Payment status" htmlFor="payment-status"><select id="payment-status" className="field" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as "unpaid" | "paid" | "overdue")}><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></Field></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><SectionHeading eyebrow="From" title="Your company" description="Your company name is the main seller heading on the invoice." /><Button variant="outline" size="sm" type="button" disabled={loadingProfile} onClick={() => void loadSellerProfile}>{loadingProfile ? "Loading…" : "Load saved profile"}</Button></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="seller-company-name" required><input id="seller-company-name" className="field" placeholder="Your company name" value={sellerCompanyName} onChange={(event) => setSellerCompanyName(event.target.value)} /></Field><Field label="Seller name" htmlFor="seller-name" required><input id="seller-name" className="field" placeholder="Your full name" value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></Field><Field label="Email" htmlFor="seller-email"><input id="seller-email" className="field" type="email" placeholder="you@example.com" value={sellerEmail} onChange={(event) => setSellerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="seller-phone"><input id="seller-phone" className="field" placeholder="01XXXXXXXXX" value={sellerPhone} onChange={(event) => setSellerPhone(event.target.value)} /></Field><Field label="Address" htmlFor="seller-address" className="sm:col-span-2"><textarea id="seller-address" className="field min-h-24 resize-y" placeholder="Your address" value={sellerAddress} onChange={(event) => setSellerAddress(event.target.value)} /></Field></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><SectionHeading eyebrow="Bill to" title="Customer company" description="The customer company name is the main buyer heading." /><Button variant="outline" size="sm" type="button" disabled={loadingCustomers} onClick={() => void loadCustomers}>{loadingCustomers ? "Loading…" : showCustomerPicker ? "Hide customers" : "Choose saved customer"}</Button></div>{showCustomerPicker && <select className="field mb-5" aria-label="Choose saved customer" defaultValue="" onChange={(event) => applyCustomer(event.target.value)}><option value="" disabled>Select a customer</option>{savedCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName ? `${customer.companyName} · ${customer.name}` : customer.name}</option>)}</select>}<div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="buyer-company-name" required><input id="buyer-company-name" className="field" placeholder="Customer company name" value={buyerCompanyName} onChange={(event) => setBuyerCompanyName(event.target.value)} /></Field><Field label="Buyer name" htmlFor="buyer-name" required><input id="buyer-name" className="field" placeholder="Customer contact name" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></Field><Field label="Email" htmlFor="buyer-email"><input id="buyer-email" className="field" type="email" placeholder="customer@example.com" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="buyer-phone" required><input id="buyer-phone" className="field" placeholder="01XXXXXXXXX" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} required /></Field><Field label="Address" htmlFor="buyer-address" className="sm:col-span-2"><textarea id="buyer-address" className="field min-h-24 resize-y" placeholder="Customer address" value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} /></Field></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><SectionHeading eyebrow="Items" title="What are you charging for?" description="Whole-number quantities and Bangladeshi Taka prices." /><Button variant="outline" size="sm" type="button" onClick={() => setLines((current) => [...current, newLine(nextLineId.current++)])}><Plus data-icon="inline-start" />Add item</Button></div><div className="hidden overflow-hidden rounded-xl border border-slate-200 md:block"><div className="grid grid-cols-[minmax(0,1fr)_100px_140px_120px_40px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Amount</span><span /></div>{lines.map((line) => <LineRow key={line.id} line={line} onChange={updateLine} onRemove={removeLine} />)}</div><div className="space-y-3 md:hidden">{lines.map((line, index) => <LineCard key={line.id} index={index} line={line} onChange={updateLine} onRemove={removeLine} />)}</div><div className="mt-6 grid gap-5 border-t border-slate-200 pt-6 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end"><Field label="Discount" htmlFor="discount-type"><div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2"><select id="discount-type" className="field" value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}><option value="none">No discount</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select>{discountType === "none" ? <div className="field flex items-center text-slate-400">—</div> : <input className="field" type="number" min={0} max={discountType === "percentage" ? 100 : subtotal} step={1} value={discountValue} onChange={(event) => setDiscountValue(event.target.value === "" ? "" : Number(event.target.value))} />}</div></Field><div className="rounded-xl bg-slate-50 p-4 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div><div className="mt-2 flex justify-between text-slate-500"><span>Discount</span><span>− {formatMoney(discount)}</span></div><div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-semibold"><span>Total</span><span>{formatMoney(total)}</span></div></div></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionHeading eyebrow="Optional" title="Notes and payment terms" description="Add a thank-you note or instructions for your customer." /><textarea className="field min-h-28 resize-y" placeholder="Payment terms, delivery notes, or a thank-you message" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          </fieldset>

          <section className="lg:sticky lg:top-6" aria-label="Invoice preview"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Live preview</p><h2 className="mt-1 text-lg font-semibold">A4 portrait</h2></div><Button variant="outline" size="sm" type="button" disabled={templateSaving} onClick={() => void openTemplateSettings}><RotateCcw data-icon="inline-start" />{templateOpen ? "Close customize" : "Customize"}</Button></div>
            {templateOpen && <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Template</p><p className="mt-1 text-sm font-medium">Choose what appears on the invoice</p></div><Button variant="outline" size="sm" type="button" disabled={templateSaving} onClick={() => void saveTemplateSettings}>{templateSaving ? "Saving…" : accountEmail ? "Save template" : "Done"}</Button></div><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-xs font-medium text-slate-600">Accent color</span><select className="field" value={templateSettings.accent} onChange={(event) => setTemplateSettings((current) => ({ ...current, accent: event.target.value as TemplateSettings["accent"] }))}><option value="slate">Slate</option><option value="blue">Blue</option><option value="emerald">Emerald</option><option value="indigo">Indigo</option></select></label><div className="space-y-2 text-sm text-slate-700"><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showAddresses} onChange={(event) => setTemplateSettings((current) => ({ ...current, showAddresses: event.target.checked }))} />Show addresses</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showSellerContact} onChange={(event) => setTemplateSettings((current) => ({ ...current, showSellerContact: event.target.checked }))} />Show seller contact</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showBuyerContact} onChange={(event) => setTemplateSettings((current) => ({ ...current, showBuyerContact: event.target.checked }))} />Show customer contact</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showNotes} onChange={(event) => setTemplateSettings((current) => ({ ...current, showNotes: event.target.checked }))} />Show notes</label></div></div></div>}
                        <div ref={previewRef} className="invoice-paper mx-auto max-w-[720px] rounded-sm border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-10"><div className={`flex items-start justify-between gap-6 border-b-2 pb-7 ${accentStyle.rule}`}><div>{logoUrl && <Image src={logoUrl} alt="Seller logo" width={96} height={48} unoptimized className="mb-3 max-h-12 max-w-24 object-contain object-left" />}<p className={`text-2xl font-bold tracking-tight ${accentStyle.heading}`}>{sellerCompanyName || "Your company name"}</p><p className="mt-1 text-sm font-medium text-slate-600">{sellerName || "Seller name"}</p>{templateSettings.showAddresses && <p className="mt-2 max-w-[220px] whitespace-pre-line text-xs leading-5 text-slate-500">{sellerAddress || "Your address"}</p>}{templateSettings.showSellerContact && (sellerEmail || sellerPhone) && <p className="mt-2 text-xs text-slate-500">{[sellerEmail, sellerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="text-right"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Invoice</p><p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{invoiceNumber || "DRAFT"}</p></div></div><div className="grid gap-6 border-b border-slate-200 py-7 text-sm sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Bill to</p><p className="mt-2 text-base font-bold">{buyerCompanyName || "Customer company"}</p><p className="mt-1 text-sm font-medium text-slate-600">{buyerName || "Buyer name"}</p>{templateSettings.showAddresses && <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-500">{buyerAddress || "Customer address"}</p>}{templateSettings.showBuyerContact && (buyerEmail || buyerPhone) && <p className="mt-1 text-xs text-slate-500">{[buyerEmail, buyerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="sm:text-right"><div className="flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Issue date</span><span className="font-medium">{formatDate(issueDate)}</span></div><div className="mt-2 flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Due date</span><span className="font-medium">{formatDate(dueDate)}</span></div></div></div><div className="py-7"><div className="grid grid-cols-[minmax(0,1fr)_46px_88px_88px] gap-3 border-b border-slate-200 pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"><span>Description</span><span className="text-center">Qty</span><span className="text-right">Price</span><span className="text-right">Amount</span></div>{lines.map((line) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_46px_88px_88px] gap-3 border-b border-slate-100 py-4 text-xs"><span className="break-words text-slate-700">{line.description || "Item description"}</span><span className="text-center text-slate-500">{line.quantity || 0}</span><span className="text-right text-slate-500">{formatMoney(Number(line.unitPrice) || 0)}</span><span className="text-right font-medium">{formatMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</span></div>)}</div><div className="ml-auto max-w-[270px] space-y-3 border-t border-slate-200 pt-5 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>{discount > 0 && <div className="flex justify-between text-slate-500"><span>Discount</span><span>− {formatMoney(discount)}</span></div>}<div className={`flex justify-between border-t-2 pt-3 text-lg font-bold ${accentStyle.total}`}><span>Total</span><span>{formatMoney(total)}</span></div></div>{templateSettings.showNotes && notes && <div className="mt-12 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500"><p className="mb-1 font-semibold text-slate-700">Notes</p><p className="whitespace-pre-line">{notes}</p></div>}</div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{accountEmail && !invoiceNumber && <Button type="button" className="mb-3 h-11 w-full" disabled={finalizing || exporting} onClick={finalizeInvoice}>{finalizing ? "Finalizing…" : "Finalize invoice"}</Button>}<div className="grid gap-3 sm:grid-cols-2"><Button type="button" variant="outline" className="h-11" disabled={exporting || finalizing} onClick={() => exportInvoice("PDF")}><FileDown data-icon="inline-start" />Download PDF</Button><Button type="button" className="h-11" disabled={exporting || finalizing} onClick={() => exportInvoice("DOCX")}><FileDown data-icon="inline-start" />Download DOCX</Button></div>{message && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600" role="status">{message}</p>}<p className="mt-3 text-center text-xs text-slate-500">{accountEmail ? "Finalized invoices stay in your history. Revise as new when you need another version." : "Sign in later to save invoice history across devices."}</p></div>
          </section>
        </div>
      </div>
    </main>
  )
}

function Field({ label, htmlFor, required, className = "", children }: { label: string; htmlFor: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={`block ${className}`} htmlFor={htmlFor}><span className="mb-2 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span>{children}</label>
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</p><h2 className="mt-1 text-base font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>
}

function LineRow({ line, onChange, onRemove }: { line: LineItem; onChange: (id: number, patch: Partial<LineItem>) => void; onRemove: (id: number) => void }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_100px_140px_120px_40px] items-center gap-3 border-t border-slate-200 px-4 py-3"><input aria-label="Item description" className="field" placeholder="Service or product" value={line.description} onChange={(event) => onChange(line.id, { description: event.target.value })} /><input aria-label="Quantity" className="field" type="number" min={1} step={1} value={line.quantity} onChange={(event) => onChange(line.id, { quantity: event.target.value === "" ? "" : Math.max(1, Number(event.target.value)) })} /><input aria-label="Unit price" className="field" type="number" min={0} step={1} value={line.unitPrice} onChange={(event) => onChange(line.id, { unitPrice: event.target.value === "" ? "" : Math.max(0, Number(event.target.value)) })} /><p className="text-right text-sm font-medium">{formatMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</p><Button aria-label="Remove item" type="button" variant="ghost" size="icon" onClick={() => onRemove(line.id)}><Trash2 /></Button></div>
}

function LineCard({ line, index, onChange, onRemove }: { line: LineItem; index: number; onChange: (id: number, patch: Partial<LineItem>) => void; onRemove: (id: number) => void }) {
  return <div className="rounded-xl border border-slate-200 p-4"><div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item {index + 1}</p><Button aria-label={`Remove item ${index + 1}`} type="button" variant="ghost" size="icon" onClick={() => onRemove(line.id)}><Trash2 /></Button></div><div className="space-y-4"><Field label="Description" htmlFor={`description-${line.id}`} required><input id={`description-${line.id}`} className="field" placeholder="Service or product" value={line.description} onChange={(event) => onChange(line.id, { description: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Quantity" htmlFor={`quantity-${line.id}`} required><input id={`quantity-${line.id}`} className="field" type="number" min={1} step={1} value={line.quantity} onChange={(event) => onChange(line.id, { quantity: event.target.value === "" ? "" : Math.max(1, Number(event.target.value)) })} /></Field><Field label="Unit price" htmlFor={`price-${line.id}`} required><input id={`price-${line.id}`} className="field" type="number" min={0} step={1} value={line.unitPrice} onChange={(event) => onChange(line.id, { unitPrice: event.target.value === "" ? "" : Math.max(0, Number(event.target.value)) })} /></Field></div><div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Amount</span><span className="font-semibold">{formatMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</span></div></div></div>
}
