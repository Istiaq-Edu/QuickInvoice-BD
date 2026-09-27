"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

type ConfirmDialogProps = {
  /** Extra context under the description, e.g. which invoice is affected. */
  body?: React.ReactNode
  busy?: boolean
  cancelLabel?: string
  confirmLabel: string
  description: string
  /**
   * Destructive actions get a warning icon, a destructive button and a focus
   * default on Cancel, because the mistake here is not reversible by reloading.
   */
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  title: string
}

// Replaces window.confirm, which renders a browser-native dialog that ignores the
// design system, cannot be styled, traps focus badly and blocks the main thread.
export function ConfirmDialog({ body, busy, cancelLabel = "Cancel", confirmLabel, description, destructive, onCancel, onConfirm, open, title }: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Held in a ref so the effect runs once per open rather than on every render.
  // Assigned in an effect, because updating a ref during render is not allowed.
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!open) return
    // A destructive prompt opens focused on Cancel, so Enter cannot destroy
    // something with a stray keystroke.
    if (destructive) cancelRef.current?.focus()
    else confirmRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== "Tab") return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")
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
  }, [open, destructive])

  // While the confirm is in flight, Tab and Escape must not leave the dialog.
  if (!open) return null

  return <div aria-labelledby="confirm-dialog-title" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center" role="dialog">
    <button aria-label="Close" className="absolute inset-0 cursor-default" disabled={busy} onClick={onCancel} type="button" />
    <div className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6" ref={panelRef}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {destructive && <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/8 text-destructive"><AlertTriangle size={18} /></span>}
          <div className="min-w-0">
            <h2 className="font-heading text-xl font-medium" id="confirm-dialog-title">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <button aria-label="Close" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button>
      </div>

      {body && <div className="mb-5 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">{body}</div>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button className="h-11 sm:w-auto" disabled={busy} onClick={onCancel} ref={cancelRef} type="button" variant="outline">{cancelLabel}</Button>
        <Button
          className={cn("h-11 sm:w-auto", destructive && "border-destructive bg-destructive text-white hover:border-destructive hover:bg-destructive")}
          disabled={busy}
          onClick={onConfirm}
          ref={confirmRef}
          type="button"
          variant={destructive ? undefined : "default"}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  </div>
}

// A pending prompt. There is deliberately no onConfirm here: the caller awaits
// the promise and continues, so the dialog only has to resolve true or false.
type ConfirmRequest = {
  body?: React.ReactNode
  confirmLabel: string
  description: string
  destructive?: boolean
  title: string
}

/**
 * A promise-based confirm that still renders inside the app.
 *
 * `await confirm({ ... })` reads like window.confirm at the call site, so
 * existing control flow is unchanged, but the UI is the design system's.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = (next: ConfirmRequest) => new Promise<boolean>((resolve) => {
    resolverRef.current = resolve
    setRequest(next)
  })

  // A stable callback would let callers depend on it, but the resolver is only
  // valid while a dialog is open, so a ref keeps the identity stable without
  // going stale.
  const settle = (value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setRequest(null)
  }

  return { confirm, dialog: request ? <ConfirmDialog {...request} busy={false} onCancel={() => settle(false)} onConfirm={() => settle(true)} open /> : null }
}
