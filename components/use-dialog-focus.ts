"use client"

import { useEffect, useRef } from "react"

/**
 * Keeps a dialog's keyboard contract intact: focus moves into the panel when it
 * opens, Tab is trapped inside it, and focus returns to whatever element opened
 * it when it closes.
 *
 * The restore half is the part that was missing. Both dialogs moved focus in and
 * trapped Tab, but neither remembered the trigger, so closing dropped focus to
 * `<body>` — a keyboard or screen-reader user was silently returned to the top of
 * the page. WCAG 2.2 SC 2.4.3 requires the focus order to be preserved.
 *
 * `panelRef` is the dialog panel (the element Tab should cycle within).
 * `open` tells the hook when the dialog is mounted/visible.
 * `onEscape` is called on Escape. It is read through a ref that is refreshed each
 * render, so a changing callback identity does not re-run the effect — which
 * would otherwise re-capture the trigger mid-dialog and break the restore.
 */
export function useDialogFocus(panelRef: React.RefObject<HTMLElement | null>, open: boolean, onEscape: () => void) {
  const escapeRef = useRef(onEscape)

  // Refreshed on every render so the trap always calls the latest callback
  // without depending on its identity.
  useEffect(() => {
    escapeRef.current = onEscape
  })

  useEffect(() => {
    if (!open) return

    // Captured on open, not during render. `document.activeElement` is the
    // element that had focus the moment the dialog mounted, which is normally
    // the button the user activated.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        escapeRef.current()
        return
      }
      if (event.key !== "Tab") return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      )
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
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      // Only restore if the trigger is still in the document; a trigger removed
      // by the action it started (a row deleted, say) has no focus to give back.
      if (trigger && trigger.isConnected) trigger.focus()
    }
  }, [open, panelRef])
}
