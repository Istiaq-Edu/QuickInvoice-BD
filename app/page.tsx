"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, FileDown, Plus, RotateCcw, Save, ShieldCheck, Trash2, UserRound, X } from "lucide-react"
import { useAdminStatus } from "@/components/admin-nav"
import { BrandLogo } from "@/components/brand-logo"
import { LogoCropper, type CroppedLogo } from "@/components/logo-cropper"
import { MAX_UPLOAD_BYTES } from "@/lib/image/crop"
import { SignOutButton } from "@/components/sign-out-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { estimateExportPageCount, exportPreviewAsDocx, exportPreviewAsPdf } from "@/lib/invoice/export"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import type { InvoiceDraft } from "@/lib/invoice/types"

type EditableNumber = number | ""
type LineItem = { id: number; description: string; quantity: EditableNumber; unitPrice: EditableNumber; discountType: DiscountType; discountValue: EditableNumber }
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
const newLine = (id: number): LineItem => ({ id, description: "", quantity: 1, unitPrice: 0, discountType: "none", discountValue: 0 })
const getLineAmounts = (line: LineItem) => {
  const originalAmount = Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0)
  const numericDiscount = Math.max(0, Number(line.discountValue) || 0)
  const discountAmount = line.discountType === "fixed"
    ? Math.min(originalAmount, numericDiscount)
    : line.discountType === "percentage"
      ? Math.round((originalAmount * Math.min(100, numericDiscount)) / 100)
      : 0
  return { originalAmount, discountAmount, amount: Math.max(0, originalAmount - discountAmount) }
}
const defaultTemplateSettings: TemplateSettings = { accent: "slate", showAddresses: true, showSellerContact: true, showBuyerContact: true, showNotes: true, showQuantityColumn: true }
const mobileSteps = ["Details", "From", "Bill to", "Items", "Notes", "Preview"]
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
  showQuantityColumn: boolean
}

const normalizeTemplateSettings = (settings?: Partial<TemplateSettings>): TemplateSettings => ({
  ...defaultTemplateSettings,
  ...settings,
})
type SavedSellerProfile = {
  companyName: string
  sellerName: string
  address: string
  email: string
  phone: string
  logoAssetId: string | null
  logoUrl: string | null
}
type SavedCustomer = {
  id: string
  companyName: string
  name: string
  address: string
  email: string
  phone: string
}
type SavedItem = {
  id: string
  description: string
  defaultUnitPrice: number
  createdAt: string
  updatedAt: string
}
type SavedNoteTemplate = {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
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
  logoAssetId?: string | null
  notes?: string
  lines?: Array<{ description?: string; quantity?: number; unitPrice?: number; discountType?: DiscountType; discountValue?: number }>
}
type AutosaveInvoice = Omit<InvoiceDraft, "lines"> & { lines: Array<{ description: string; quantity: number; unitPrice: number }> }
type AutosaveRequest = { invoice: AutosaveInvoice; update: boolean; generation: number }

export default function Home() {
  const router = useRouter()
  const isAdmin = useAdminStatus()
  const previewRef = useRef<HTMLDivElement>(null)
  const nextLineId = useRef(2)
  const draftId = useRef<string | null>(null)
  const loadedDraftId = useRef<string | null>(null)
  const finalizedInvoiceLoaded = useRef(false)
  const draftVersion = useRef<number | null>(null)
  const autosaveInFlight = useRef(false)
  const autosavePending = useRef(false)
  const pendingAutosave = useRef<AutosaveRequest | null>(null)
  const autosaveGeneration = useRef(0)
  const [exporting, setExporting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [savedSellerProfile, setSavedSellerProfile] = useState<SavedSellerProfile | null>(null)
  const [savedCustomers, setSavedCustomers] = useState<SavedCustomer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [profileDrawer, setProfileDrawer] = useState<"seller" | "customer" | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerCloseTimeout = useRef<number | null>(null)
  const [templateSettings, setTemplateSettings] = useState<TemplateSettings>(defaultTemplateSettings)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoAssetId, setLogoAssetId] = useState<string | null>(null)
  const [pendingCrop, setPendingCrop] = useState<File | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoUploadProgress, setLogoUploadProgress] = useState(0)
  const [logoMessage, setLogoMessage] = useState("")
  const [logoError, setLogoError] = useState("")
  const [requestedExport, setRequestedExport] = useState<"PDF" | "DOCX" | null>(null)
  const [exportPageCount, setExportPageCount] = useState(1)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
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
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [discountType, setDiscountType] = useState<DiscountType>("none")
  const [discountValue, setDiscountValue] = useState<EditableNumber>(0)
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "paid" | "overdue">("unpaid")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<LineItem[]>([newLine(1)])
  const [message, setMessage] = useState("")
  const [sellerProfileStatus, setSellerProfileStatus] = useState("")
  const [customerStatus, setCustomerStatus] = useState("")
  const [savedItems, setSavedItems] = useState<SavedItem[]>([])
  const [savedNoteTemplates, setSavedNoteTemplates] = useState<SavedNoteTemplate[]>([])
  const [libraryDrawer, setLibraryDrawer] = useState<"items" | "notes" | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState("")
  const [libraryStatus, setLibraryStatus] = useState("")
  const [savingItemLineId, setSavingItemLineId] = useState<number | null>(null)
  const [noteSaveOpen, setNoteSaveOpen] = useState(false)
  const [noteSaveTitle, setNoteSaveTitle] = useState("")
  const [mobileStep, setMobileStep] = useState(0)
  const goToStep = (step: number) => {
    setMobileStep(step)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  useEffect(() => {
    const today = getDhakaDate()
    window.queueMicrotask(() => {
      setIssueDate((current) => current || today)
      setDueDate((current) => current || today)
    })
  }, [])

  useEffect(() => {
    if (!profileDrawer) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false)
        window.setTimeout(() => setProfileDrawer(null), 200)
      }
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [profileDrawer])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      window.queueMicrotask(() => setAuthChecked(true))
      return
    }

    let active = true
    const applyUser = (user: { email?: string } | null) => {
      if (!active) return
      setAccountEmail(user ? user.email ?? "Signed in" : null)
      setSaveState(user ? "Signed in" : "Guest mode")
      if (!user) {
        setLogoUrl(null)
        setLogoAssetId(null)
        setPendingCrop(null)
      }
      setAuthChecked(true)
    }
    void supabase.auth.getUser().then(({ data }) => applyUser(data.user)).catch(() => applyUser(null))
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") applyUser(null)
      else if (session?.user) applyUser(session.user)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!accountEmail) return
    void fetch("/api/seller-logo").then(async (response) => {
      const result = await response.json() as { logo?: { id?: string; url?: string | null } | null }
      if (response.ok && !finalizedInvoiceLoaded.current) {
        setLogoAssetId(result.logo?.id ?? null)
        setLogoUrl(result.logo?.url ?? null)
      }
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
      const result = await response.json() as { id?: string; version?: number; lifecycleStatus?: "draft" | "finalized"; invoiceNumber?: string | null; logoAssetId?: string | null; logoUrl?: string | null; document?: PersistedDocument; error?: string }
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
        setTemplateSettings(normalizeTemplateSettings(document.templateSettings))
        setTemplateLoaded(true)
      }
      setNotes(document.notes ?? "")
      setLines(sourceLines.length > 0 ? sourceLines.map((line, index) => ({
        id: index + 1,
        description: line.description ?? "",
        quantity: typeof line.quantity === "number" ? line.quantity : 1,
        unitPrice: typeof line.unitPrice === "number" ? line.unitPrice : 0,
        discountType: line.discountType === "fixed" || line.discountType === "percentage" ? line.discountType : "none",
        discountValue: typeof line.discountValue === "number" ? line.discountValue : 0,
      })) : [newLine(1)])
      nextLineId.current = sourceLines.length + 1
      draftId.current = result.id ?? draftQueryId
      draftVersion.current = result.version ?? 1
      loadedDraftId.current = draftQueryId
      finalizedInvoiceLoaded.current = result.lifecycleStatus === "finalized"
      if (result.logoAssetId) {
        setLogoAssetId(result.logoAssetId)
        setLogoUrl(result.logoUrl ?? null)
      } else if (result.lifecycleStatus === "finalized") {
        setLogoAssetId(null)
        setLogoUrl(null)
      }
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

  const lineAmounts = useMemo(() => lines.map((line) => ({ id: line.id, ...getLineAmounts(line) })), [lines])
  const subtotal = lineAmounts.reduce((sum, line) => sum + line.originalAmount, 0)
  const hasLineDiscount = lines.some((line) => line.discountType !== "none" || Number(line.discountValue) > 0)
  const legacyDiscount = useMemo(() => {
    const numericDiscount = Number(discountValue) || 0
    if (discountType === "fixed") return Math.min(subtotal, Math.max(0, numericDiscount))
    if (discountType === "percentage") return Math.round((subtotal * Math.min(100, Math.max(0, numericDiscount))) / 100)
    return 0
  }, [discountType, discountValue, subtotal])
  const discount = hasLineDiscount ? lineAmounts.reduce((sum, line) => sum + line.discountAmount, 0) : legacyDiscount
  const total = Math.max(0, subtotal - discount)
  const accentStyle = accentStyles[templateSettings.accent]
  const previewLineGrid = templateSettings.showQuantityColumn
    ? "grid grid-cols-[minmax(0,1fr)_22px_38px_50px_50px] gap-1 sm:grid-cols-[minmax(0,1fr)_42px_72px_72px_86px] sm:gap-2"
    : "grid grid-cols-[minmax(0,1fr)_38px_50px_50px] gap-1 sm:grid-cols-[minmax(0,1fr)_82px_72px_86px] sm:gap-2"
  const incomplete = !sellerCompanyName.trim() || !sellerName.trim() || !buyerCompanyName.trim() || !buyerName.trim() || !buyerPhone.trim() || lines.length === 0 || lines.some((line) => !line.description.trim() || line.quantity === "" || Number(line.quantity) < 1 || line.unitPrice === "" || Number(line.unitPrice) < 0 || (line.discountType === "percentage" && Number(line.discountValue) > 100) || (line.discountType === "fixed" && Number(line.discountValue) > Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0)))

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (previewRef.current) setExportPageCount(estimateExportPageCount(previewRef.current))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [buyerAddress, buyerCompanyName, buyerEmail, buyerName, buyerPhone, discount, dueDate, issueDate, lines, logoUrl, notes, sellerAddress, sellerCompanyName, sellerEmail, sellerName, sellerPhone, templateSettings])

  useEffect(() => {
    if (!accountEmail || loadingDraft || !issueDate || !dueDate || incomplete) return

    const generation = ++autosaveGeneration.current
    autosavePending.current = true
    const request: AutosaveRequest = {
      invoice: {
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
        logoAssetId,
        notes,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity) || 1,
          unitPrice: Number(line.unitPrice) || 0,
          discountType: line.discountType,
          discountValue: Number(line.discountValue) || 0,
        })),
      },
      update: Boolean(invoiceNumber),
      generation,
    }

    const save = async (nextRequest: AutosaveRequest): Promise<void> => {
      if (autosaveInFlight.current) {
        pendingAutosave.current = nextRequest
        return
      }

      autosaveInFlight.current = true
      setSavingDraft(true)
      if (nextRequest.generation === autosaveGeneration.current) setSaveState("Saving…")
      try {
        const response = await fetch(nextRequest.update ? "/api/invoices/update" : "/api/invoices/drafts", {
          body: JSON.stringify({ invoice: nextRequest.invoice, invoiceId: draftId.current, version: draftVersion.current }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
        const result = await response.json().catch(() => null) as { id?: string; version?: number; error?: string } | null

        if (response.ok && result?.id && typeof result.version === "number") {
          draftId.current = result.id
          draftVersion.current = result.version
          if (nextRequest.generation === autosaveGeneration.current) {
            autosavePending.current = false
            setSaveState("Saved")
          }
        } else if (nextRequest.generation === autosaveGeneration.current) {
          autosavePending.current = false
          if (response.status === 409) setSaveState("Conflict detected")
          else setSaveState("Not saved")
        }
      } catch {
        if (nextRequest.generation === autosaveGeneration.current) {
          autosavePending.current = false
          setSaveState("Not saved")
        }
      } finally {
        autosaveInFlight.current = false
        const queuedRequest = pendingAutosave.current
        pendingAutosave.current = null
        if (queuedRequest) {
          void save(queuedRequest)
        } else {
          setSavingDraft(false)
        }
      }
    }

    const timeout = window.setTimeout(() => {
      void save(request)
    }, 800)

    return () => window.clearTimeout(timeout)
  }, [accountEmail, buyerAddress, buyerCompanyName, buyerEmail, buyerName, buyerPhone, discountType, discountValue, dueDate, incomplete, invoiceNumber, issueDate, lines, loadingDraft, logoAssetId, notes, paymentStatus, sellerAddress, sellerCompanyName, sellerEmail, sellerName, sellerPhone, templateSettings])

  const updateLine = (id: number, patch: Partial<LineItem>) => setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  const removeLine = (id: number) => setLines((current) => current.filter((line) => line.id !== id))
  const addLine = () => {
    const id = nextLineId.current++
    setLines((current) => [...current, newLine(id)])
    window.requestAnimationFrame(() => document.getElementById(`description-${id}`)?.focus())
  }

  const ensureAuthenticated = async () => {
    if (accountEmail) return true
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setMessage("Sign in to load or save profiles.")
      return false
    }
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      setAccountEmail(data.user.email ?? "Signed in")
      setAuthChecked(true)
      return true
    }
    setAuthChecked(true)
    setMessage("Sign in to load or save profiles.")
    return false
  }
  const chooseLogo = (file: File | undefined) => {
    if (!file) return
    setLogoMessage("")
    if (file.size > MAX_UPLOAD_BYTES) {
      setLogoError("That image is larger than 2 MB. Choose a smaller file.")
      return
    }
    setLogoError("")
    setLogoUploadProgress(0)
    setPendingCrop(file)
  }

  const uploadSellerLogo = async (logo: CroppedLogo) => {
    if (!accountEmail) {
      setLogoError("Sign in to upload a company logo.")
      return
    }
    const uploadStartedAt = Date.now()
    setUploadingLogo(true)
    setLogoUploadProgress(8)
    setLogoMessage("")
    setLogoError("")
    try {
      const body = new FormData()
      body.append("file", logo.file)
      body.append("width", String(logo.width))
      body.append("height", String(logo.height))
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open("POST", "/api/seller-logo")
        request.upload.onloadstart = () => setLogoUploadProgress(8)
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) setLogoUploadProgress(Math.min(95, Math.max(8, Math.round((event.loaded / event.total) * 95))))
        }
        request.upload.onload = () => setLogoUploadProgress(95)
        request.onload = () => resolve({ status: request.status, body: request.responseText })
        request.onerror = () => reject(new Error("Logo upload failed. Check your connection and try again."))
        request.send(body)
      })
      const response = JSON.parse(result.body) as { logo?: { id?: string; url?: string | null }; error?: string }
      if (result.status < 200 || result.status >= 300) throw new Error(response.error ?? "Logo could not be uploaded.")
      setLogoUploadProgress(100)
      const remainingVisibleTime = Math.max(0, 700 - (Date.now() - uploadStartedAt))
      if (remainingVisibleTime > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingVisibleTime))
      setLogoAssetId(response.logo?.id ?? null)
      setLogoUrl(response.logo?.url ?? null)
      setPendingCrop(null)
      setLogoMessage("Company logo uploaded and ready for new invoices.")
    } catch (uploadError: unknown) {
      setLogoError(uploadError instanceof Error ? uploadError.message : "Logo could not be uploaded.")
    } finally {
      setUploadingLogo(false)
    }
  }
  const removeSellerLogo = async () => {
    if (!accountEmail || !logoUrl) return
    setUploadingLogo(true)
    setLogoMessage("")
    setLogoError("")
    try {
      const response = await fetch("/api/seller-logo", { method: "DELETE" })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Logo could not be removed.")
      setLogoAssetId(null)
      setLogoUrl(null)
      setLogoMessage("Company logo removed from future invoices.")
    } catch (removeError: unknown) {
      setLogoError(removeError instanceof Error ? removeError.message : "Logo could not be removed.")
    } finally {
      setUploadingLogo(false)
    }
  }
  const openProfileDrawer = (type: "seller" | "customer") => {
    if (drawerCloseTimeout.current !== null) window.clearTimeout(drawerCloseTimeout.current)
    setProfileDrawer(type)
    setDrawerOpen(false)
    window.requestAnimationFrame(() => setDrawerOpen(true))
  }
  const closeProfileDrawer = () => {
    setDrawerOpen(false)
    drawerCloseTimeout.current = window.setTimeout(() => setProfileDrawer(null), 200)
  }
  const loadSellerProfile = async () => {
    openProfileDrawer("seller")
    setSavedSellerProfile(null)
    setSellerProfileStatus("Checking your sign-in…")
    if (!(await ensureAuthenticated())) {
      setSellerProfileStatus("Sign in to load or save profiles.")
      return
    }
    setSellerProfileStatus("Loading saved profile…")
    setLoadingProfile(true)
    try {
      const response = await fetch("/api/seller-profile", { cache: "no-store" })
      const result = await response.json() as { companyName?: string; sellerName?: string; email?: string; phone?: string; address?: string; logoAssetId?: string | null; logoUrl?: string | null; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Seller profile could not be loaded.")
      const sellerProfile = {
        companyName: result.companyName ?? "",
        sellerName: result.sellerName ?? "",
        email: result.email ?? "",
        phone: result.phone ?? "",
        address: result.address ?? "",
        logoAssetId: result.logoAssetId ?? null,
        logoUrl: result.logoUrl ?? null,
      }
      setSavedSellerProfile(sellerProfile)
      setSellerProfileStatus("Saved seller profile is ready to use.")
      setMessage("Saved seller profile loaded.")
    } catch (loadError: unknown) {
      const errorMessage = loadError instanceof Error ? loadError.message : "Seller profile could not be loaded."
      setSellerProfileStatus(errorMessage)
      setMessage(errorMessage)
    } finally {
      setLoadingProfile(false)
    }
  }
  const applySellerProfile = () => {
    if (!savedSellerProfile) return
    setSellerCompanyName(savedSellerProfile.companyName)
    setSellerName(savedSellerProfile.sellerName)
    setSellerEmail(savedSellerProfile.email)
    setSellerPhone(savedSellerProfile.phone)
    setSellerAddress(savedSellerProfile.address)
    setLogoAssetId(savedSellerProfile.logoAssetId)
    setLogoUrl(savedSellerProfile.logoUrl)
    closeProfileDrawer()
    setSellerProfileStatus("Saved seller profile loaded into this invoice.")
    setMessage("Saved seller profile loaded into this invoice.")
  }
  const saveSellerProfile = async () => {
    if (!sellerCompanyName.trim() || !sellerName.trim()) {
      const validationMessage = "Enter your company name and seller name before saving the profile."
      setSellerProfileStatus(validationMessage)
      setMessage(validationMessage)
      return
    }
    setSellerProfileStatus("Checking your sign-in…")
    if (!(await ensureAuthenticated())) {
      setSellerProfileStatus("Sign in to load or save profiles.")
      return
    }
    setSellerProfileStatus("Saving seller profile…")
    setSavingProfile(true)
    try {
      const response = await fetch("/api/seller-profile", {
        body: JSON.stringify({ companyName: sellerCompanyName, sellerName, email: sellerEmail, phone: sellerPhone, address: sellerAddress, logoAssetId }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Seller profile could not be saved.")
      setSellerProfileStatus("Seller profile saved.")
      setMessage("Seller profile saved. You can load it on future invoices.")
    } catch (saveError: unknown) {
      const errorMessage = saveError instanceof Error ? saveError.message : "Seller profile could not be saved."
      setSellerProfileStatus(errorMessage)
      setMessage(errorMessage)
    } finally {
      setSavingProfile(false)
    }
  }
  const loadCustomers = async () => {
    openProfileDrawer("customer")
    setSavedCustomers([])
    setCustomerStatus("Checking your sign-in…")
    if (!(await ensureAuthenticated())) {
      setCustomerStatus("Sign in to load or save customers.")
      return
    }
    setCustomerStatus("Loading saved customers…")
    setLoadingCustomers(true)
    try {
      const response = await fetch("/api/customers", { cache: "no-store" })
      const result = await response.json() as { customers?: SavedCustomer[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Customers could not be loaded.")
      const customers = result.customers ?? []
      setSavedCustomers(customers)
      setCustomerStatus(customers.length > 0 ? `${customers.length} saved customer${customers.length === 1 ? "" : "s"} ready to use.` : "No saved customers found.")
    } catch (loadError: unknown) {
      const errorMessage = loadError instanceof Error ? loadError.message : "Customers could not be loaded."
      setCustomerStatus(errorMessage)
      setMessage(errorMessage)
    } finally {
      setLoadingCustomers(false)
    }
  }
  const applyCustomer = (customerId: string) => {
    const customer = savedCustomers.find((item) => item.id === customerId)
    if (!customer) return
    setSelectedCustomerId(customer.id)
    setBuyerCompanyName(customer.companyName)
    setBuyerName(customer.name)
    setBuyerEmail(customer.email)
    setBuyerPhone(customer.phone)
    setBuyerAddress(customer.address)
    closeProfileDrawer()
    setCustomerStatus("Saved customer loaded into this invoice.")
    setMessage("Saved customer loaded into this invoice.")
  }
  const saveCustomer = async () => {
    if (!buyerName.trim()) {
      setCustomerStatus("Enter a buyer name before saving the customer.")
      setMessage("Enter a buyer name before saving the customer.")
      return
    }
    setCustomerStatus("Checking your sign-in…")
    if (!(await ensureAuthenticated())) {
      setCustomerStatus("Sign in to load or save customers.")
      return
    }
    setCustomerStatus("Saving customer…")
    setSavingCustomer(true)
    try {
      const payload = { companyName: buyerCompanyName, name: buyerName, email: buyerEmail, phone: buyerPhone, address: buyerAddress }
      const response = await fetch("/api/customers", {
        body: JSON.stringify(selectedCustomerId ? { ...payload, id: selectedCustomerId } : payload),
        headers: { "Content-Type": "application/json" },
        method: selectedCustomerId ? "PATCH" : "POST",
      })
      const result = await response.json() as { customer?: SavedCustomer; error?: string }
      if (!response.ok || !result.customer) throw new Error(result.error ?? "Customer could not be saved.")
      setSavedCustomers((current) => {
        const withoutSaved = current.filter((customer) => customer.id !== result.customer?.id)
        return [result.customer as SavedCustomer, ...withoutSaved]
      })
      setSelectedCustomerId(result.customer.id)
      setCustomerStatus(selectedCustomerId ? "Saved customer updated." : "Customer saved for future invoices.")
      setMessage(selectedCustomerId ? "Saved customer updated." : "Customer saved for future invoices.")
    } catch (saveError: unknown) {
      const errorMessage = saveError instanceof Error ? saveError.message : "Customer could not be saved."
      setCustomerStatus(errorMessage)
      setMessage(errorMessage)
    } finally {
      setSavingCustomer(false)
    }
  }
  const loadLibrary = async (kind: "items" | "notes", query = "") => {
    if (!(await ensureAuthenticated())) return
    setLibraryDrawer(kind)
    setLibraryQuery(query)
    setLibraryStatus("")
    setLibraryLoading(true)
    try {
      const endpoint = kind === "items" ? "/api/items" : "/api/note-templates"
      const response = await fetch(`${endpoint}${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`)
      const result = await response.json() as { items?: SavedItem[]; notes?: SavedNoteTemplate[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Saved content could not be loaded.")
      if (kind === "items") setSavedItems(result.items ?? [])
      else setSavedNoteTemplates(result.notes ?? [])
    } catch (loadError: unknown) {
      setLibraryStatus(loadError instanceof Error ? loadError.message : "Saved content could not be loaded.")
    } finally {
      setLibraryLoading(false)
    }
  }
  const saveReusableItem = async (line: LineItem) => {
    if (!accountEmail) {
      setMessage("Sign in to save reusable items.")
      return
    }
    const description = line.description.trim()
    if (!description) {
      setMessage("Add an item description before saving it.")
      return
    }
    setSavingItemLineId(line.id)
    try {
      const response = await fetch("/api/items", {
        body: JSON.stringify({ description, defaultUnitPrice: Number(line.unitPrice) || 0 }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const result = await response.json() as { item?: SavedItem; error?: string }
      if (!response.ok || !result.item) throw new Error(result.error ?? "Item could not be saved.")
      setSavedItems((current) => [result.item as SavedItem, ...current.filter((item) => item.id !== result.item?.id)])
      setMessage("Item saved for future invoices.")
    } catch (saveError: unknown) {
      setMessage(saveError instanceof Error ? saveError.message : "Item could not be saved.")
    } finally {
      setSavingItemLineId(null)
    }
  }
  const applySavedItem = (item: SavedItem) => {
    setLines((current) => [...current, { id: nextLineId.current++, description: item.description, quantity: 1, unitPrice: item.defaultUnitPrice, discountType: "none", discountValue: 0 }])
    setLibraryDrawer(null)
    setMessage("Saved item added to the invoice.")
  }
  const openNoteSaveDialog = () => {
    if (!accountEmail) {
      setMessage("Sign in to save reusable notes.")
      return
    }
    if (!notes.trim()) {
      setMessage("Add a note before saving it as a reusable note.")
      return
    }
    setNoteSaveTitle("")
    setNoteSaveOpen(true)
  }
  const saveNoteTemplate = async () => {
    if (!noteSaveTitle.trim() || !notes.trim()) return
    try {
      const response = await fetch("/api/note-templates", {
        body: JSON.stringify({ title: noteSaveTitle, body: notes }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const result = await response.json() as { note?: SavedNoteTemplate; error?: string }
      if (!response.ok || !result.note) throw new Error(result.error ?? "Note could not be saved.")
      setSavedNoteTemplates((current) => [result.note as SavedNoteTemplate, ...current.filter((note) => note.id !== result.note?.id)])
      setNoteSaveOpen(false)
      setMessage("Note saved for future invoices.")
    } catch (saveError: unknown) {
      setMessage(saveError instanceof Error ? saveError.message : "Note could not be saved.")
    }
  }
  const applySavedNote = (note: SavedNoteTemplate, mode: "replace" | "append") => {
    setNotes((current) => mode === "replace" || !current.trim() ? note.body : `${current.trimEnd()}\\n\\n${note.body}`)
    setLibraryDrawer(null)
    setMessage(mode === "replace" ? "Saved note loaded." : "Saved note appended.")
  }
  const deleteLibraryEntry = async (kind: "items" | "notes", id: string) => {
    try {
      const endpoint = kind === "items" ? "/api/items" : "/api/note-templates"
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Saved content could not be deleted.")
      if (kind === "items") setSavedItems((current) => current.filter((item) => item.id !== id))
      else setSavedNoteTemplates((current) => current.filter((note) => note.id !== id))
      setLibraryStatus("Saved content deleted.")
    } catch (deleteError: unknown) {
      setLibraryStatus(deleteError instanceof Error ? deleteError.message : "Saved content could not be deleted.")
    }
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
        if (result.settings) setTemplateSettings(normalizeTemplateSettings(result.settings))
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
    if (autosavePending.current || autosaveInFlight.current || pendingAutosave.current) {
      setMessage("Wait for the latest invoice changes to finish saving, then try again.")
      return
    }
    if (!draftId.current || draftVersion.current === null) {
      setMessage("Wait for the draft to finish saving, then try again.")
      return
    }
    setFinalizeConfirmOpen(true)
  }
  const confirmFinalizeInvoice = async () => {
    setFinalizeConfirmOpen(false)
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
    } catch (exportError: unknown) {
      console.error("Invoice export failed", { format, error: exportError instanceof Error ? exportError.message : "unknown_error" })
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
      } catch (exportError: unknown) {
        console.error("Invoice export failed", { format, error: exportError instanceof Error ? exportError.message : "unknown_error" })
        setMessage(`${format} export failed. Please try again.`)
      } finally {
        setExporting(false)
      }
    })
  }, [accountEmail, exporting, incomplete, invoiceNumber, loadingDraft, requestedExport])

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <header className="glass-header sticky top-0 z-40">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          <BrandLogo />
          {!authChecked ? <span className="text-xs text-muted-foreground">Checking session…</span> : accountEmail ? <div className="flex items-center gap-2">{isAdmin && <Link className={`${buttonVariants({ variant: "outline", size: "sm" })} hidden sm:inline-flex`} href="/admin/allowlist"><ShieldCheck data-icon="inline-start" />Admin</Link>}<Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/invoices"><UserRound data-icon="inline-start" />View history</Link><SignOutButton /></div> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}><UserRound data-icon="inline-start" /><span className="sm:hidden">Sign in</span><span className="hidden sm:inline">Sign in to save</span></Button>}
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-7 pb-28 sm:px-6 sm:py-9 lg:px-8 lg:pb-10 xl:py-10">
        <div className="mb-7 grid items-end gap-6 xl:grid-cols-[minmax(0,1fr)_430px] xl:gap-10">
          <div>
            <p className="eyebrow mb-3 flex items-center gap-2"><span aria-hidden="true" className="h-px w-6 bg-primary/50" />Invoice workspace · Bangladesh</p>
            <h1 className="max-w-4xl font-heading text-[2.75rem] font-medium leading-[0.98] tracking-[-0.04em] text-foreground sm:text-[3.4rem]">Create a polished invoice in minutes.</h1>
            <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[0.95rem]">Complete the essentials, review the document, and export a professional invoice when it is ready.</p>
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/90 bg-card/80 px-3.5 py-2 text-xs text-muted-foreground shadow-sm">
                <span className={`size-2 rounded-full ${accountEmail ? "bg-emerald-600" : "bg-stone-400"}`} />
                {accountEmail ? `${saveState}${accountEmail === "Signed in" ? "" : ` · ${accountEmail}`}` : "Guest mode · nothing is saved yet"}
              </div>
            </div>
          </div>

          <aside className="surface-raised hidden overflow-hidden p-2 xl:block" aria-label="Invoice workflow">
            <div className="px-3 pb-3 pt-2">
              <p className="text-sm font-semibold text-foreground">A clear path to send</p>
              <p className="mt-1 text-xs text-muted-foreground">Your work stays visible from draft to download.</p>
            </div>
            <ol className="grid grid-cols-3 gap-1.5">
              {[
                ["01", "Add essentials", "Dates, parties and items"],
                ["02", "Review", "Check the live A4 preview"],
                ["03", "Send", "Finalize and export"],
              ].map(([number, title, description]) => <li className="rounded-xl border border-border/70 bg-muted/40 px-3 py-3" key={number}><span className="font-mono text-[10px] font-semibold text-primary">{number}</span><p className="mt-3 text-xs font-semibold text-foreground">{title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p></li>)}
            </ol>
          </aside>
        </div>

        {message && <p className="notice-info mb-4" role="status">{message}</p>}
        {sellerProfileStatus && <p className="notice-info mb-4" role="status">Seller: {sellerProfileStatus}</p>}
        {customerStatus && <p className="notice-info mb-4" role="status">Customer: {customerStatus}</p>}

        <nav className="mb-6 xl:hidden" aria-label="Invoice steps">
          <ol className="surface-soft flex gap-1.5 overflow-x-auto p-1.5">
            {mobileSteps.map((label, index) => (
              <li className="shrink-0" key={label}>
                <button className={`flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold transition-colors ${index === mobileStep ? "border-primary bg-primary text-primary-foreground shadow-sm" : index < mobileStep ? "border-transparent bg-accent text-accent-foreground hover:border-primary/20" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`} type="button" aria-current={index === mobileStep ? "step" : undefined} onClick={() => goToStep(index)}>
                  <span className={`flex size-5 items-center justify-center rounded-full text-[9px] font-bold ${index === mobileStep ? "bg-white/18" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(440px,0.84fr)] 2xl:gap-8">
          <fieldset disabled={loadingDraft || finalizing} className="min-w-0 space-y-4 disabled:opacity-90" aria-label="Invoice form">
            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 0 ? "" : "hidden"} xl:block`}><div className="mb-6 flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold">Invoice details</h2><p className="mt-1 text-sm text-muted-foreground">Required fields are marked with an asterisk.</p></div><span className="rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-mono uppercase text-foreground/80">{invoiceNumber ? "Finalized" : "Draft"}</span></div><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr]"><Field label="Issue date" htmlFor="issue-date"><input id="issue-date" className="field" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></Field><Field label="Due date" htmlFor="due-date" required><input id="due-date" className="field" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field><Field label="Payment status" htmlFor="payment-status"><select id="payment-status" className="field" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as "unpaid" | "paid" | "overdue")}><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></Field></div></div>

            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 1 ? "" : "hidden"} xl:block`}><div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start"><SectionHeading eyebrow="From" title="Your company" description="Your company name is the main seller heading on the invoice." /><div className="flex flex-wrap items-center gap-2">{!authChecked ? <span className="text-xs text-muted-foreground">Checking session…</span> : accountEmail ? <><Button variant="outline" size="sm" type="button" disabled={loadingProfile || savingProfile} onClick={() => void loadSellerProfile()}>{loadingProfile ? "Loading…" : "Load saved profile"}</Button><Button variant="outline" size="sm" type="button" disabled={loadingProfile || savingProfile} onClick={() => void saveSellerProfile()}>{savingProfile ? "Saving…" : "Save as profile"}</Button></> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to use saved profile</Button>}<span className="basis-full text-xs text-muted-foreground" role="status">{sellerProfileStatus}</span></div></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="seller-company-name" required><input id="seller-company-name" className="field" placeholder="Your company name" value={sellerCompanyName} onChange={(event) => setSellerCompanyName(event.target.value)} /></Field><Field label="Seller name" htmlFor="seller-name" required><input id="seller-name" className="field" placeholder="Your full name" value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></Field><Field label="Email" htmlFor="seller-email"><input id="seller-email" className="field" type="email" placeholder="you@example.com" value={sellerEmail} onChange={(event) => setSellerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="seller-phone"><input id="seller-phone" className="field" placeholder="01XXXXXXXXX" value={sellerPhone} onChange={(event) => setSellerPhone(event.target.value)} /></Field><Field label="Address" htmlFor="seller-address" className="sm:col-span-2"><textarea id="seller-address" className="field min-h-24 resize-y" placeholder="Your address" value={sellerAddress} onChange={(event) => setSellerAddress(event.target.value)} /></Field></div><div className="mt-6 border-t border-border pt-6"><div className="mb-4"><h3 className="font-semibold">Company logo</h3><p className="mt-1 text-sm text-muted-foreground">Use a PNG, JPEG, or WebP logo up to 2 MB. It appears on new invoices and stays private.</p></div>{accountEmail ? <div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/50">{logoUrl ? <Image src={logoUrl} alt="Current company logo" width={96} height={96} unoptimized className="h-auto w-auto max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-xs text-muted-foreground">No logo</span>}</div><div className="min-w-0 flex-1 space-y-3"><input id="seller-logo-upload" className="block max-w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingLogo || Boolean(invoiceNumber)} onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ""; chooseLogo(chosen) }} /><div className="flex flex-wrap gap-2">{logoUrl && <Button variant="ghost" size="sm" type="button" disabled={uploadingLogo || Boolean(invoiceNumber)} onClick={() => void removeSellerLogo()}>Remove logo</Button>}</div>{uploadingLogo && <div aria-label="Logo upload progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={logoUploadProgress} aria-live="polite"><div className="h-2 overflow-hidden rounded-lg bg-muted"><div className="h-full rounded-lg bg-[#2e9be6] shadow-[0_0_8px_#2e9be6] transition-[width] duration-200" style={{ width: `${Math.max(8, logoUploadProgress)}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{logoUploadProgress >= 100 ? "Finalizing logo…" : `Uploading logo… ${logoUploadProgress}%`}</p></div>}{logoMessage && <p className="text-sm text-emerald-800" role="status">{logoMessage}</p>}{logoError && <p className="text-sm text-destructive" role="alert">{logoError}</p>}{invoiceNumber && <p className="text-xs text-muted-foreground">Logo changes apply to new invoices; this finalized invoice keeps its snapshot.</p>}</div></div> : <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground">Sign in to upload and reuse a company logo.</p>}</div></div>

            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 2 ? "" : "hidden"} xl:block`}><div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start"><SectionHeading eyebrow="Bill to" title="Customer company" description="The customer company name is the main buyer heading." /><div className="flex flex-wrap items-center gap-2">{!authChecked ? <span className="text-xs text-muted-foreground">Checking session…</span> : accountEmail ? <><Button variant="outline" size="sm" type="button" disabled={loadingCustomers || savingCustomer} onClick={() => void loadCustomers()}>{loadingCustomers ? "Loading…" : "Load saved customers"}</Button><Button variant="outline" size="sm" type="button" disabled={loadingCustomers || savingCustomer} onClick={() => void saveCustomer()}>{savingCustomer ? "Saving…" : selectedCustomerId ? "Update saved customer" : "Save customer"}</Button></> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to use saved customers</Button>}<span className="basis-full text-xs text-muted-foreground" role="status">{customerStatus}</span></div></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="buyer-company-name" required><input id="buyer-company-name" className="field" placeholder="Customer company name" value={buyerCompanyName} onChange={(event) => setBuyerCompanyName(event.target.value)} /></Field><Field label="Buyer name" htmlFor="buyer-name" required><input id="buyer-name" className="field" placeholder="Customer contact name" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></Field><Field label="Email" htmlFor="buyer-email"><input id="buyer-email" className="field" type="email" placeholder="customer@example.com" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="buyer-phone" required><input id="buyer-phone" className="field" placeholder="01XXXXXXXXX" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} required /></Field><Field label="Address" htmlFor="buyer-address" className="sm:col-span-2"><textarea id="buyer-address" className="field min-h-24 resize-y" placeholder="Customer address" value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} /></Field></div></div>

            <div className={`editor-section surface p-6 sm:p-8 ${mobileStep === 3 ? "" : "hidden"} xl:block`}>
              <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">04 · Line items</p>
                  <h2 className="mt-1 font-heading text-2xl font-medium tracking-[-0.02em]">What are you charging for?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Add a clear description, quantity, and unit price for each item.</p>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                  {accountEmail
                    ? <Button className="flex-1 sm:flex-none" variant="outline" size="sm" type="button" disabled={libraryLoading} onClick={() => void loadLibrary("items")}>{libraryLoading && libraryDrawer === "items" ? "Loading…" : "Load saved items"}</Button>
                    : <Button className="flex-1 sm:flex-none" variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to reuse items</Button>}
                  <Button className="flex-1 sm:flex-none" size="sm" type="button" onClick={addLine}><Plus data-icon="inline-start" />Add item</Button>
                </div>
              </div>

              <div className="mb-4 flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
                <div className="flex items-center gap-2"><span className="rounded-full bg-primary/10 px-2.5 py-1 font-mono font-semibold text-primary">{lines.length} {lines.length === 1 ? "item" : "items"}</span><span>in this invoice</span></div>
                <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-600" />Totals update automatically</span>
              </div>

              {lines.length > 0
                ? <ol className="space-y-3">
                    {lines.map((line, index) => <LineCard key={line.id} index={index} line={line} onChange={updateLine} onRemove={removeLine} onSave={saveReusableItem} canSave={Boolean(accountEmail)} saving={savingItemLineId === line.id} />)}
                  </ol>
                : <div className="well flex min-h-32 flex-col items-center justify-center px-4 py-7 text-center">
                    <p className="font-heading text-lg font-medium">Your ledger is ready</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">Add a product or service to calculate the invoice total.</p>
                  </div>}

              <button className={`mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card/50 px-3 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-primary sm:h-10 ${lines.length > 0 ? "hidden sm:flex" : "flex"}`} onClick={addLine} type="button">
                <Plus size={14} /> {lines.length > 0 ? "Add another item" : "Add your first item"}
              </button>

              <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-[minmax(0,1fr)_320px] sm:items-stretch sm:gap-6">
                <p className="self-center text-xs leading-5 text-muted-foreground">Discounts are applied to each line. The invoice keeps the original amount, discount, and final line total visible.</p>
                <div className="rounded-xl bg-primary p-4 text-primary-foreground shadow-[0_16px_32px_-20px_rgba(31,92,77,0.8)] sm:p-5">
                  <div className="flex justify-between gap-4 text-sm text-white/75"><span>Subtotal</span><span className="money">{formatMoney(subtotal)}</span></div>
                  <div className="mt-2 flex justify-between gap-4 text-sm text-white/75"><span>Total discount</span><span className="money">− {formatMoney(discount)}</span></div>
                  <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/20 pt-4">
                    <div><p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-white/60">Amount due</p><p className="mt-1 text-sm font-medium">Invoice total</p></div>
                    <output className="money text-2xl font-semibold tracking-[-0.03em]">{formatMoney(total)}</output>
                  </div>
                </div>
              </div>
            </div>

            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 4 ? "" : "hidden"} xl:block`}><div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start"><SectionHeading eyebrow="Optional" title="Notes and payment terms" description="Add a thank-you note or instructions for your customer." /><div className="flex flex-wrap gap-2">{accountEmail ? <><Button variant="outline" size="sm" type="button" disabled={libraryLoading} onClick={() => void loadLibrary("notes")}>{libraryLoading && libraryDrawer === "notes" ? "Loading…" : "Load saved notes"}</Button><Button variant="outline" size="sm" type="button" disabled={!notes.trim()} onClick={openNoteSaveDialog}>Save current note</Button></> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to reuse notes</Button>}</div></div><label className="block"><span className="sr-only">Notes and payment terms</span><textarea className="field min-h-28 resize-y" maxLength={10000} placeholder="Payment terms, delivery notes, or a thank-you message" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
          </fieldset>

          <section className={`min-w-0 xl:sticky xl:top-[6.5rem] ${mobileStep === 5 ? "" : "hidden"} xl:block`} aria-label="Invoice preview">
            <div className="surface-raised overflow-hidden p-4 xl:p-5">
              <div className="mb-5 flex items-center justify-between gap-4 px-1"><div><p className="eyebrow">Live document</p><h2 className="mt-2 font-heading text-2xl font-medium tracking-[-0.02em]">A4 portrait</h2><p className="mt-1 text-xs text-muted-foreground" role="status">PDF/DOCX estimate: {exportPageCount} page{exportPageCount === 1 ? "" : "s"}</p></div><Button variant="outline" size="sm" type="button" disabled={templateSaving} onClick={() => void openTemplateSettings()}><RotateCcw data-icon="inline-start" />{templateOpen ? "Close customize" : "Customize"}</Button></div>
            {templateOpen && <div className="mb-4 scroll-mb-24 scroll-mt-20 rounded-xl border border-border/80 bg-muted/35 p-4"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoice display</p><p className="mt-1 text-sm font-medium">Choose what appears on the invoice</p></div><Button variant="outline" size="sm" type="button" disabled={templateSaving} onClick={() => void saveTemplateSettings}>{templateSaving ? "Saving…" : accountEmail ? "Save template" : "Done"}</Button></div><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Accent color</span><select className="field" value={templateSettings.accent} onChange={(event) => setTemplateSettings((current) => ({ ...current, accent: event.target.value as TemplateSettings["accent"] }))}><option value="slate">Slate</option><option value="blue">Blue</option><option value="emerald">Emerald</option><option value="indigo">Indigo</option></select></label><div className="space-y-2 text-sm text-foreground/80"><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showAddresses} onChange={(event) => setTemplateSettings((current) => ({ ...current, showAddresses: event.target.checked }))} />Show addresses</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showSellerContact} onChange={(event) => setTemplateSettings((current) => ({ ...current, showSellerContact: event.target.checked }))} />Show seller contact</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showBuyerContact} onChange={(event) => setTemplateSettings((current) => ({ ...current, showBuyerContact: event.target.checked }))} />Show customer contact</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showNotes} onChange={(event) => setTemplateSettings((current) => ({ ...current, showNotes: event.target.checked }))} />Show notes</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showQuantityColumn} onChange={(event) => setTemplateSettings((current) => ({ ...current, showQuantityColumn: event.target.checked }))} />Show quantity column</label></div></div></div>}
              <div className="rounded-xl border border-stone-300/70 bg-[#e9e5dc] p-3 shadow-inner sm:p-5">

                        <div ref={previewRef} className="invoice-paper mx-auto max-w-[720px] rounded-none border border-slate-200 bg-white p-5 shadow-[0_35px_80px_-38px_rgba(28,38,33,0.5)] ring-1 ring-stone-900/5 sm:p-8"><div className={`flex items-start justify-between gap-6 border-b-2 pb-7 ${accentStyle.rule}`}><div>{logoUrl && <Image src={logoUrl} alt="Seller logo" width={96} height={48} unoptimized className="mb-3 h-auto w-auto max-h-12 max-w-24 object-contain object-left" />}<p className={`text-2xl font-bold tracking-tight ${accentStyle.heading}`}>{sellerCompanyName || "Your company name"}</p><p className="mt-1 text-sm font-medium text-slate-600">{sellerName || "Seller name"}</p>{templateSettings.showAddresses && <p className="mt-2 max-w-[220px] whitespace-pre-line text-xs leading-5 text-slate-500">{sellerAddress || "Your address"}</p>}{templateSettings.showSellerContact && (sellerEmail || sellerPhone) && <p className="mt-2 text-xs text-slate-500">{[sellerEmail, sellerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="text-right"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Invoice</p><p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{invoiceNumber || "DRAFT"}</p></div></div><div className="grid gap-6 border-b border-slate-200 py-7 text-sm sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Bill to</p><p className="mt-2 text-base font-bold">{buyerCompanyName || "Customer company"}</p><p className="mt-1 text-sm font-medium text-slate-600">{buyerName || "Buyer name"}</p>{templateSettings.showAddresses && <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-500">{buyerAddress || "Customer address"}</p>}{templateSettings.showBuyerContact && (buyerEmail || buyerPhone) && <p className="mt-1 text-xs text-slate-500">{[buyerEmail, buyerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="sm:text-right"><div className="flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Issue date</span><span className="font-medium">{formatDate(issueDate)}</span></div><div className="mt-2 flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Due date</span><span className="font-medium">{formatDate(dueDate)}</span></div></div></div><div className="py-5"><div className={`${previewLineGrid} border-b border-slate-200 pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400`}><span>Description</span>{templateSettings.showQuantityColumn && <span className="text-center">Qty</span>}<span className="text-right">Price</span><span className="text-right">Discount</span><span className="text-right">Amount</span></div>{lines.map((line) => { const amounts = getLineAmounts(line); return <div key={line.id} className={`${previewLineGrid} border-b border-slate-100 py-3 text-[10px] sm:text-xs`}><span className="break-words text-slate-700">{line.description || "Item description"}</span>{templateSettings.showQuantityColumn && <span className="text-center text-slate-500">{line.quantity || 0}</span>}<span className="text-right text-slate-500">{formatMoney(Number(line.unitPrice) || 0)}</span><span className="text-right text-slate-500">{amounts.discountAmount > 0 ? `− ${formatMoney(amounts.discountAmount)}` : "—"}</span><span className="text-right font-medium">{formatMoney(amounts.amount)}</span></div>})}</div><div className="ml-auto max-w-[320px] space-y-3 border-t border-slate-200 pt-5 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>{discount > 0 && <div className="flex justify-between text-slate-500"><span>Total discount</span><span>− {formatMoney(discount)}</span></div>}<div className={`flex justify-between border-t-2 pt-3 text-lg font-bold ${accentStyle.total}`}><span>Total</span><span>{formatMoney(total)}</span></div></div>{templateSettings.showNotes && notes && <div className="mt-8 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500"><p className="mb-1 font-semibold text-slate-700">Notes</p><p className="whitespace-pre-line">{notes}</p></div>}</div>
              </div>
              <div className="mt-5 border-t border-border/80 pt-5">{accountEmail && !invoiceNumber && <Button type="button" className="mb-3 h-11 w-full" disabled={finalizing || exporting || savingDraft} onClick={finalizeInvoice}>{finalizing ? "Finalizing…" : savingDraft ? "Saving draft…" : "Finalize invoice"}</Button>}<div className="grid gap-3 sm:grid-cols-2"><Button type="button" variant="outline" className="h-11" disabled={exporting || finalizing} onClick={() => exportInvoice("PDF")}><FileDown data-icon="inline-start" />Download PDF</Button><Button type="button" className="h-11" disabled={exporting || finalizing} onClick={() => exportInvoice("DOCX")}><FileDown data-icon="inline-start" />Download DOCX</Button></div>{message && <p className="mt-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">{message}</p>}<p className="mt-3 text-center text-xs text-muted-foreground">{accountEmail ? "Finalized invoices stay in your history. Revise as new when you need another version." : "Sign in later to save invoice history across devices."}</p></div>
            </div>

          </section>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_-24px_rgba(28,38,33,0.5)] backdrop-blur-xl xl:hidden">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button className="h-11 flex-1" variant="outline" type="button" disabled={mobileStep === 0} onClick={() => goToStep(mobileStep - 1)}>Back</Button>
          {mobileStep < mobileSteps.length - 1
            ? <Button className="h-11 flex-1" type="button" onClick={() => goToStep(mobileStep + 1)}>{mobileStep === mobileSteps.length - 2 ? "Review preview" : "Next"}</Button>
            : <Button className="h-11 flex-1" type="button" disabled={exporting || finalizing} onClick={() => void exportInvoice("PDF")}><FileDown data-icon="inline-start" />{exporting ? "Preparing…" : "Download PDF"}</Button>}
        </div>
      </div>
      {profileDrawer && <ProfileDrawer kind={profileDrawer} open={drawerOpen} onClose={closeProfileDrawer} sellerProfile={savedSellerProfile} sellerStatus={sellerProfileStatus} sellerLoading={loadingProfile} onApplySeller={applySellerProfile} customers={savedCustomers} customerStatus={customerStatus} customerLoading={loadingCustomers} onApplyCustomer={applyCustomer} />}
      {libraryDrawer && <SavedLibraryDrawer kind={libraryDrawer} items={savedItems} notes={savedNoteTemplates} query={libraryQuery} status={libraryStatus} loading={libraryLoading} onQueryChange={setLibraryQuery} onSearch={(query) => void loadLibrary(libraryDrawer, query)} onClose={() => setLibraryDrawer(null)} onAddItem={applySavedItem} onApplyNote={applySavedNote} onDelete={(id) => void deleteLibraryEntry(libraryDrawer, id)} />}
      {noteSaveOpen && <NoteSaveDialog title={noteSaveTitle} onTitleChange={setNoteSaveTitle} onClose={() => setNoteSaveOpen(false)} onSave={() => void saveNoteTemplate()} />}
      {finalizeConfirmOpen && <FinalizeConfirmDialog onClose={() => setFinalizeConfirmOpen(false)} onConfirm={() => void confirmFinalizeInvoice()} />}
      {pendingCrop && (
        <LogoCropper
          file={pendingCrop}
          onCancel={() => setPendingCrop(null)}
          onConfirm={(cropped) => {
            setPendingCrop(null)
            void uploadSellerLogo(cropped)
          }}
        />
      )}
    </main>
  )
}

function SavedLibraryDrawer({ kind, items, notes, query, status, loading, onQueryChange, onSearch, onClose, onAddItem, onApplyNote, onDelete }: { kind: "items" | "notes"; items: SavedItem[]; notes: SavedNoteTemplate[]; query: string; status: string; loading: boolean; onQueryChange: (value: string) => void; onSearch: (query: string) => void; onClose: () => void; onAddItem: (item: SavedItem) => void; onApplyNote: (note: SavedNoteTemplate, mode: "replace" | "append") => void; onDelete: (id: string) => void }) {
  const isItems = kind === "items"
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [onClose])
  return <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/45 backdrop-blur-[2px]" role="presentation" onClick={onClose}>
    <aside className="h-full w-full max-w-md overflow-y-auto bg-popover shadow-2xl shadow-stone-950/20 border-l border-border" role="dialog" aria-modal="true" aria-labelledby="library-drawer-title" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Saved library</p><h2 id="library-drawer-title" className="mt-1 text-lg font-semibold">{isItems ? "Saved items" : "Saved notes"}</h2></div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close saved library" onClick={onClose}><X /></Button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex gap-2"><input className="field min-w-0 flex-1" aria-label={`Search saved ${isItems ? "items" : "notes"}`} placeholder={isItems ? "Search item descriptions" : "Search note titles or text"} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(query) }} /><Button type="button" variant="outline" onClick={() => onSearch(query)}>Search</Button></div>
        {status && <p className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground" role="status">{status}</p>}
        {loading && <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground" role="status">Loading saved {isItems ? "items" : "notes"}…</p>}
        {!loading && isItems && items.length === 0 && <p className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground">No saved items found. Save a completed line from the invoice editor.</p>}
        {!loading && !isItems && notes.length === 0 && <p className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground">No saved notes found. Save the current invoice note to create one.</p>}
        {!loading && isItems && items.length > 0 && <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-lg border border-border p-4"><p className="font-semibold text-foreground">{item.description}</p><p className="mt-1 text-sm text-muted-foreground">Default price: {formatMoney(item.defaultUnitPrice)}</p><div className="mt-4 flex gap-2"><Button type="button" className="flex-1" onClick={() => onAddItem(item)}>Add to invoice</Button><Button type="button" variant="ghost" onClick={() => onDelete(item.id)}>Delete</Button></div></div>)}</div>}
        {!loading && !isItems && notes.length > 0 && <div className="space-y-3">{notes.map((note) => <div key={note.id} className="rounded-lg border border-border p-4"><p className="font-semibold text-foreground">{note.title}</p><p className="mt-2 whitespace-pre-line text-sm leading-5 text-muted-foreground">{note.body}</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" className="flex-1" onClick={() => onApplyNote(note, "replace")}>Replace notes</Button><Button type="button" variant="outline" className="flex-1" onClick={() => onApplyNote(note, "append")}>Append to notes</Button><Button type="button" variant="ghost" onClick={() => onDelete(note.id)}>Delete</Button></div></div>)}</div>}
      </div>
    </aside>
  </div>
}

function NoteSaveDialog({ title, onTitleChange, onClose, onSave }: { title: string; onTitleChange: (value: string) => void; onClose: () => void; onSave: () => void }) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [onClose])

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="w-full max-w-md surface p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="note-save-dialog-title" onClick={(event) => event.stopPropagation()}>
      <h2 id="note-save-dialog-title" className="text-lg font-semibold">Save reusable note</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Give this note a short title so you can recognize it later.</p>
      <label className="mt-5 block"><span className="mb-2 block text-sm font-medium text-foreground/80">Note title</span><input className="field" autoFocus maxLength={200} value={title} onChange={(event) => onTitleChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && title.trim()) onSave() }} placeholder="Payment terms" /></label>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!title.trim()} onClick={onSave}>Save note</Button></div>
    </section>
  </div>
}

function FinalizeConfirmDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [onClose])

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/45 px-4 backdrop-blur-[2px]" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="w-full max-w-md surface p-6 shadow-2xl shadow-stone-950/15" role="dialog" aria-modal="true" aria-labelledby="finalize-dialog-title" aria-describedby="finalize-dialog-description" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-800"><AlertTriangle aria-hidden="true" /></div>
        <div className="min-w-0">
          <h2 id="finalize-dialog-title" className="text-lg font-semibold text-foreground">Finalize this invoice?</h2>
          <p id="finalize-dialog-description" className="mt-2 text-sm leading-6 text-muted-foreground">Finalizing assigns a permanent invoice number. This action cannot be undone, and the invoice will be saved to your history.</p>
        </div>
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-10" onClick={onClose}>Cancel</Button>
        <Button type="button" className="h-10" autoFocus onClick={onConfirm}>Finalize invoice</Button>
      </div>
    </section>
  </div>
}

function ProfileDrawer({ kind, open, onClose, sellerProfile, sellerStatus, sellerLoading, onApplySeller, customers, customerStatus, customerLoading, onApplyCustomer }: { kind: "seller" | "customer"; open: boolean; onClose: () => void; sellerProfile: SavedSellerProfile | null; sellerStatus: string; sellerLoading: boolean; onApplySeller: () => void; customers: SavedCustomer[]; customerStatus: string; customerLoading: boolean; onApplyCustomer: (customerId: string) => void }) {
  const isSeller = kind === "seller"
  return <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/45 backdrop-blur-[2px]" role="presentation" onClick={onClose}>
    <aside className={`h-full w-full max-w-md overflow-y-auto bg-popover shadow-2xl shadow-stone-950/20 border-l border-border transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`} role="dialog" aria-modal="true" aria-labelledby="profile-drawer-title" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Saved details</p><h2 id="profile-drawer-title" className="mt-1 text-lg font-semibold">{isSeller ? "Load seller profile" : "Load saved customer"}</h2></div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close saved details" onClick={onClose}><X /></Button>
      </div>
      <div className="space-y-4 p-5">
        {isSeller ? <>
          {sellerLoading && <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground" role="status">Loading saved seller profile…</p>}
          {!sellerLoading && sellerProfile && <div className="rounded-lg border border-border p-4"><div className="space-y-3"><ProfileValue label="Company" value={sellerProfile.companyName} /><ProfileValue label="Seller" value={sellerProfile.sellerName} /><ProfileValue label="Email" value={sellerProfile.email} /><ProfileValue label="Phone" value={sellerProfile.phone} /><ProfileValue label="Address" value={sellerProfile.address} /></div><Button className="mt-5 w-full" type="button" onClick={onApplySeller}>Use this profile</Button></div>}
          {!sellerLoading && !sellerProfile && <div className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground"><p>{sellerStatus || "No saved seller profile found."}</p><p className="mt-2 text-xs text-muted-foreground">Save the seller details from the invoice page, then open this panel again.</p></div>}
        </> : <>
          {customerLoading && <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground" role="status">Loading saved customers…</p>}
          {!customerLoading && customers.length > 0 && <div className="space-y-3">{customers.map((customer) => <div key={customer.id} className="rounded-lg border border-border p-4"><p className="font-semibold text-foreground">{customer.companyName || "Customer"}</p><p className="mt-1 text-sm text-foreground/80">{customer.name}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{[customer.email, customer.phone, customer.address].filter(Boolean).join(" · ") || "No additional contact details"}</p><Button className="mt-4 w-full" type="button" variant="outline" onClick={() => onApplyCustomer(customer.id)}>Use this customer</Button></div>)}</div>}
          {!customerLoading && customers.length === 0 && <div className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground"><p>{customerStatus || "No saved customers found."}</p><p className="mt-2 text-xs text-muted-foreground">Save a customer from the invoice page, then open this panel again.</p></div>}
        </>}
      </div>
    </aside>
  </div>
}

function ProfileValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-line text-sm text-foreground/80">{value || "—"}</p></div>
}

function Field({ label, htmlFor, required, className = "", children }: { label: string; htmlFor: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={`block ${className}`} htmlFor={htmlFor}><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required && <span className="ml-1 text-destructive">*</span>}</span>{children}</label>
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-5"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p><h2 className="mt-1 font-heading text-2xl font-medium tracking-[-0.02em]">{title}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p></div>
}

function LineDiscountEditor({ line, onChange }: { line: LineItem; onChange: (id: number, patch: Partial<LineItem>) => void }) {
  const originalAmount = getLineAmounts(line).originalAmount
  const addon = line.discountType === "percentage" ? "%" : "৳"

  if (line.discountType === "none") {
    return <div className="col-span-2 xl:col-span-1">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Discount</span>
      <button aria-label={`Add discount item ${line.id}`} className="flex h-11 w-full items-center justify-center gap-1.5 border border-dashed border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-primary sm:h-9" onClick={() => onChange(line.id, { discountType: "percentage", discountValue: 0 })} type="button">
        <Plus size={14} /> Add discount
      </button>
    </div>
  }

  return <div className="col-span-2 xl:col-span-1">
    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Discount</span>
    <div className="grid min-w-0 grid-cols-[82px_minmax(0,1fr)_36px] gap-1.5 xl:grid-cols-[72px_minmax(0,1fr)_24px] xl:gap-1">
      <select id={`discount-type-${line.id}`} aria-label={`Discount type item ${line.id}`} className="field h-11 min-w-0 px-2 text-xs sm:h-9" value={line.discountType} onChange={(event) => onChange(line.id, { discountType: event.target.value as DiscountType })}>
        <option value="fixed">Fixed</option>
        <option value="percentage">Pct</option>
      </select>
      <label className="relative min-w-0">
        <span className="sr-only">Discount value</span>
        <input aria-label={`Discount value item ${line.id}`} className="field h-11 w-full min-w-0 px-2 pr-6 text-sm tnum sm:h-9 sm:text-xs sm:pr-5 xl:px-1.5 xl:pr-4" type="number" min={0} max={line.discountType === "percentage" ? 100 : originalAmount} step={1} value={line.discountValue} onChange={(event) => onChange(line.id, { discountValue: event.target.value === "" ? "" : Math.max(0, Number(event.target.value)) })} />
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/80 sm:right-1.5 xl:right-1">{addon}</span>
      </label>
      <button aria-label={`Remove discount item ${line.id}`} className="inline-flex size-10 items-center justify-center border border-border text-muted-foreground/80 transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-destructive sm:size-9 xl:size-6" onClick={() => onChange(line.id, { discountType: "none", discountValue: 0 })} title="Remove discount" type="button"><X size={14} /></button>
    </div>
  </div>
}

function LineCard({ line, index, onChange, onRemove, onSave, canSave, saving }: { line: LineItem; index: number; onChange: (id: number, patch: Partial<LineItem>) => void; onRemove: (id: number) => void; onSave: (line: LineItem) => void; canSave: boolean; saving: boolean }) {
  const amounts = getLineAmounts(line)
  const itemLabel = line.description.trim() || `Item ${index + 1}`

  return <li className="well min-w-0 list-none bg-card/80 p-3 shadow-[0_1px_1px_rgba(28,38,33,0.025)] xl:rounded-xl xl:p-4">
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/80 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-[11px] font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0"><p className="text-sm font-semibold text-foreground">Item {String(index + 1).padStart(2, "0")}</p><p className="truncate text-xs text-muted-foreground">{itemLabel}</p></div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canSave ? <button aria-label={`Save item ${index + 1} to library`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40" disabled={!line.description.trim() || saving} onClick={() => onSave(line)} title={line.description.trim() ? "Save to item library" : "Enter a description first"} type="button"><Save size={14} /> <span className="hidden sm:inline">Save</span></button> : null}
        <button aria-label={`Remove item ${index + 1}`} className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground/80 transition hover:bg-rose-500/10 hover:text-destructive" onClick={() => onRemove(line.id)} title="Remove this item" type="button"><Trash2 size={15} /></button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_92px_150px] xl:grid-cols-[minmax(0,1fr)_90px_150px]">
      <label className="col-span-full block min-w-0 sm:col-span-1">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</span>
        <input id={`description-${line.id}`} aria-label={`Item ${index + 1} description`} className="field h-11 w-full min-w-0 px-3 font-medium placeholder:font-normal placeholder:text-muted-foreground/80 sm:h-10" placeholder="e.g. Website design" value={line.description} onChange={(event) => onChange(line.id, { description: event.target.value })} />
      </label>
      <label className="block min-w-0">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Quantity</span>
        <input id={`quantity-${line.id}`} aria-label="Quantity" className="field h-11 w-full min-w-0 px-2 text-center text-base tnum sm:h-10 sm:text-sm" type="number" min={1} step={1} value={line.quantity} onChange={(event) => onChange(line.id, { quantity: event.target.value === "" ? "" : Math.max(1, Number(event.target.value)) })} />
      </label>
      <label className="relative block min-w-0">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Unit price</span>
        <input id={`price-${line.id}`} aria-label="Unit price" className="field h-11 w-full min-w-0 pl-7 pr-2 text-base tnum sm:h-10 sm:text-sm" type="number" min={0} step={1} value={line.unitPrice} onChange={(event) => onChange(line.id, { unitPrice: event.target.value === "" ? "" : Math.max(0, Number(event.target.value)) })} />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-3 left-2.5 text-xs font-medium text-muted-foreground/80 sm:bottom-2.5">৳</span>
      </label>
    </div>

    <div className="mt-3 flex flex-col gap-3 border-t border-border/80 pt-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1 sm:max-w-[390px]"><LineDiscountEditor line={line} onChange={onChange} /></div>
      <div className="flex items-center justify-between gap-5 sm:justify-end">
        <div className="text-right"><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Line total</span><output aria-label={`Line total item ${index + 1}`} className="money mt-1 block text-lg font-bold tracking-[-0.02em] text-foreground">{formatMoney(amounts.amount)}</output></div>
      </div>
    </div>
    {amounts.discountAmount > 0 && <p className="mt-2 text-right text-[11px] text-muted-foreground"><span className="money">{formatMoney(amounts.originalAmount)}</span> − <span className="money">{formatMoney(amounts.discountAmount)}</span> discount</p>}
  </li>
}
