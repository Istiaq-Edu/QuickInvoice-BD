"use client"

import { useEffect, useState } from "react"

// One in-flight request shared by every consumer on the page.
//
// `useAdminStatus` is called from both the invoice page and the workspace header,
// and each call used to issue its own `fetch("/api/profile")`. On a page that
// renders both that is two identical round-trips to the same endpoint, and the
// admin link appeared only after the slower one resolved. A module-level promise
// means the request is made once and every caller awaits the same result.
let adminStatusRequest: Promise<boolean> | null = null

function fetchAdminStatus(): Promise<boolean> {
  if (!adminStatusRequest) {
    adminStatusRequest = fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false
        const body = await response.json() as { isAdmin?: boolean }
        return body?.isAdmin === true
      })
      .catch(() => false)
  }
  return adminStatusRequest
}

/**
 * Resolves the signed-in user's admin flag for navigation visibility only.
 *
 * Route handlers and admin pages still enforce authorization server-side; this
 * only decides whether the Admin link is worth showing.
 *
 * Returns `null` while unknown, so a caller can reserve the space instead of
 * letting the link pop in and shift the layout — the previous `false` default
 * was indistinguishable from "resolved, not an admin".
 */
export function useAdminStatus(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void fetchAdminStatus().then((value) => {
      if (active) setIsAdmin(value)
    })
    return () => {
      active = false
    }
  }, [])

  return isAdmin
}
