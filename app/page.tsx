"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "cn"
import { AlertTriangle, ChevronDown, FileDown, Plus, RotateCcw, Save, ShieldCheck, Trash2, Undo2, UserRound, X } from "lucide-react"
import { useAdminStatus } from "@/components/admin-nav"
import { BrandLogo } from "@/components/brand-logo"

import { LogoCropper, type CroppedLogo } from "@/components/logo-cropper"
import { MAX_UPLOAD_BYTES } from "@/lib/image/crop"
import { clearCachedLogoUrl, resolveLogoImageUrl, type LogoImagePayload } from "@/lib/image/logo-url-cache"
import { clearSessionLogo, loadSessionLogo, saveSessionLogo, type SessionLogo } from "@/lib/image/session-logo"
import { SignOutButton } from "@/components/sign-out-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { estimateExportPageCount, exportPreviewAsDocx, exportPreviewAsPdf } from "@/lib/invoice/export"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { MoneyText } from "@/components/money-text"
import type { InvoiceDraft, TemplateSettings, CarriedForward } from "@/lib/invoice/types"
import { resolveBillToParty, formatMoney } from "@/lib/invoice/types"

type EditableNumber = number | ""
type LineItem = { id: number; description: string; quantity: EditableNumber; unitPrice: EditableNumber; discountType: DiscountType; discountValue: EditableNumber }
type DiscountType = "none" | "fixed" | "percentage"

const getDhakaDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Dhaka", year: "numeric" }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

// Due defaults to two weeks after the issue date, matching the reissue path in
// 0034 (`v_issue_date + 14`). Defaulting it to today made every new invoice due
// immediately and produced false overdue states on day one.
const addDaysIso = (iso: string, days: number) => {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return ""
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Money is formatted by the shared helper in lib/invoice/types. A local copy here
// had drifted (different rounding, and a literal taka sign that a shell-based edit
// had double-encoded), so the preview rendered "<taka sign>1,000" instead of "৳1,000".
const formatDateLong = (value: string) => {
  if (!value) return ""
  const parts = value.split("-").map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return ""
  const [year, month, day] = parts
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  if (month < 1 || month > 12 || day < 1 || day > 31) return ""
  return `${String(day).padStart(2, "0")} ${months[month - 1]} ${year}`
}
const diffDays = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 86_400_000)
}
const formatDate = (value: string) => {
  if (!value) return "—"
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}
// A new line starts empty, not pre-filled. Quantity 1 and unit price 0 made a
// fresh row read as a priced line at a glance, and the ledger's whole claim is
// that what you see is what has been entered. Blank also means the placeholder
// is doing its job: the cell says "0" in muted type until it holds a real 0.
// The autosave mapper coerces both on the way out (`Number(x) || 1`), so a
// stored draft still receives the 1 that the schema requires.
const newLine = (id: number): LineItem => ({ id, description: "", quantity: "", unitPrice: "", discountType: "none", discountValue: "" })
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
const defaultTemplateSettings: TemplateSettings = { accent: "slate", showAddresses: true, showSellerContact: true, showBuyerContact: true, showNotes: true, showQuantityColumn: true, showPaidStamp: true }
const mobileSteps = ["Details", "From", "Bill to", "Items", "Notes", "Preview"]

// One column template for the ledger header and every row, so the two cannot
// drift apart: `#` | description | qty | unit price | amount | row actions.
//
// The description is the only flexible column, and the five around it are sized to
// hold their worst case rather than their average, so the field a seller types into
// most reclaims the difference. Every numeric cell shares one 10px right inset,
// which is what lets a column of amounts be read down its right edge rather than
// down three slightly different ones.
//
//
// The ledger starts at `lg`, not `sm`: six columns inside the 640px panel left the
// description around 90px wide, so below `lg` the row is a stack, which is also
// the layout a touch device wants anyway. The actions column is 40px, one icon
// wide, because the row's actions stack vertically rather than sitting in a line.
//
// The three figure columns carry a border and 10px of inset now, where they used
// to be a bare rule against the column edge, so each is 16px wider than the text
// it holds needed. Widening them took space from the description, which is the one
// cell that has to hold a sentence, so the trade is deliberate rather than even.
const ledgerColumns = "lg:grid-cols-[22px_minmax(0,1fr)_72px_112px_128px_40px] xl:grid-cols-[20px_minmax(0,1fr)_80px_124px_140px_40px]"
// A row action, sitting on the row. Real buttons rather than menu items, so the
// states are the native ones: `disabled` greys the control instead of relying on
// Base UI's data-highlighted, and hover/focus styling is the same on all three.
const rowActionButton = "inline-flex size-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
const ledgerHeader = "hidden items-center gap-x-2.5 border-b border-border/70 pb-2.5 lg:grid"
// Shared by every numeric cell, header label included, so their left edges line up
// with the text inside the box each one sits over. Left, not right: a column of
// figures read down its left edge is the one a form does, and right-aligning three
// numbers of wildly different width while their heading sat over them made the
// columns look ragged rather than aligned.
const numericInset = "pl-2.5 text-left"
// Column headings. The sans face at light tracking replaced a letterspaced mono
// caps treatment that read as a dashboard widget rather than as a document; the
// token is solid, not a translucent variant, because /70 measured 1.9:1 on the
// card and the item-panel audit reports that as a failure.
const columnHeading = "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
const accentStyles = {
  slate: { rule: "border-slate-950", heading: "text-slate-900", total: "border-slate-950" },
  blue: { rule: "border-blue-700", heading: "text-blue-800", total: "border-blue-700" },
  emerald: { rule: "border-emerald-700", heading: "text-emerald-800", total: "border-emerald-700" },
  indigo: { rule: "border-indigo-700", heading: "text-indigo-800", total: "border-indigo-700" },
} as const
// TemplateSettings is imported from lib/invoice/types. A local copy used to
// shadow it, which silently dropped any new field (such as showPaidStamp) from
// this page's typing while the rest of the app saw the newer shape.

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
  paymentStatus?: "unpaid" | "partial" | "paid" | "overdue"
  templateSettings?: TemplateSettings
  logoAssetId?: string | null
  notes?: string
  carriedForward?: {
    amount?: number
    invoiceId?: string
    invoiceNumber?: string | null
    originalTotal?: number
    received?: number
  }
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
  // Holds the line a user just removed plus the index it came from, so removal can
  // be reversed in place. Removing a line used to be immediate and irreversible,
  // which made one stray tap on a 40px trash icon destroy a typed description and
  // its discount with no way back. Frictionless-to-undo beats a confirm modal
  // here, because the mistake is cheap to make and cheap to reverse.
  const [removedLine, setRemovedLine] = useState<{ line: LineItem; index: number } | null>(null)
  const undoTimer = useRef<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerCloseTimeout = useRef<number | null>(null)
  const [templateSettings, setTemplateSettings] = useState<TemplateSettings>(defaultTemplateSettings)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoAssetId, setLogoAssetId] = useState<string | null>(null)
  const [sessionLogo, setSessionLogo] = useState<SessionLogo | null>(null)
  const sessionLogoUrlRef = useRef<string | null>(null)
  const [pendingCrop, setPendingCrop] = useState<File | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoUploadProgress, setLogoUploadProgress] = useState(0)
  const [logoMessage, setLogoMessage] = useState("")
  const [logoError, setLogoError] = useState("")
  // The native file input is cleared after every pick so the same file can be
  // chosen twice in a row. That also wipes the browser's own "N file(s) chosen"
  // text, so the chosen name is mirrored here to keep the control's state visible.
  const [chosenLogoName, setChosenLogoName] = useState("")
  // Drag-and-drop needs its own state: `dragenter`/`dragleave` fire for every
  // child element, so a boolean derived from drag depth avoids flicker.
  const [logoDragDepth, setLogoDragDepth] = useState(0)
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
  const [dueTouched, setDueTouched] = useState(false)
  // Rendered under Due date. Same-day is valid (cash sales exist) but rare, so
  // it gets a confirming label rather than an error, while due-before-issue
  // stays a blocking error.
  const dateGap = diffDays(issueDate, dueDate)
  const dueHint = !issueDate || !dueDate
    ? "Uses Dhaka time (Asia/Dhaka). Shown as day month year, e.g. 26 Sep 2026."
    : dueDate < issueDate
      ? "Due date is before the issue date."
      : dateGap === 0
        ? "Due the same day it is issued."
        : `Due ${dateGap} days after issue (${formatDateLong(dueDate)}).`
  const [discountType, setDiscountType] = useState<DiscountType>("none")
  const [discountValue, setDiscountValue] = useState<EditableNumber>(0)
  // Drafts are always unpaid, so this is display state only: it drives the PAID
  // preview stamp and is always persisted as "unpaid". "partial" is kept in the
  // type because finalized documents loaded here can carry it.
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "partial" | "paid" | "overdue">("unpaid")
  const [notes, setNotes] = useState("")
  // Set only on an invoice raised to settle the balance of an earlier one. The
  // figures are a snapshot taken at raise time, not a live link, so the printed
  // document always shows what was true when it was issued.
  const [carriedForward, setCarriedForward] = useState<CarriedForward | null>(null)
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
      // Only prefill due when the user has not picked one: an explicit choice
      // must never be overwritten by a later issue-date change.
      setDueDate((current) => current || addDaysIso(today, 14))
    })
  }, [])

  // Keep due day count stable when the issue date moves: Net-14 terms mean the
  // gap stays 14 days.
  //
  // This stays an effect on purpose. Deriving it during render was tried and
  // broke the item cards: a setState during render re-renders the component and
  // replaces the freshly mounted input, so the requestAnimationFrame focus in
  // addLine landed on a node that was immediately thrown away.
  useEffect(() => {
    if (!issueDate || dueTouched) return
    // The rule flags any setState in an effect, but this one is a deliberate
    // post-paint sync, and deriving it during render demonstrably cost the item
    // cards their focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDueDate(addDaysIso(issueDate, 14))
  }, [issueDate, dueTouched])

  // Due before issue is a scheduling mistake, not a preference. It is blocked
  // here with an inline error before it can be autosaved, finalized, or
  // exported, so every exit path agrees.
  const dueBeforeIssue = Boolean(issueDate && dueDate && dueDate < issueDate)
  // Guards both finalize and export. ESLint reported this as unused, which it is
  // not: the rule appears to miss these two references inside the handlers.
  const datesInvalid = !issueDate || !dueDate || dueBeforeIssue

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
        setLogoAssetId(null)
        setPendingCrop(null)
        // The signed URL is a short-lived capability, so it does not outlive the
        // session that was allowed to use it.
        clearCachedLogoUrl()
        // A guest session logo should survive signing out.
        setLogoUrl(sessionLogoUrlRef.current ?? null)
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
      const result = await response.json() as { logo?: LogoImagePayload | null }
      if (!response.ok) return
      // Reuses the URL this tab already holds when the workspace still points at
      // the same asset, so the image comes from the browser cache instead of
      // being downloaded again behind a freshly signed URL.
      const imageUrl = resolveLogoImageUrl(result.logo)
      if (finalizedInvoiceLoaded.current) return
      setLogoAssetId(result.logo?.id ?? null)
      setLogoUrl(imageUrl)
    }).catch(() => undefined)
  }, [accountEmail])

  // A guest logo lives only in this browser, so it is restored on every reload.
  // A signed-in user's account logo loads separately and takes precedence.
  useEffect(() => {
    let active = true
    void loadSessionLogo().then((stored) => {
      if (!active || !stored?.blob) return
      const url = URL.createObjectURL(stored.blob)
      sessionLogoUrlRef.current = url
      setSessionLogo(stored)
      setLogoUrl(url)
    })
    return () => {
      active = false
      if (sessionLogoUrlRef.current) {
        URL.revokeObjectURL(sessionLogoUrlRef.current)
        sessionLogoUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const draftQueryId = searchParams.get("draft")
    const downloadQuery = searchParams.get("download")
    const requestedDownload = downloadQuery === "PDF" || downloadQuery === "DOCX" ? downloadQuery : null
    if (requestedDownload) void Promise.resolve().then(() => setRequestedExport(requestedDownload))
    if (!draftQueryId || loadedDraftId.current === draftQueryId) return
    let active = true
    setLoadingDraft(true)
    setMessage("Loading draft⬦")

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
      setDueDate(document.dueDate ?? (document.issueDate ? addDaysIso(document.issueDate, 14) : addDaysIso(getDhakaDate(), 14)))
      setDueTouched(Boolean(document.dueDate))
      setDiscountType(document.discountType ?? "none")
      setDiscountValue(typeof document.discountValue === "number" ? document.discountValue : 0)
      // Drafts are always unpaid: the ledger derives "partial", so restoring a
      // stored status and autosaving would silently relabel paid history.
      setPaymentStatus("unpaid")
      // Only restored when the snapshot is complete, so a half-written document
      // cannot render a carried-forward block with missing or NaN figures.
      setCarriedForward(document.carriedForward?.invoiceId && typeof document.carriedForward.amount === "number"
        ? {
            amount: document.carriedForward.amount,
            invoiceId: document.carriedForward.invoiceId,
            invoiceNumber: document.carriedForward.invoiceNumber ?? null,
            originalTotal: document.carriedForward.originalTotal ?? 0,
            received: document.carriedForward.received ?? 0,
          }
        : null)
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
  // Announcing the total on every keystroke made typing a price unusable with a
  // screen reader: "taka five, taka fifty, taka five hundred, taka five thousand".
  // The figure a seller needs is the settled one, so the announcement waits for
  // typing to pause. 600ms is long enough to cover a pause mid-number and short
  // enough that the total still feels live.
  const [announcedTotal, setAnnouncedTotal] = useState("")
  useEffect(() => {
    const handle = window.setTimeout(() => setAnnouncedTotal(`Invoice total ${formatMoney(total)}`), 600)
    return () => window.clearTimeout(handle)
  }, [total])
  const accentStyle = accentStyles[templateSettings.accent]
  const previewLineGrid = templateSettings.showQuantityColumn
    ? "grid grid-cols-[minmax(0,1fr)_22px_38px_50px_50px] gap-1 sm:grid-cols-[minmax(0,1fr)_42px_72px_72px_86px] sm:gap-2"
    : "grid grid-cols-[minmax(0,1fr)_38px_50px_50px] gap-1 sm:grid-cols-[minmax(0,1fr)_82px_72px_86px] sm:gap-2"
  // A buyer company is deliberately not part of this gate: an invoice may be
  // billed to an individual, in which case the buyer name carries the heading.
  const incomplete = !sellerCompanyName.trim() || !sellerName.trim() || !buyerName.trim() || !buyerPhone.trim() || lines.length === 0 || lines.some((line) => !line.description.trim() || line.quantity === "" || Number(line.quantity) < 1 || line.unitPrice === "" || Number(line.unitPrice) < 0 || (line.discountType === "percentage" && Number(line.discountValue) > 100) || (line.discountType === "fixed" && Number(line.discountValue) > Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0)))
  const billTo = useMemo(
    () => resolveBillToParty({ companyName: buyerCompanyName, name: buyerName }),
    [buyerCompanyName, buyerName],
  )
  // The readout is the single place that explains what the heading will be, so the
  // rest of the section does not repeat the rule. It distinguishes "nothing entered
  // yet" from a real value: without that, resolveBillToParty's "Buyer name"
  // placeholder renders in the same weight and colour as a typed company name.
  const hasBillToParty = Boolean(buyerCompanyName.trim() || buyerName.trim())
  const headingNote = !hasBillToParty
    ? "Enter a company or buyer name to set the heading."
    : !buyerCompanyName.trim()
      ? "No company name set, so the buyer name becomes the heading."
      : ""
  // The PAID stamp only appears on a finalized invoice that has cleared. A draft
  // is not a demand for money yet, and a part-paid invoice still is, so stamping
  // either would be a false statement on a document of record.
  const paidStamp = Boolean(invoiceNumber && templateSettings.showPaidStamp && paymentStatus === "paid")

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (previewRef.current) setExportPageCount(estimateExportPageCount(previewRef.current))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [buyerAddress, buyerCompanyName, buyerEmail, buyerName, buyerPhone, discount, dueDate, issueDate, lines, logoUrl, notes, sellerAddress, sellerCompanyName, sellerEmail, sellerName, sellerPhone, templateSettings])

  useEffect(() => {
    // Due-before-issue is never persisted: autosaving it would store a schedule
    // the finalize and export guards already refuse, leaving the draft behind.
    if (!accountEmail || loadingDraft || !issueDate || !dueDate || dueBeforeIssue || incomplete) return

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
        // Drafts are always unpaid: the ledger derives the real status after
        // finalizing, so persisting anything else would disagree with it.
        paymentStatus: "unpaid",
        templateSettings,
        logoAssetId,
        notes,
        ...(carriedForward ? { carriedForward } : {}),
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
      if (nextRequest.generation === autosaveGeneration.current) setSaveState("Saving⬦")
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
  }, [accountEmail, buyerAddress, buyerCompanyName, buyerEmail, buyerName, buyerPhone, carriedForward, discountType, discountValue, dueBeforeIssue, dueDate, incomplete, invoiceNumber, issueDate, lines, loadingDraft, logoAssetId, notes, sellerAddress, sellerCompanyName, sellerEmail, sellerName, sellerPhone, templateSettings])

  const updateLine = (id: number, patch: Partial<LineItem>) => setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  const removeLine = (id: number) => {
    // Captured from the current render's `lines` so the index is known before the
    // state update lands. Guarded because a double-tap on the same trash icon
    // would otherwise find no matching line and arm a stale undo.
    const index = lines.findIndex((line) => line.id === id)
    if (index === -1) return
    // Read only. `lines` is React state and must never be spliced in place, or the
    // array identity is preserved while its contents change, and the undo copy
    // would alias the very row we are about to delete.
    const line = lines[index]
    setRemovedLine({ line, index })
    setLines((current) => current.filter((entry) => entry.id !== id))
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setRemovedLine(null), 8000)
  }

  // Undo puts the line back where it was, not at the end, so a seller who
  // deletes the wrong row out of three keeps their mental ordering intact.
  const restoreRemovedLine = () => {
    if (!removedLine) return
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    setLines((current) => {
      const next = [...current]
      next.splice(Math.min(removedLine.index, next.length), 0, removedLine.line)
      return next
    })
    setRemovedLine(null)
    window.requestAnimationFrame(() => document.getElementById(`description-${removedLine.line.id}`)?.focus())
  }

  const addLine = () => {
    const id = nextLineId.current++
    setLines((current) => [...current, newLine(id)])
    window.requestAnimationFrame(() => document.getElementById(`description-${id}`)?.focus())
  }

  // Enter advances through the row, and on the last row creates the next one. A
  // seller billing ten lines should be able to type straight down the list
  // without ever reaching for the mouse.
  const advanceFromLine = (index: number, field: "description" | "quantity" | "price") => {
    const order: Array<"description" | "quantity" | "price"> = ["description", "quantity", "price"]
    const current = order.indexOf(field)
    if (current < order.length - 1) {
      document.getElementById(`${order[current + 1]}-${lines[index].id}`)?.focus()
      return
    }
    if (index < lines.length - 1) {
      document.getElementById(`description-${lines[index + 1].id}`)?.focus()
      return
    }
    addLine()
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
  const showSessionLogo = (stored: SessionLogo) => {
    if (sessionLogoUrlRef.current) URL.revokeObjectURL(sessionLogoUrlRef.current)
    const url = URL.createObjectURL(stored.blob)
    sessionLogoUrlRef.current = url
    setSessionLogo(stored)
    setLogoAssetId(null)
    setLogoUrl(url)
  }

  const applyGuestLogo = async (logo: CroppedLogo) => {
    const stored: SessionLogo = { blob: logo.file, name: logo.file.name, width: logo.width, height: logo.height }
    await saveSessionLogo(stored)
    showSessionLogo(stored)
    setLogoMessage("Logo added for this browser session only. Sign in to keep it.")
  }

  const removeGuestLogo = async () => {
    await clearSessionLogo()
    if (sessionLogoUrlRef.current) {
      URL.revokeObjectURL(sessionLogoUrlRef.current)
      sessionLogoUrlRef.current = null
    }
    setSessionLogo(null)
    setLogoAssetId(null)
    setLogoUrl(null)
    setLogoMessage("Session logo removed.")
  }

  const promoteSessionLogo = () => {
    if (!sessionLogo) return
    void uploadSellerLogo({
      file: new File([sessionLogo.blob], sessionLogo.name, { type: sessionLogo.blob.type }),
      width: sessionLogo.width ?? 0,
      height: sessionLogo.height ?? 0,
    })
  }

  const chooseLogo = (file: File | undefined) => {
    if (!file) return
    setLogoMessage("")
    if (file.size > MAX_UPLOAD_BYTES) {
      setLogoError("That image is larger than 2 MB. Choose a smaller file.")
      return
    }
    setLogoError("")
    setChosenLogoName(file.name)
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
      const response = JSON.parse(result.body) as { logo?: LogoImagePayload; error?: string }
      if (result.status < 200 || result.status >= 300) throw new Error(response.error ?? "Logo could not be uploaded.")
      setLogoUploadProgress(100)
      const remainingVisibleTime = Math.max(0, 700 - (Date.now() - uploadStartedAt))
      if (remainingVisibleTime > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingVisibleTime))
      // The account logo now supersedes any guest session copy.
      if (sessionLogoUrlRef.current) {
        URL.revokeObjectURL(sessionLogoUrlRef.current)
        sessionLogoUrlRef.current = null
      }
      setSessionLogo(null)
      void clearSessionLogo()
      setLogoAssetId(response.logo?.id ?? null)
      setLogoUrl(resolveLogoImageUrl(response.logo))
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
      clearCachedLogoUrl()
      setLogoAssetId(null)
      setLogoUrl(null)
      setChosenLogoName("")
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
    setSellerProfileStatus("Checking your sign-in⬦")
    if (!(await ensureAuthenticated())) {
      setSellerProfileStatus("Sign in to load or save profiles.")
      return
    }
    setSellerProfileStatus("Loading saved profile⬦")
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
    setSellerProfileStatus("Checking your sign-in⬦")
    if (!(await ensureAuthenticated())) {
      setSellerProfileStatus("Sign in to load or save profiles.")
      return
    }
    setSellerProfileStatus("Saving seller profile⬦")
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
    setCustomerStatus("Checking your sign-in⬦")
    if (!(await ensureAuthenticated())) {
      setCustomerStatus("Sign in to load or save customers.")
      return
    }
    setCustomerStatus("Loading saved customers⬦")
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
    setCustomerStatus("Checking your sign-in⬦")
    if (!(await ensureAuthenticated())) {
      setCustomerStatus("Sign in to load or save customers.")
      return
    }
    setCustomerStatus("Saving customer⬦")
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
    if (datesInvalid) {
      setMessage(dueBeforeIssue ? "Move the due date to the issue date or later before finalizing." : "Choose an issue date and a due date before finalizing.")
      return
    }
    if (incomplete) {
      setMessage("Complete the required seller name, buyer name, buyer phone, and line-item fields before finalizing.")
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
    setMessage("Finalizing invoice⬦")
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
    if (datesInvalid) {
      setMessage(dueBeforeIssue ? "Move the due date to the issue date or later before exporting." : "Choose an issue date and a due date before exporting.")
      return
    }
    if (incomplete) {
      setMessage("Add your seller name, the buyer name, the buyer phone, and a description for every item before exporting.")
      return
    }
    if (!previewRef.current) return

    setExporting(true)
    setMessage(`Preparing ${format}⬦`)
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
    if (incomplete || datesInvalid || !previewRef.current) return
    const format = requestedExport
    void Promise.resolve().then(async () => {
      setRequestedExport(null)
      setExporting(true)
      setMessage(`Preparing ${format}⬦`)
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
  }, [accountEmail, datesInvalid, exporting, incomplete, invoiceNumber, loadingDraft, requestedExport])

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <header className="glass-header sticky top-0 z-40">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          <BrandLogo />
          {!authChecked ? <span className="text-xs text-muted-foreground">Checking session⬦</span> : accountEmail ? <div className="flex items-center gap-2">{isAdmin && <Link className={`${buttonVariants({ variant: "outline", size: "sm" })} hidden sm:inline-flex`} href="/admin/allowlist"><ShieldCheck data-icon="inline-start" />Admin</Link>}<Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/invoices"><UserRound data-icon="inline-start" />View history</Link><SignOutButton /></div> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}><UserRound data-icon="inline-start" /><span className="sm:hidden">Sign in</span><span className="hidden sm:inline">Sign in to save</span></Button>}
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
            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 0 ? "" : "hidden"} xl:block`}>
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <SectionHeading
                  description="Issue date is when the work is billed. Due date defaults to 14 days later (Net-14)."
                  eyebrow="01 · Schedule"
                  title="Invoice details"
                />
                {/* text-foreground rather than text-muted-foreground: the muted pair
                    measured 4.4:1 against --muted, just under the 4.5:1 that 10px
                    text needs. The badge still reads as secondary next to the
                    finalised state, which carries its own emerald treatment. */}
                <span className={`badge-sharp mt-1 shrink-0 ${invoiceNumber ? "border-emerald-700/25 bg-emerald-50 text-emerald-900" : "border-border bg-muted text-foreground"}`}>
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${invoiceNumber ? "bg-emerald-600" : "bg-stone-400"}`} />
                  {invoiceNumber ? "Finalized" : "Draft"}
                </span>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr]">
                <Field label="Issue date" htmlFor="issue-date" required hint={issueDate ? `Billed ${formatDateLong(issueDate)}.` : "Uses Dhaka time (Asia/Dhaka)."}>
                  <input id="issue-date" className="field" type="date" required aria-required="true" aria-describedby="issue-date-hint" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
                </Field>
                <Field label="Due date" htmlFor="due-date" required hint={dueHint}>
                  <input id="due-date" className="field" type="date" required aria-required="true" aria-describedby="due-date-hint" aria-invalid={dueBeforeIssue ? true : undefined} min={issueDate || undefined} value={dueDate} onChange={(event) => { setDueTouched(true); setDueDate(event.target.value) }} />
                  {dueBeforeIssue && <p className="mt-1.5 text-xs font-medium leading-5 text-destructive" role="alert">Due date cannot be before the issue date.</p>}
                </Field>
                <Field label="Payment status" htmlFor="payment-status" hint={invoiceNumber ? "Managed from history after finalizing." : "New invoices start as Unpaid."}>
                  <select id="payment-status" className="field" aria-describedby="payment-status-hint" value="unpaid" disabled aria-disabled="true">
                    <option value="unpaid">Unpaid</option>
                  </select>
                </Field>
              </div>
            </div>

            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 1 ? "" : "hidden"} xl:block`}><div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start"><SectionHeading eyebrow="From" title="Your company" description="Your company name is the main seller heading on the invoice. Fields marked with an asterisk are required." /><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{!authChecked ? <span className="text-xs text-muted-foreground">Checking session⬦</span> : accountEmail ? <><Button className="h-11 sm:h-9" variant="outline" type="button" disabled={loadingProfile || savingProfile} onClick={() => void loadSellerProfile()}>{loadingProfile ? "Loading⬦" : "Load saved profile"}</Button><Button className="h-11 sm:h-9" variant="default" type="button" disabled={loadingProfile || savingProfile} onClick={() => void saveSellerProfile()}>{savingProfile ? "Saving⬦" : "Save as profile"}</Button></> : <Button className="h-11 sm:h-9" variant="outline" type="button" onClick={() => router.push("/auth/login")}>Sign in to use saved profile</Button>}<span className="basis-full text-xs text-muted-foreground" role="status">{sellerProfileStatus}</span></div></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="seller-company-name" required><input aria-required="true" autoComplete="organization" className="field" id="seller-company-name" maxLength={500} placeholder="Your company name" required value={sellerCompanyName} onChange={(event) => setSellerCompanyName(event.target.value)} /></Field><Field label="Seller name" htmlFor="seller-name" required><input aria-required="true" autoComplete="name" className="field" id="seller-name" maxLength={500} placeholder="Your full name" required value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></Field><Field label="Email" htmlFor="seller-email" optional><input autoComplete="email" className="field" id="seller-email" inputMode="email" type="email" placeholder="you@example.com" value={sellerEmail} onChange={(event) => setSellerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="seller-phone" optional><input autoComplete="tel" className="field" id="seller-phone" inputMode="tel" maxLength={100} placeholder="01XXXXXXXXX" value={sellerPhone} onChange={(event) => setSellerPhone(event.target.value)} /></Field><Field label="Address" htmlFor="seller-address" className="sm:col-span-2" optional><textarea autoComplete="street-address" className="field min-h-24 resize-y" id="seller-address" maxLength={2000} placeholder="Your address" value={sellerAddress} onChange={(event) => setSellerAddress(event.target.value)} /></Field></div><div className="mt-6 border-t border-border pt-6"><div className="mb-4"><h3 className="font-semibold">Company logo</h3><p className="mt-1 text-sm text-muted-foreground" id="seller-logo-help">Use a PNG, JPEG, or WebP logo up to 2 MB. It appears on new invoices and stays private.</p></div>{accountEmail ? <div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className={cn("flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50 transition", logoDragDepth > 0 ? "border-primary bg-accent ring-2 ring-ring/25" : "border-dashed border-border")} onDragEnter={(event) => { event.preventDefault(); setLogoDragDepth((depth) => depth + 1) }} onDragLeave={(event) => { event.preventDefault(); setLogoDragDepth((depth) => Math.max(0, depth - 1)) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }} onDrop={(event) => { event.preventDefault(); setLogoDragDepth(0); chooseLogo(event.dataTransfer.files?.[0]) }}>{logoUrl ? <Image alt="Current company logo" className="h-auto w-auto max-h-full max-w-full object-contain" height={96} src={logoUrl} unoptimized width={96} /> : <span className="px-2 text-center text-xs text-muted-foreground">{logoDragDepth > 0 ? "Drop to upload" : "No logo"}</span>}</div><div className="min-w-0 flex-1 space-y-3"><input accept="image/png,image/jpeg,image/webp" aria-describedby="seller-logo-help seller-logo-file" aria-invalid={logoError ? true : undefined} className="block max-w-full min-h-11 text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground" disabled={uploadingLogo || Boolean(invoiceNumber)} id="seller-logo-upload" onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ""; chooseLogo(chosen) }} onDragEnter={(event) => { event.preventDefault(); setLogoDragDepth((depth) => depth + 1) }} onDragLeave={(event) => { event.preventDefault(); setLogoDragDepth((depth) => Math.max(0, depth - 1)) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }} onDrop={(event) => { event.preventDefault(); setLogoDragDepth(0); chooseLogo(event.dataTransfer.files?.[0]) }} type="file" />{chosenLogoName && <p className="text-xs text-muted-foreground" id="seller-logo-file">Selected: {chosenLogoName}</p>}<div className="flex flex-wrap gap-2">{sessionLogo && <Button className="h-11 sm:h-9" variant="outline" type="button" disabled={uploadingLogo || Boolean(invoiceNumber)} onClick={promoteSessionLogo}>Save session logo to my account</Button>}{logoUrl && <Button className="h-11 sm:h-9" variant="destructive" type="button" disabled={uploadingLogo || Boolean(invoiceNumber)} onClick={() => void removeSellerLogo()}>Remove logo</Button>}</div>{sessionLogo && <p className="text-xs text-muted-foreground">Showing the session logo. Save it to your account to keep it permanently.</p>}{uploadingLogo && <div aria-label="Logo upload progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={logoUploadProgress} aria-live="polite"><div className="h-2 overflow-hidden rounded-lg bg-muted"><div className="h-full rounded-lg bg-[#2e9be6] shadow-[0_0_8px_#2e9be6] transition-[width] duration-200" style={{ width: `${Math.max(8, logoUploadProgress)}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{logoUploadProgress >= 100 ? "Finalizing logo⬦" : `Uploading logo⬦ ${logoUploadProgress}%`}</p></div>}{logoMessage && <p className="text-sm text-emerald-800" role="status">{logoMessage}</p>}{logoError && <p className="text-sm text-destructive" role="alert">{logoError}</p>}{invoiceNumber ? <p className="text-xs text-muted-foreground">This invoice is finalized, so the logo is locked. Logo changes apply to new invoices; this one keeps its snapshot.</p> : uploadingLogo ? null : <p className="text-xs text-muted-foreground">Choose a file or drop an image onto the preview.</p>}</div></div> : <div className="space-y-3"><div className="flex items-center gap-4"><div className={cn("flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50 transition", logoDragDepth > 0 ? "border-primary bg-accent ring-2 ring-ring/25" : "border-dashed border-border")} onDragEnter={(event) => { event.preventDefault(); setLogoDragDepth((depth) => depth + 1) }} onDragLeave={(event) => { event.preventDefault(); setLogoDragDepth((depth) => Math.max(0, depth - 1)) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }} onDrop={(event) => { event.preventDefault(); setLogoDragDepth(0); chooseLogo(event.dataTransfer.files?.[0]) }}>{logoUrl ? <Image src={logoUrl} alt="Session company logo" width={96} height={96} unoptimized className="h-auto w-auto max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-xs text-muted-foreground">{logoDragDepth > 0 ? "Drop to upload" : "No logo"}</span>}</div><div className="min-w-0"><p className="text-sm font-medium">Session logo</p><p className="mt-1 text-xs text-muted-foreground">{sessionLogo ? `Using ${sessionLogo.name} in this browser only.` : "Optional. Add one to brand this invoice."}</p></div></div><input id="seller-logo-upload-guest" aria-describedby="seller-logo-help seller-logo-file-guest" className="block max-w-full min-h-11 text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a session logo" aria-invalid={logoError ? true : undefined} onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ""; chooseLogo(chosen) }} onDragEnter={(event) => { event.preventDefault(); setLogoDragDepth((depth) => depth + 1) }} onDragLeave={(event) => { event.preventDefault(); setLogoDragDepth((depth) => Math.max(0, depth - 1)) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }} onDrop={(event) => { event.preventDefault(); setLogoDragDepth(0); chooseLogo(event.dataTransfer.files?.[0]) }} />{chosenLogoName && <p className="text-xs text-muted-foreground" id="seller-logo-file-guest">Selected: {chosenLogoName}</p>}<div className="flex flex-wrap items-center gap-2">{sessionLogo && <Button className="h-11 sm:h-9" variant="destructive" type="button" onClick={() => void removeGuestLogo()}>Remove</Button>}<Button className="h-11 sm:h-9" variant="outline" type="button" onClick={() => router.push("/auth/login")}>Sign in to keep a logo</Button></div><p className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-950">Guest logos are kept in this browser only. Nothing is uploaded, and the logo disappears when you clear your browser data. Sign in to save it to your account and reuse it on every invoice.</p>{logoError && <p className="text-sm text-destructive" role="alert">{logoError}</p>}{logoMessage && <p className="text-sm text-emerald-800" role="status">{logoMessage}</p>}</div>}</div></div>

            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 2 ? "" : "hidden"} xl:block`}><div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start"><SectionHeading eyebrow="Bill to" title="Who you are billing" description="Bill a company or a person. Company name is optional." /><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{!authChecked ? <span className="text-xs text-muted-foreground">Checking session⬦</span> : accountEmail ? <><Button variant="outline" size="sm" type="button" disabled={loadingCustomers || savingCustomer} onClick={() => void loadCustomers()}>{loadingCustomers ? "Loading⬦" : "Load saved customers"}</Button><Button variant="outline" size="sm" type="button" disabled={loadingCustomers || savingCustomer} onClick={() => void saveCustomer()}>{savingCustomer ? "Saving⬦" : "Save customer"}</Button>{selectedCustomerId && <span className="text-xs text-muted-foreground">updates this saved customer</span>}</> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to use saved customers</Button>}<span className="basis-full text-xs text-muted-foreground" role="status">{customerStatus}</span></div></div><div className="mb-5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs"><span className="font-medium uppercase tracking-wide text-muted-foreground">Bill-to heading</span><span aria-live="polite" className={`ml-2 font-semibold ${hasBillToParty ? "text-foreground" : "font-normal text-muted-foreground"}`}>{hasBillToParty ? billTo.heading : "Not set yet"}</span>{headingNote && <span className="mt-1 block text-muted-foreground">{headingNote}</span>}</div><div className="grid gap-5 sm:grid-cols-2"><Field label="Buyer name" htmlFor="buyer-name" required><input autoComplete="name" className="field" id="buyer-name" maxLength={500} placeholder="e.g. Rahim Uddin" required value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></Field><Field label="Company name" htmlFor="buyer-company-name" optional><input autoComplete="organization" className="field" id="buyer-company-name" maxLength={500} placeholder="e.g. Acme Ltd" value={buyerCompanyName} onChange={(event) => setBuyerCompanyName(event.target.value)} /></Field><Field label="Email" htmlFor="buyer-email" optional><input autoComplete="email" className="field" id="buyer-email" inputMode="email" type="email" placeholder="customer@example.com" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="buyer-phone" required><input autoComplete="tel" className="field" id="buyer-phone" inputMode="tel" maxLength={100} placeholder="01XXXXXXXXX" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} required /></Field><Field label="Address" htmlFor="buyer-address" className="sm:col-span-2" optional><textarea autoComplete="street-address" className="field min-h-24 resize-y" id="buyer-address" maxLength={2000} placeholder="Customer address" value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} /></Field></div></div>

            <div className={`editor-section surface p-6 sm:p-8 ${mobileStep === 3 ? "" : "hidden"} xl:block`}>
              <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
                <SectionHeading
                  description="Add a clear description, quantity, and unit price for each item. Press Enter in the last field to add another."
                  eyebrow="04 · Line items"
                  title="What are you charging for?"
                />
                {/* Only the library action lives here. "Add item" used to sit beside it
                    as well as below the list, which put two competing add buttons on
                    screen at once. The one at the end of the list is where a seller
                    finishes a row, so that is the one that was kept. */}
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                  {accountEmail
                    ? <Button className="h-11 flex-1 sm:h-9 sm:flex-none" variant="outline" size="sm" type="button" disabled={libraryLoading} onClick={() => void loadLibrary("items")}>{libraryLoading && libraryDrawer === "items" ? "Loading⬦" : "Load saved items"}</Button>
                    : <Button className="h-11 flex-1 sm:h-9 sm:flex-none" variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to reuse items</Button>}
                </div>
              </div>

              {/* The item count and the "totals update automatically" reassurance used to
                  occupy a whole row here. The count restates what the cards below
                  already show, and totals visibly moving is a better cue than a caption
                  promising they will, so the row is gone. */}

              {/* Column headings, on the same template as the rows so each label sits
                  over the values it names. "Actions" was a heading over an empty
                  column: the row's only control is an icon carrying its own name, so
                  labelling that column told a seller nothing it did not already know. */}
              {lines.length > 0 && <div aria-hidden="true" className={`mb-1 ${ledgerHeader} ${ledgerColumns}`}>
                <span className={columnHeading}>#</span>
                <span className={columnHeading}>Description</span>
                <span className={`${columnHeading} ${numericInset}`}>Qty</span>
                <span className={`${columnHeading} ${numericInset}`}>Unit price <span className="taka">৳</span></span>
                <span className={`${columnHeading} ${numericInset}`}>Amount</span>
                <span />
              </div>}

              {lines.length > 0
                ? <ol aria-label="Invoice line items" className="line-items divide-y divide-border/40">
                    {lines.map((line, index) => <LineCard key={line.id} index={index} line={line} isLast={index === lines.length - 1} onChange={updateLine} onRemove={removeLine} onAdvance={advanceFromLine} onSave={saveReusableItem} canSave={Boolean(accountEmail)} saving={savingItemLineId === line.id} />)}
                  </ol>
                : <div className="well flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-8 text-center">
                    <p className="font-heading text-lg font-medium text-foreground">No items yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">Add a product or service below to calculate the invoice total.</p>
                  </div>}

              {/* One add control, and it follows the list rather than framing it: a
                  seller finishes a row and reaches for the next one, so this sits
                  where they are looking. It is a quiet text affordance rather than
                  another outlined bar, which on a ledger read as an extra row. */}
              <button className={`mt-1 inline-flex h-9 touch-manipulation items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-primary ${lines.length > 0 ? "sticky bottom-20 z-10 lg:static" : ""}`} onClick={addLine} type="button">
                <Plus aria-hidden="true" size={14} className="text-primary" /> {lines.length > 0 ? "Add another item" : "Add your first item"}
              </button>

              {/* Removal is reversible, so the notice carries the recovery action
                  itself rather than only announcing that something happened. It is
                  a polite live region, matching the totals below it. */}
              {removedLine && <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2" role="status">
                <p className="min-w-0 truncate text-xs text-muted-foreground">Removed {removedLine.line.description.trim() || `item ${removedLine.index + 1}`}</p>
                <button className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary transition hover:bg-accent" onClick={restoreRemovedLine} type="button"><Undo2 size={14} />Undo</button>
              </div>}

              {/* Running total ledger footer. This is the one hero figure on the page:
                  every per-line amount is deliberately smaller so the total is what the
                  eye lands on. The double rule above it is the accounting convention
                  for a total that must not be confused with an ordinary row. */}
              <div className="sticky bottom-0 z-20 -mx-5 mt-6 border-t-[3px] border-double border-border/70 bg-card/95 px-5 py-3.5 backdrop-blur-md sm:-mx-7 sm:px-7 xl:-mx-8 xl:px-8">
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className={columnHeading}>Amount due</p>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-medium"><span>Subtotal</span><MoneyText className="text-foreground" text={formatMoney(subtotal)} /></span>
                      {discount > 0 && <span className="flex items-center gap-1.5 font-medium text-emerald-700"><span>Discount</span><MoneyText text={`− ${formatMoney(discount)}`} /></span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span aria-hidden="true" className="font-mono text-2xl font-semibold tracking-[-0.02em] text-primary sm:text-3xl"><MoneyText text={formatMoney(total)} /></span>
                  </div>
                </div>
                <p aria-live="polite" className="sr-only" role="status">{announcedTotal}</p>
              </div>
              {/* One line of explanation, and it now describes what the rows actually
                  show: the discount is set on the line it belongs to. */}
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Each line carries its own discount, and prints with that line.</p>
            </div>

            <div className={`editor-section surface p-5 sm:p-7 xl:px-8 ${mobileStep === 4 ? "" : "hidden"} xl:block`}><div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start"><SectionHeading eyebrow="Optional" title="Notes and payment terms" description="Add a thank-you note or instructions for your customer." /><div className="flex flex-wrap gap-2">{accountEmail ? <><Button variant="outline" size="sm" type="button" disabled={libraryLoading} onClick={() => void loadLibrary("notes")}>{libraryLoading && libraryDrawer === "notes" ? "Loading⬦" : "Load saved notes"}</Button><Button variant="outline" size="sm" type="button" disabled={!notes.trim()} onClick={openNoteSaveDialog}>Save current note</Button></> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}>Sign in to reuse notes</Button>}</div></div><label className="block"><span className="sr-only">Notes and payment terms</span><textarea className="field min-h-28 resize-y" maxLength={10000} placeholder="Payment terms, delivery notes, or a thank-you message" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
          </fieldset>

          <section className={`min-w-0 xl:sticky xl:top-[6.5rem] ${mobileStep === 5 ? "" : "hidden"} xl:block`} aria-label="Invoice preview">
            <div className="surface-raised overflow-hidden p-4 xl:p-5">
              <div className="mb-5 flex items-center justify-between gap-4 px-1"><div><p className="eyebrow">Live document</p><h2 className="mt-2 font-heading text-2xl font-medium tracking-[-0.02em]">A4 portrait</h2><p className="mt-1 text-xs text-muted-foreground" role="status">PDF/DOCX estimate: {exportPageCount} page{exportPageCount === 1 ? "" : "s"}</p></div><Button variant="outline" size="sm" type="button" disabled={templateSaving} onClick={() => void openTemplateSettings()}><RotateCcw data-icon="inline-start" />{templateOpen ? "Close customize" : "Customize"}</Button></div>
            {templateOpen && <div className="mb-4 scroll-mb-24 scroll-mt-20 rounded-xl border border-border/80 bg-muted/35 p-4"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoice display</p><p className="mt-1 text-sm font-medium">Choose what appears on the invoice</p></div><Button variant="outline" size="sm" type="button" disabled={templateSaving} onClick={() => void saveTemplateSettings}>{templateSaving ? "Saving⬦" : accountEmail ? "Save template" : "Done"}</Button></div><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">Accent color</span><select className="field" value={templateSettings.accent} onChange={(event) => setTemplateSettings((current) => ({ ...current, accent: event.target.value as TemplateSettings["accent"] }))}><option value="slate">Slate</option><option value="blue">Blue</option><option value="emerald">Emerald</option><option value="indigo">Indigo</option></select></label><div className="space-y-2 text-sm text-foreground/80"><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showAddresses} onChange={(event) => setTemplateSettings((current) => ({ ...current, showAddresses: event.target.checked }))} />Show addresses</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showSellerContact} onChange={(event) => setTemplateSettings((current) => ({ ...current, showSellerContact: event.target.checked }))} />Show seller contact</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showBuyerContact} onChange={(event) => setTemplateSettings((current) => ({ ...current, showBuyerContact: event.target.checked }))} />Show customer contact</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showNotes} onChange={(event) => setTemplateSettings((current) => ({ ...current, showNotes: event.target.checked }))} />Show notes</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showQuantityColumn} onChange={(event) => setTemplateSettings((current) => ({ ...current, showQuantityColumn: event.target.checked }))} />Show quantity column</label><label className="flex items-center gap-2"><input type="checkbox" checked={templateSettings.showPaidStamp} onChange={(event) => setTemplateSettings((current) => ({ ...current, showPaidStamp: event.target.checked }))} />Stamp paid invoices</label></div></div></div>}
              <div className="rounded-xl border border-stone-300/70 bg-[#e9e5dc] p-3 shadow-inner sm:p-5">

                        <div ref={previewRef} className="invoice-paper relative mx-auto max-w-[720px] overflow-hidden rounded-none border border-slate-200 bg-white p-5 shadow-[0_35px_80px_-38px_rgba(28,38,33,0.5)] ring-1 ring-stone-900/5 sm:p-8">
                          {/* The PAID stamp lives inside the preview rather than being
                              added at export time, because lib/invoice/export.ts
                              screenshots this element: whatever renders here is
                              exactly what lands in the PDF and the DOCX. It is
                              decorative, so it is hidden from assistive tech and
                              kept out of the tab order, and pointer-events-none so
                              it never blocks the controls behind it. */}
                          {paidStamp && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center select-none">
                            <span className="-rotate-[28deg] whitespace-nowrap border-[6px] border-emerald-600/25 px-8 py-2 font-heading text-6xl font-bold uppercase tracking-[0.18em] text-emerald-600/25 sm:text-7xl">Paid</span>
                          </div>}
                          <div className={`relative z-[1] flex items-start justify-between gap-6 border-b-2 pb-7 ${accentStyle.rule}`}><div>{logoUrl && <Image src={logoUrl} alt="Seller logo" width={96} height={48} unoptimized className="mb-3 h-auto w-auto max-h-12 max-w-24 object-contain object-left" />}<p className={`text-2xl font-bold tracking-tight ${accentStyle.heading}`}>{sellerCompanyName || "Your company name"}</p><p className="mt-1 text-sm font-medium text-slate-600">{sellerName || "Seller name"}</p>{templateSettings.showAddresses && <p className="mt-2 max-w-[220px] whitespace-pre-line text-xs leading-5 text-slate-500">{sellerAddress || "Your address"}</p>}{templateSettings.showSellerContact && (sellerEmail || sellerPhone) && <p className="mt-2 text-xs text-slate-500">{[sellerEmail, sellerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="text-right"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Invoice</p><p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{invoiceNumber || "DRAFT"}</p></div></div>                          {/* An invoice raised to settle a balance says so on its face,
                              with the arithmetic, so the reader can see it is not a
                              second charge for the same work. */}
                          {carriedForward && <div className="relative z-[1] mb-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
                            <p className="font-semibold uppercase tracking-[0.14em] text-slate-500">Balance of {carriedForward.invoiceNumber ?? "a previous invoice"}</p>
                            <div className="mt-1.5 space-y-0.5">
                              <div className="flex justify-between gap-4"><span>Original invoice</span><span className="font-medium"><MoneyText text={formatMoney(carriedForward.originalTotal)} /></span></div>
                              <div className="flex justify-between gap-4"><span>Already received</span><span className="font-medium"><MoneyText text={`− ${formatMoney(carriedForward.received)}`} /></span></div>
                              <div className="mt-1 flex justify-between gap-4 border-t border-slate-200 pt-1 text-slate-900"><span>Balance carried forward</span><span className="font-semibold"><MoneyText text={formatMoney(carriedForward.amount)} /></span></div>
                            </div>
                          </div>}
                          <div className="grid gap-6 border-b border-slate-200 py-7 text-sm sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Bill to</p><p className="mt-2 text-base font-bold">{billTo.heading}</p>{billTo.contact && <p className="mt-1 text-sm font-medium text-slate-600">{billTo.contact}</p>}{templateSettings.showAddresses && <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-500">{buyerAddress || "Customer address"}</p>}{templateSettings.showBuyerContact && (buyerEmail || buyerPhone) && <p className="mt-1 text-xs text-slate-500">{[buyerEmail, buyerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="sm:text-right"><div className="flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Issue date</span><span className="font-medium">{formatDate(issueDate)}</span></div><div className="mt-2 flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Due date</span><span className="font-medium">{formatDate(dueDate)}</span></div></div></div><div className="py-5"><div className={`${previewLineGrid} border-b border-slate-200 pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400`}><span>Description</span>{templateSettings.showQuantityColumn && <span className="text-center">Qty</span>}<span className="text-right">Price</span><span className="text-right">Discount</span><span className="text-right">Amount</span></div>{lines.map((line) => { const amounts = getLineAmounts(line); return <div key={line.id} className={`${previewLineGrid} border-b border-slate-100 py-3 text-[10px] sm:text-xs`}><span className="break-words text-slate-700">{line.description || "Item description"}</span>{templateSettings.showQuantityColumn && <span className="text-center text-slate-500">{line.quantity || 0}</span>}<span className="text-right text-slate-500"><MoneyText text={formatMoney(Number(line.unitPrice) || 0)} /></span><span className="text-right text-slate-500">{amounts.discountAmount > 0 ? <MoneyText text={`− ${formatMoney(amounts.discountAmount)}`} /> : "—"}</span><span className="text-right font-medium"><MoneyText text={formatMoney(amounts.amount)} /></span></div>})}</div><div className="ml-auto max-w-[320px] space-y-3 border-t border-slate-200 pt-5 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span><MoneyText text={formatMoney(subtotal)} /></span></div>{discount > 0 && <div className="flex justify-between text-slate-500"><span>Total discount</span><span><MoneyText text={`− ${formatMoney(discount)}`} /></span></div>}<div className={`flex justify-between border-t-2 pt-3 text-lg font-bold ${accentStyle.total}`}><span>Total</span><span><MoneyText text={formatMoney(total)} /></span></div></div>{templateSettings.showNotes && notes && <div className="mt-8 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500"><p className="mb-1 font-semibold text-slate-700">Notes</p><p className="whitespace-pre-line">{notes}</p></div>}</div>
              </div>
              <div className="mt-5 border-t border-border/80 pt-5">{accountEmail && !invoiceNumber && <Button type="button" className="mb-3 h-11 w-full" disabled={finalizing || exporting || savingDraft} onClick={finalizeInvoice}>{finalizing ? "Finalizing⬦" : savingDraft ? "Saving draft⬦" : "Finalize invoice"}</Button>}<div className="grid gap-3 sm:grid-cols-2"><Button type="button" variant="outline" className="h-11" disabled={exporting || finalizing} onClick={() => exportInvoice("PDF")}><FileDown data-icon="inline-start" />Download PDF</Button><Button type="button" className="h-11" disabled={exporting || finalizing} onClick={() => exportInvoice("DOCX")}><FileDown data-icon="inline-start" />Download DOCX</Button></div>{message && <p className="mt-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">{message}</p>}<p className="mt-3 text-center text-xs text-muted-foreground">{accountEmail ? "Finalized invoices stay in your history, where you can edit them or record a payment." : "Sign in later to save invoice history across devices."}</p></div>
            </div>

          </section>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_-24px_rgba(28,38,33,0.5)] backdrop-blur-xl xl:hidden">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button className="h-11 flex-1" variant="outline" type="button" disabled={mobileStep === 0} onClick={() => goToStep(mobileStep - 1)}>Back</Button>
          {mobileStep < mobileSteps.length - 1
            ? <Button className="h-11 flex-1" type="button" onClick={() => goToStep(mobileStep + 1)}>{mobileStep === mobileSteps.length - 2 ? "Review preview" : "Next"}</Button>
            : <Button className="h-11 flex-1" type="button" disabled={exporting || finalizing} onClick={() => void exportInvoice("PDF")}><FileDown data-icon="inline-start" />{exporting ? "Preparing⬦" : "Download PDF"}</Button>}
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
            if (accountEmail) void uploadSellerLogo(cropped)
            else void applyGuestLogo(cropped)
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
        {loading && <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground" role="status">Loading saved {isItems ? "items" : "notes"}⬦</p>}
        {!loading && isItems && items.length === 0 && <p className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground">No saved items found. Save a completed line from the invoice editor.</p>}
        {!loading && !isItems && notes.length === 0 && <p className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground">No saved notes found. Save the current invoice note to create one.</p>}
        {!loading && isItems && items.length > 0 && <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-lg border border-border p-4"><p className="font-semibold text-foreground">{item.description}</p><p className="mt-1 text-sm text-muted-foreground">Default price: <MoneyText text={formatMoney(item.defaultUnitPrice)} /></p><div className="mt-4 flex gap-2"><Button type="button" className="flex-1" onClick={() => onAddItem(item)}>Add to invoice</Button><Button type="button" variant="ghost" onClick={() => onDelete(item.id)}>Delete</Button></div></div>)}</div>}
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
          {sellerLoading && <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground" role="status">Loading saved seller profile⬦</p>}
          {!sellerLoading && sellerProfile && <div className="rounded-lg border border-border p-4"><div className="space-y-3"><ProfileValue label="Company" value={sellerProfile.companyName} /><ProfileValue label="Seller" value={sellerProfile.sellerName} /><ProfileValue label="Email" value={sellerProfile.email} /><ProfileValue label="Phone" value={sellerProfile.phone} /><ProfileValue label="Address" value={sellerProfile.address} /></div><Button className="mt-5 w-full" type="button" onClick={onApplySeller}>Use this profile</Button></div>}
          {!sellerLoading && !sellerProfile && <div className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground"><p>{sellerStatus || "No saved seller profile found."}</p><p className="mt-2 text-xs text-muted-foreground">Save the seller details from the invoice page, then open this panel again.</p></div>}
        </> : <>
          {customerLoading && <p className="rounded-lg border border-border bg-muted/60 p-4 text-sm text-muted-foreground" role="status">Loading saved customers⬦</p>}
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

function Field({ label, htmlFor, required, optional, hint, className = "", children }: { label: string; htmlFor: string; required?: boolean; optional?: boolean; hint?: string; className?: string; children: React.ReactNode }) {
  // The hint is a sibling of the label, never a child of it. Every text node inside
  // a <label> joins the control's accessible name, so a nested hint gets read twice:
  // once as the name, then again through aria-describedby. `required` is carried
  // natively by the control itself, so the asterisk is decorative and hidden from
  // assistive tech. "optional" is plain muted text rather than a bordered chip so it
  // never outweighs the required marker it sits beside.
  const hintId = hint ? `${htmlFor}-hint` : undefined
  return <div className={className}>
    <label className="mb-2 flex items-baseline gap-1.5 text-sm font-medium text-foreground/80" htmlFor={htmlFor}>
      <span>{label}</span>
      {required && <><span aria-hidden="true" className="font-semibold text-destructive">*</span><span className="sr-only">required</span></>}
      {optional && <><span aria-hidden="true" className="text-xs font-normal text-muted-foreground">optional</span><span className="sr-only">optional</span></>}
    </label>
    {children}
    {hint && <p className="mt-1.5 text-xs leading-5 text-muted-foreground" id={hintId}>{hint}</p>}
  </div>
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  // text-balance on the heading: these titles are short but a two-word tail can
  // still wrap to a lone word at narrow widths.
  return <div className="mb-5"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p><h2 className="mt-1 text-balance font-heading text-2xl font-medium tracking-[-0.02em]">{title}</h2><p className="mt-1 text-pretty text-sm leading-5 text-muted-foreground">{description}</p></div>
}

// The discount is always on screen. It used to appear only once a row's menu had
// been opened and "Discount this line" chosen, which made the least-used field
// on a line the hardest one to reach, and left the row visibly different the
// moment it was set. A seller discounts a line rarely, so the control that is
// always there costs one select they read and ignore; the one that has to be
// summoned costs a menu and two decisions every time they do want it.
//
// "No discount" is a real option in the select rather than a separate switch,
// because a switch is a second control with its own state to keep in step with
// the select's. One control, one state, and the value field disables itself when
// the type is none so a half-set discount can't sit there looking applied.
function LineDiscountControls({ line, onChange }: { line: LineItem; onChange: (id: number, patch: Partial<LineItem>) => void }) {
  const originalAmount = getLineAmounts(line).originalAmount
  const isOff = line.discountType === "none"
  // Boxed like the row's own fields rather than ruled, so the band reads as part
  // of the same form. The unit rides inside the value field as a prefix, so "10%"
  // and "৳500" are one control whose suffix cannot disagree with its type.
  // No `w-full` here: it would be declared after the width utilities in the
  // stylesheet and win regardless of class order, collapsing the select to
  // whatever min-content the flex row gave it (measured 64px, not the 88px set).
  const compactField = "h-8 min-w-0 rounded-md border border-border bg-card px-2 text-xs text-foreground transition-colors hover:border-primary/45 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:border-dashed disabled:border-border/60 disabled:bg-muted/30 disabled:text-muted-foreground"

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="sr-only">Discount on this line</span>
      <div className="relative shrink-0">
        {/* "No discount" leads, because it is the state a row is in until someone
            decides otherwise, and the select should say so rather than implying
            a discount is already being applied. Percent follows: it is the common
            case for a freelancer discounting a retainer. */}
        <select
          id={`discount-type-${line.id}`}
          aria-label={`Discount type item ${line.id}`}
          className={`${compactField} w-[104px] shrink-0 cursor-pointer appearance-none pr-5`}
          value={line.discountType}
          onChange={(event) => onChange(line.id, { discountType: event.target.value as DiscountType, discountValue: event.target.value === "none" ? "" : line.discountValue })}
        >
          <option value="none">No discount</option>
          <option value="percentage">Percent</option>
          <option value="fixed">Taka off</option>
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
      </div>
      {/* The width lives on the wrapper so the unit prefix and the digits share one
          box; the input fills it. */}
      <div className="relative w-[86px] shrink-0">
        <input
          aria-label={`Discount value item ${line.id}`}
          className={`${compactField} w-full pl-5 text-left font-mono tnum`}
          disabled={isOff}
          type="number"
          min={0}
          max={line.discountType === "percentage" ? 100 : originalAmount}
          step={1}
          placeholder="0"
          value={line.discountValue}
          onBlur={() => {
            const numeric = Number(line.discountValue)
            if (line.discountValue !== "" && Number.isFinite(numeric) && numeric !== line.discountValue) {
              onChange(line.id, { discountValue: numeric })
            }
          }}
          onChange={(event) =>
            onChange(line.id, { discountValue: event.target.value === "" ? "" : Math.max(0, Number(event.target.value)) })
          }
        />
        {/* The unit sits at the same size as the digits beside it. At 11px the
            `.taka` ratio (0.74em) rendered it near 8px, which read as a speck
            rather than as a currency sign. */}
        <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
          {line.discountType === "percentage" ? "%" : <span className="taka">৳</span>}
        </span>
      </div>
      {/* Clearing the line is a plain button, not a destructive one: it sets a
          field back to its default rather than deleting anything. */}
      <button
        aria-label={`Remove discount item ${line.id}`}
        className="inline-flex size-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => onChange(line.id, { discountType: "none", discountValue: "" })}
        title="Remove this discount"
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  )
}

function LineCard({ line, index, isLast, onChange, onRemove, onAdvance, onSave, canSave, saving }: { line: LineItem; index: number; isLast: boolean; onChange: (id: number, patch: Partial<LineItem>) => void; onRemove: (id: number) => void; onAdvance: (index: number, field: "description" | "quantity" | "price") => void; onSave: (line: LineItem) => void; canSave: boolean; saving: boolean }) {
  const amounts = getLineAmounts(line)
  // These inputs previously carried a bare aria-label of "Quantity" and "Unit
  // price", identical on every card, so a screen reader announced the same two
  // names repeatedly with no indication of which line was being edited. The
  // visible label is now the accessible name, with the item number supplied as
  // context inside the label, and the visible text kept at the front so
  // voice-control users still get a name containing the label they can see
  // (WCAG 2.5.3). Doubles as the id prefix for the descriptions below.
  const describedBy = `line-help-${line.id}`

  // One row per line item, laid out as a statement rather than a stack of cards.
  // Below `lg` the row is a stack: description across the width, quantity beside
  // unit price, amount beside the row actions, and the discount band on its own
  // line. At `lg` and up it becomes a real table on the shared column template.
  //
  // Each field is a real box. The rows went borderless on the argument that six
  // identical rectangles read as a wall, and the wall was real, but the cure
  // removed the only cue that a cell was editable at all: on a field of
  // hairlines the inputs and the printed amount were the same object, and a
  // seller aiming at quantity had to click it to find out. The box is back at
  // low weight — one hairline, no shadow, no fill — and the hierarchy is carried
  // by type instead: the description is the widest cell and set at reading size,
  // the three figures are mono, and the amount is the only bold thing on the row.
  //
  // The row is one visual object: fields across the top, and the discount in a
  // band under it, indented to the description column, so it reads as detail
  // belonging to this row. The band is always there, so a row never changes
  // height when its discount is set.
  return <li className="group min-w-0 list-none py-2.5 transition-colors lg:hover:bg-muted/30">
    <div className={`grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 ${ledgerColumns}`}>
      {/* Gutter ordinal */}
      <span aria-hidden="true" className="row-start-1 col-start-1 self-start pt-2 font-mono text-[11px] font-medium tabular-nums text-muted-foreground lg:self-center lg:pt-0">{String(index + 1).padStart(2, "0")}</span>

      {/* Description. The widest cell, the only one that grows, and what a seller
          actually writes, so it is set at reading size rather than as a figure. */}
      <div className="row-start-1 col-span-2 col-start-2 min-w-0 lg:col-span-1">
        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:sr-only" htmlFor={`description-${line.id}`}>Description<span className="sr-only"> of item {index + 1}</span></label>
        <input id={`description-${line.id}`} aria-describedby={`${describedBy}-description`} autoComplete="off" className="ledger-field scroll-mb-40 text-[0.9375rem]" maxLength={500} onChange={(event) => onChange(line.id, { description: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdvance(index, "description") } }} placeholder="What are you charging for?" value={line.description} />
        <span className="sr-only" id={`${describedBy}-description`}>Press Enter to move to the quantity field.</span>
      </div>

      {/* Quantity */}
      <div className="row-start-2 col-start-2 min-w-0 lg:row-start-1 lg:col-start-3">
        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:sr-only" htmlFor={`quantity-${line.id}`}>Quantity<span className="sr-only"> for item {index + 1}</span></label>
        <input id={`quantity-${line.id}`} autoComplete="off" className={`ledger-field text-[0.9375rem] font-mono tnum ${numericInset}`} inputMode="numeric" min={1} step={1} placeholder="0" type="number" value={line.quantity} onChange={(event) => onChange(line.id, { quantity: event.target.value === "" ? "" : Math.max(1, Number(event.target.value)) })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdvance(index, "quantity") } }} />
        <span className="sr-only">Use the up and down arrow keys to change the quantity. Press Enter to move to the unit price.</span>
      </div>

      {/* Unit price */}
      <div className="row-start-2 col-start-3 min-w-0 lg:row-start-1 lg:col-start-4">
        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:sr-only" htmlFor={`price-${line.id}`}>Unit price<span className="sr-only"> for item {index + 1}, in taka</span></label>
        <input id={`price-${line.id}`} aria-describedby={isLast ? `${describedBy}-next` : undefined} autoComplete="off" className={`ledger-field text-[0.9375rem] font-mono tnum ${numericInset}`} inputMode="decimal" min={0} placeholder="0" step="any" type="number" value={line.unitPrice} onChange={(event) => onChange(line.id, { unitPrice: event.target.value === "" ? "" : Math.max(0, Number(event.target.value)) })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdvance(index, "price") } }} />
        {isLast && <span className="sr-only" id={`${describedBy}-next`}>Press Enter to add another item.</span>}
      </div>

      {/* Amount. One line, always, and the only bold figure on the row: the net is
          the spine of the statement, and every amount cell has to be the same height
          for that column to read straight down. The original and the amount taken
          off belong to the discount, so they sit with it in the band below.

          It is a readout, not a field, and is drawn as one: the same box the inputs
          use so the column lines up, but dashed and muted, so the only cell on the
          row that cannot take a caret does not look like it can. */}
      <div className="row-start-3 col-start-2 min-w-0 lg:row-start-1 lg:col-start-5">
        <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:sr-only">Amount</span>
        <output id={`amount-${line.id}`} aria-label={`Line total for item ${index + 1}`} className={`ledger-readout font-mono text-[0.9375rem] font-semibold ${numericInset}`}><MoneyText text={formatMoney(amounts.amount)} /></output>
      </div>

      {/* Row actions, on the row. These were an overflow menu, then a column of
          icons inside one; both hid real controls behind a click on a 40px
          trigger that said nothing about what it held. A seller who cannot see
          that a control exists will not reach for it, so the actions now sit in
          the gutter they always occupied, stacked one over the other, each a
          real button.

          Stacked rather than in a line because the column is 40px wide and the
          row is one statement: two 32px buttons side by side would still need
          more than the description can spare. Vertically they cost only the
          row's height, and the row already has a second band under it for the
          discount, so the stack sits beside both without crowding either.

          Delete is first and Save is second, at the seller's request. That
          reverses the earlier order, so the two are no longer separated by a
          rule: a rule between the only two controls left would read as if they
          belonged to different groups, and they do not. Delete keeps its
          destructive colour so the one control that removes a line still looks
          unlike the one that stores it.

          "Duplicate line" was removed with the button: it is a convenience, and
          pressing Enter on the last row's price adds a line anyway. Removing it
          took `duplicateLine` and its `onDuplicate` prop with it, so nothing is
          left behind as dead state.

          The group is named after its row, so a screen reader announces
          "Actions for item 3" and the buttons inside it rather than bare icons
          repeated down the page. Each button keeps an aria-label and a title, so
          the written name survives the icon. */}
      <div aria-label={`Actions for item ${index + 1}`} className="row-start-3 col-start-3 flex items-center justify-end lg:row-start-1 lg:col-start-6" role="group">
        <div className="flex flex-col items-center gap-0.5">
          <button aria-label="Remove line" className={cn(rowActionButton, "text-destructive hover:bg-destructive/10 hover:text-destructive")} onClick={() => onRemove(line.id)} title="Remove line" type="button">
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
          {canSave && <button aria-label="Save to item library" className={rowActionButton} disabled={!line.description.trim() || saving} onClick={() => onSave(line)} title="Save to item library" type="button">
            <Save aria-hidden="true" className="size-4" />
          </button>}
        </div>
      </div>

      {/* Discount, always present. It used to be a modifier that appeared only once
          the row's menu had summoned it, which made the least-used field on a line
          the hardest to reach and left the row visibly different the moment it was
          set. Now it is simply part of the row: indented to the description column,
          on its own line, with the arithmetic beside it where the amount is. The
          enter animation is gone with the conditional, since nothing arrives
          now. It wraps rather than widening the row, because at 320px the parts no
          longer fit on one line and a wrapped control beats a scrolling ledger. */}
      <div className="row-start-4 col-span-2 col-start-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-l-2 border-primary/35 py-1 pl-3 lg:row-start-2 lg:col-span-4 lg:col-start-2">
        <LineDiscountControls line={line} onChange={onChange} />
        {amounts.discountAmount > 0 && <p className={`block font-mono text-[11px] leading-4 text-muted-foreground lg:w-auto ${numericInset}`}><s><MoneyText text={formatMoney(amounts.originalAmount)} /></s><span aria-hidden="true"> − </span><MoneyText text={formatMoney(amounts.discountAmount)} /></p>}
      </div>
    </div>
  </li>
}
