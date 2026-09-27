"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { calculateSettlement, describePaymentAmount, formatMoney, paymentMethodLabels, settlementDisplay, type PaymentMethod } from "@/lib/invoice/types"
// Re-exported so the many existing `from "@/components/invoice-settlement"` call
// sites keep working while the implementation lives in one shared module.
// Money is rendered through MoneyText so the taka sign lines up with the digits.
import { MoneyText } from "@/components/money-text"


const statusStyles: Record<string, string> = {
  overdue: "border-amber-300 bg-amber-50 text-amber-800",
  paid: "border-emerald-300 bg-emerald-50 text-emerald-800",
  partial: "border-sky-300 bg-sky-50 text-sky-800",
  unpaid: "border-border bg-muted text-foreground/80",
}

const statusLabels: Record<string, string> = {
  overdue: "Overdue",
  paid: "Paid",
  partial: "Part paid",
  unpaid: "Unpaid",
}

// The settlement cell answers the only two questions a seller has about a row:
// how much is still owed, and how much has come in. The wording lives in
// settlementDisplay so it can be tested without a DOM, and so this cell and the
// Status column beside it can never contradict each other: a fully paid invoice
// used to render "৳0" over "of ৳2,000 due", claiming money was outstanding on a row
// already marked Paid.
export function SettlementCell({ total, amountPaid, isDraft }: { total: number; amountPaid?: number | null; isDraft: boolean }) {
  // A draft has no settlement, but the cell still has to occupy the same slot and
  // align to the same right edge, or the row reads as broken.
  if (isDraft) return <div className="text-right"><span className="text-xs text-muted-foreground">Not finalized</span></div>

  const settlement = calculateSettlement(total, amountPaid)
  const display = settlementDisplay(total, amountPaid)
  // Only a part-paid invoice has a ratio worth showing; on a settled row a full
  // bar sits beside a green Paid pill and says the same thing twice.
  const settled = settlement.isSettled && !settlement.isOverpaid

  return <div className="text-right">
    <p className={`text-sm font-semibold ${settled ? "text-muted-foreground" : settlement.isOverpaid ? "text-amber-800" : ""}`}>
      <MoneyText text={display.headline} />
    </p>
    <p className="text-xs text-muted-foreground"><MoneyText text={display.detail} /></p>
    {display.showBar && <div aria-hidden="true" className="mt-1 ml-auto h-1 w-20 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-sky-600" style={{ width: `${settlement.percentPaid}%` }} />
    </div>}
    {display.showBar && <span className="sr-only">{settlement.percentPaid} percent paid</span>}
  </div>
}

type PaymentDialogProps = {
  amount: string
  balance: number
  customer: string
  error: string
  invoiceNumber: string | null
  method: PaymentMethod
  onAmountChange: (value: string) => void
  onClose: () => void
  onMethodChange: (value: PaymentMethod) => void
  onReferenceChange: (value: string) => void
  onRemove: (paymentId: string) => void
  onSubmit: () => void
  paid: number
  payments: RecordedPayment[]
  reference: string
  removingId: string | null
  saving: boolean
  total: number
}

type RecordedPayment = {
  amount: number
  id: string
  method: string
  note: string
  receivedOn: string
  reference: string
}

export function PaymentLedger({ payments, busyId, onRemove }: { payments: RecordedPayment[]; busyId: string | null; onRemove: (id: string) => void }) {
  if (payments.length === 0) return null

  return <div className="mb-5">
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments received</p>
    <ul className="divide-y divide-border/70 rounded-lg border border-border">
      {payments.map((payment) => <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={payment.id}>
        <div className="min-w-0">
          <p className="font-medium">{formatMoney(payment.amount)}</p>
          <p className="text-xs text-muted-foreground">
            {[paymentMethodLabels[payment.method as PaymentMethod] ?? payment.method, payment.receivedOn, payment.reference].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button
          aria-label={`Remove payment of ${formatMoney(payment.amount)}`}
          className="inline-flex min-h-9 shrink-0 items-center rounded-md px-2 text-xs font-medium text-destructive hover:bg-rose-500/10 disabled:opacity-60"
          disabled={busyId === payment.id}
          onClick={() => onRemove(payment.id)}
          type="button"
        >
          {busyId === payment.id ? "Removing…" : "Remove"}
        </button>
      </li>)}
    </ul>
  </div>
}

// A dialog rather than an inline row editor: it holds four fields plus a running
// balance summary, which would push the rest of the table around while typing.
export function RecordPaymentDialog(props: PaymentDialogProps) {
  const [showReference, setShowReference] = useState(Boolean(props.reference))
  const amountRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // An empty field is not zero. Number("") evaluates to 0, which would make the
  // live hint claim the invoice is settled and would mask "enter an amount".
  const hint = describePaymentAmount(props.amount, props.balance)

  // Escape is the expected way out of a dialog, and focus has to land inside it
  // when it opens or a keyboard user is left behind on the page underneath.
  //
  // onClose is held in a ref so the effect runs once on mount. Depending on the
  // whole props object would re-run it on every keystroke, and the initial focus
  // would snatch focus back to the amount field every time the seller touched the
  // method or reference — making the form unusable with a keyboard.
  const onCloseRef = useRef(props.onClose)

  useEffect(() => {
    // Assigned after commit rather than during render, which React forbids.
    onCloseRef.current = props.onClose
  }, [props.onClose])

  useEffect(() => {
    amountRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return
      // Minimal focus trap: without it, Tab walks into the inert page behind.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return <div aria-labelledby="record-payment-title" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center" role="dialog">
    <button aria-label="Close" className="absolute inset-0 cursor-default" onClick={props.onClose} type="button" />
    <div className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6" ref={dialogRef}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-medium" id="record-payment-title">Record payment</h2>
          <p className="mt-1 text-sm text-muted-foreground">{props.invoiceNumber ?? "Draft"} · {props.customer}</p>
        </div>
        <button aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={props.onClose} type="button"><X size={18} /></button>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-muted/50 p-3 text-sm">
        <div className="flex items-center justify-between"><span className="text-muted-foreground">Invoice total</span><span className="font-medium">{formatMoney(props.total)}</span></div>
        {props.paid > 0 && <div className="mt-1 flex items-center justify-between"><span className="text-muted-foreground">Already received</span><span className="font-medium">{formatMoney(props.paid)}</span></div>}
        <div className="mt-1 flex items-center justify-between border-t border-border pt-1"><span className="text-muted-foreground">Balance due</span><span className="font-semibold">{formatMoney(props.balance)}</span></div>
      </div>

      <PaymentLedger busyId={props.removingId} onRemove={props.onRemove} payments={props.payments} />

      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-foreground/80">Amount received</span>
          <input
            aria-describedby="payment-amount-hint"
            aria-invalid={Boolean(props.error)}
            className="field"
            id="payment-amount"
            inputMode="numeric"
            onChange={(event) => props.onAmountChange(event.target.value)}
            placeholder="0"
            ref={amountRef}
            value={props.amount}
          />
          {/* aria-live because the consequence of the typed amount changes on every
              keystroke; a screen-reader user would otherwise be told nothing. */}
          <span aria-live="polite" className="mt-1.5 block text-xs leading-5 text-muted-foreground" id="payment-amount-hint">
            {hint.kind === "empty" ? `Enter an amount. The balance due is ${formatMoney(props.balance)}.` : null}
            {hint.kind === "invalid" ? "Enter a whole number greater than zero." : null}
            {hint.kind === "settles" ? "This settles the invoice in full." : null}
            {hint.kind === "outstanding" ? `${formatMoney(hint.remaining)} will still be outstanding.` : null}
            {hint.kind === "overpay" ? `This is ${formatMoney(hint.excess)} more than the balance. The invoice will show as overpaid.` : null}
          </span>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-foreground/80">Method</span>
          <select className="field" id="payment-method" onChange={(event) => props.onMethodChange(event.target.value as PaymentMethod)} value={props.method}>
            {(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((key) => <option key={key} value={key}>{paymentMethodLabels[key]}</option>)}
          </select>
        </label>

        {showReference
          ? <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground/80">Reference <span className="font-normal text-muted-foreground">(optional)</span></span>
              <input className="field" id="payment-reference" onChange={(event) => props.onReferenceChange(event.target.value)} placeholder="Transaction or cheque number" value={props.reference} />
            </label>
          : <button className="text-xs font-medium text-primary hover:underline" onClick={() => setShowReference(true)} type="button">+ Add a reference</button>}

        {props.error && <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-destructive" role="alert">{props.error}</p>}

        <div className="flex gap-3 pt-1">
          <Button className="h-11 flex-1" disabled={props.saving} type="submit">{props.saving ? "Saving⬦" : "Save payment"}</Button>
          <Button className="h-11" disabled={props.saving} onClick={props.onClose} type="button" variant="outline">Cancel</Button>
        </div>
      </form>
    </div>
  </div>
}

export function PaymentStatusPill({ isOverpaid, status }: { isOverpaid?: boolean; status: string }) {
  if (isOverpaid) {
    return <span className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"><AlertTriangle size={12} />Overpaid</span>
  }
  return <span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-medium ${statusStyles[status] ?? statusStyles.unpaid}`}>{statusLabels[status] ?? status}</span>
}
