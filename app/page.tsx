"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { FileDown, Plus, RotateCcw, Trash2, UserRound } from "lucide-react"
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

export default function Home() {
  const router = useRouter()
  const previewRef = useRef<HTMLDivElement>(null)
  const nextLineId = useRef(2)
  const draftId = useRef<string | null>(null)
  const draftVersion = useRef<number | null>(null)
  const [exporting, setExporting] = useState(false)
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

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0), 0), [lines])
  const discount = useMemo(() => {
    const numericDiscount = Number(discountValue) || 0
    if (discountType === "fixed") return Math.min(subtotal, Math.max(0, numericDiscount))
    if (discountType === "percentage") return Math.round((subtotal * Math.min(100, Math.max(0, numericDiscount))) / 100)
    return 0
  }, [discountType, discountValue, subtotal])
  const total = Math.max(0, subtotal - discount)
  const incomplete = !sellerCompanyName.trim() || !sellerName.trim() || !buyerCompanyName.trim() || !buyerName.trim() || lines.length === 0 || lines.some((line) => !line.description.trim() || line.quantity === "" || Number(line.quantity) < 1 || line.unitPrice === "" || Number(line.unitPrice) < 0)

  useEffect(() => {
    if (!accountEmail || !issueDate || !dueDate) return
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
        paymentStatus: "unpaid" as const,
        notes,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity) || 1,
          unitPrice: Number(line.unitPrice) || 0,
        })),
      }

      const response = await fetch("/api/invoices/drafts", {
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
  }, [accountEmail, buyerAddress, buyerCompanyName, buyerEmail, buyerName, buyerPhone, discountType, discountValue, dueDate, incomplete, issueDate, lines, notes, sellerAddress, sellerCompanyName, sellerEmail, sellerName, sellerPhone])

  const updateLine = (id: number, patch: Partial<LineItem>) => setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  const removeLine = (id: number) => setLines((current) => current.filter((line) => line.id !== id))
  const exportInvoice = async (format: "PDF" | "DOCX") => {
    if (incomplete) {
      setMessage("Add both company names, seller/customer names, and a description for every item before exporting.")
      return
    }
    if (!previewRef.current) return

    setExporting(true)
    setMessage(`Preparing ${format}…`)
    try {
      if (format === "PDF") await exportPreviewAsPdf(previewRef.current)
      else await exportPreviewAsDocx(previewRef.current)
      setMessage(`${format} downloaded.`)
    } catch {
      setMessage(`${format} export failed. Please try again.`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-slate-950 text-lg font-bold text-white">৳</div><div><p className="text-sm font-semibold tracking-tight">Invoice Studio</p><p className="text-xs text-slate-500">Simple invoices for Bangladesh</p></div></div>
          {accountEmail ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/invoices"><UserRound data-icon="inline-start" />View history</Link> : <Button variant="outline" size="sm" type="button" onClick={() => router.push("/auth/login")}><UserRound data-icon="inline-start" />Sign in to save</Button>}
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">New invoice</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create an invoice in minutes.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">Fill in the essentials, review the live A4 preview, and download when your invoice is ready.</p></div><div className="flex items-center gap-2 text-xs text-slate-500"><span className={`size-2 rounded-full ${accountEmail ? "bg-emerald-500" : "bg-slate-300"}`} />{accountEmail ? `${saveState} · ${accountEmail}` : "Guest mode · nothing is saved yet"}</div></div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.86fr)]">
          <section className="space-y-5" aria-label="Invoice form">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-6 flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold">Invoice details</h2><p className="mt-1 text-sm text-slate-500">Required fields are marked with an asterisk.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Draft</span></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Issue date" htmlFor="issue-date"><input id="issue-date" className="field" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></Field><Field label="Due date" htmlFor="due-date" required><input id="due-date" className="field" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionHeading eyebrow="From" title="Your company" description="Your company name is the main seller heading on the invoice." /><div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="seller-company-name" required><input id="seller-company-name" className="field" placeholder="Your company name" value={sellerCompanyName} onChange={(event) => setSellerCompanyName(event.target.value)} /></Field><Field label="Seller name" htmlFor="seller-name" required><input id="seller-name" className="field" placeholder="Your full name" value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></Field><Field label="Email" htmlFor="seller-email"><input id="seller-email" className="field" type="email" placeholder="you@example.com" value={sellerEmail} onChange={(event) => setSellerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="seller-phone"><input id="seller-phone" className="field" placeholder="01XXXXXXXXX" value={sellerPhone} onChange={(event) => setSellerPhone(event.target.value)} /></Field><Field label="Address" htmlFor="seller-address" className="sm:col-span-2"><textarea id="seller-address" className="field min-h-24 resize-y" placeholder="Your address" value={sellerAddress} onChange={(event) => setSellerAddress(event.target.value)} /></Field></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionHeading eyebrow="Bill to" title="Customer company" description="The customer company name is the main buyer heading." /><div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" htmlFor="buyer-company-name" required><input id="buyer-company-name" className="field" placeholder="Customer company name" value={buyerCompanyName} onChange={(event) => setBuyerCompanyName(event.target.value)} /></Field><Field label="Buyer name" htmlFor="buyer-name" required><input id="buyer-name" className="field" placeholder="Customer contact name" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></Field><Field label="Email" htmlFor="buyer-email"><input id="buyer-email" className="field" type="email" placeholder="customer@example.com" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} /></Field><Field label="Phone" htmlFor="buyer-phone"><input id="buyer-phone" className="field" placeholder="01XXXXXXXXX" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} /></Field><Field label="Address" htmlFor="buyer-address" className="sm:col-span-2"><textarea id="buyer-address" className="field min-h-24 resize-y" placeholder="Customer address" value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} /></Field></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><SectionHeading eyebrow="Items" title="What are you charging for?" description="Whole-number quantities and Bangladeshi Taka prices." /><Button variant="outline" size="sm" type="button" onClick={() => setLines((current) => [...current, newLine(nextLineId.current++)])}><Plus data-icon="inline-start" />Add item</Button></div><div className="hidden overflow-hidden rounded-xl border border-slate-200 md:block"><div className="grid grid-cols-[minmax(0,1fr)_100px_140px_120px_40px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Amount</span><span /></div>{lines.map((line) => <LineRow key={line.id} line={line} onChange={updateLine} onRemove={removeLine} />)}</div><div className="space-y-3 md:hidden">{lines.map((line, index) => <LineCard key={line.id} index={index} line={line} onChange={updateLine} onRemove={removeLine} />)}</div><div className="mt-6 grid gap-5 border-t border-slate-200 pt-6 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end"><Field label="Discount" htmlFor="discount-type"><div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2"><select id="discount-type" className="field" value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}><option value="none">No discount</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select>{discountType === "none" ? <div className="field flex items-center text-slate-400">—</div> : <input className="field" type="number" min={0} max={discountType === "percentage" ? 100 : subtotal} step={1} value={discountValue} onChange={(event) => setDiscountValue(event.target.value === "" ? "" : Number(event.target.value))} />}</div></Field><div className="rounded-xl bg-slate-50 p-4 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div><div className="mt-2 flex justify-between text-slate-500"><span>Discount</span><span>− {formatMoney(discount)}</span></div><div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-semibold"><span>Total</span><span>{formatMoney(total)}</span></div></div></div></div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionHeading eyebrow="Optional" title="Notes and payment terms" description="Add a thank-you note or instructions for your customer." /><textarea className="field min-h-28 resize-y" placeholder="Payment terms, delivery notes, or a thank-you message" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          </section>

          <section className="lg:sticky lg:top-6" aria-label="Invoice preview"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Live preview</p><h2 className="mt-1 text-lg font-semibold">A4 portrait</h2></div><Button variant="outline" size="sm" type="button" onClick={() => setMessage("Template controls will be added in the next implementation slice.")}><RotateCcw data-icon="inline-start" />Customize</Button></div>
            <div ref={previewRef} className="invoice-paper mx-auto max-w-[720px] rounded-sm border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-10"><div className="flex items-start justify-between gap-6 border-b-2 border-slate-950 pb-7"><div><p className="text-2xl font-bold tracking-tight">{sellerCompanyName || "Your company name"}</p><p className="mt-1 text-sm font-medium text-slate-600">{sellerName || "Seller name"}</p><p className="mt-2 max-w-[220px] whitespace-pre-line text-xs leading-5 text-slate-500">{sellerAddress || "Your address"}</p>{(sellerEmail || sellerPhone) && <p className="mt-2 text-xs text-slate-500">{[sellerEmail, sellerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="text-right"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Invoice</p><p className="mt-1 text-xl font-bold tracking-tight text-slate-900">DRAFT</p></div></div><div className="grid gap-6 border-b border-slate-200 py-7 text-sm sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Bill to</p><p className="mt-2 text-base font-bold">{buyerCompanyName || "Customer company"}</p><p className="mt-1 text-sm font-medium text-slate-600">{buyerName || "Buyer name"}</p><p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-500">{buyerAddress || "Customer address"}</p>{(buyerEmail || buyerPhone) && <p className="mt-1 text-xs text-slate-500">{[buyerEmail, buyerPhone].filter(Boolean).join(" · ")}</p>}</div><div className="sm:text-right"><div className="flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Issue date</span><span className="font-medium">{formatDate(issueDate)}</span></div><div className="mt-2 flex justify-between gap-6 sm:justify-end"><span className="text-slate-500">Due date</span><span className="font-medium">{formatDate(dueDate)}</span></div></div></div><div className="py-7"><div className="grid grid-cols-[minmax(0,1fr)_46px_88px_88px] gap-3 border-b border-slate-200 pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"><span>Description</span><span className="text-center">Qty</span><span className="text-right">Price</span><span className="text-right">Amount</span></div>{lines.map((line) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_46px_88px_88px] gap-3 border-b border-slate-100 py-4 text-xs"><span className="break-words text-slate-700">{line.description || "Item description"}</span><span className="text-center text-slate-500">{line.quantity || 0}</span><span className="text-right text-slate-500">{formatMoney(Number(line.unitPrice) || 0)}</span><span className="text-right font-medium">{formatMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</span></div>)}</div><div className="ml-auto max-w-[270px] space-y-3 border-t border-slate-200 pt-5 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>{discount > 0 && <div className="flex justify-between text-slate-500"><span>Discount</span><span>− {formatMoney(discount)}</span></div>}<div className="flex justify-between border-t-2 border-slate-950 pt-3 text-lg font-bold"><span>Total</span><span>{formatMoney(total)}</span></div></div>{notes && <div className="mt-12 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500"><p className="mb-1 font-semibold text-slate-700">Notes</p><p className="whitespace-pre-line">{notes}</p></div>}</div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="grid gap-3 sm:grid-cols-2"><Button type="button" variant="outline" className="h-11" disabled={exporting} onClick={() => exportInvoice("PDF")}><FileDown data-icon="inline-start" />Download PDF</Button><Button type="button" className="h-11" disabled={exporting} onClick={() => exportInvoice("DOCX")}><FileDown data-icon="inline-start" />Download DOCX</Button></div>{message && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600" role="status">{message}</p>}<p className="mt-3 text-center text-xs text-slate-500">Sign in later to save invoice history across devices.</p></div>
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
