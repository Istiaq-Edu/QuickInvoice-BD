"use client"

import { useEffect, useState } from "react"

// Resolves the signed-in user's admin flag for navigation visibility only.
// Route handlers and admin pages still enforce authorization server-side.
export function useAdminStatus() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json() as { isAdmin?: boolean }
      })
      .then((result) => {
        if (result?.isAdmin === true) setIsAdmin(true)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  return isAdmin
}
