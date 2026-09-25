"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [mode, setMode] = useState<"request" | "update">("request")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setMode("update")
    })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setMessage("")
    setError("")
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Supabase is not configured yet. Add the values from .env.example to enable password reset.")
      setLoading(false)
      return
    }

    if (mode === "update") {
      if (password !== confirm) {
        setError("Passwords do not match.")
        setLoading(false)
        return
      }
      const result = await supabase.auth.updateUser({ password })
      if (result.error) setError(result.error.message)
      else {
        setPassword("")
        setConfirm("")
        setMessage("Your password was updated. You can now continue using your account.")
      }
    } else {
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset-password` })
      if (result.error) setError(result.error.message)
      else setMessage("If an account exists for that email, a password reset link is on its way.")
    }
    setLoading(false)
  }

  const title = mode === "update" ? "Choose a new password" : "Reset your password"
  const description = mode === "update" ? "Set a new password for your QuickInvoice-BD account." : "Enter your account email and we will send a secure reset link."

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"><div className="pointer-events-none absolute inset-0" aria-hidden="true"><div className="absolute left-1/2 top-[-25%] h-[26rem] w-[44rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(220,231,223,0.72),transparent_70%)]" /></div><div className="relative w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-4 duration-500"><Link className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground" href="/auth/login"><ArrowLeft size={16} />Back to sign in</Link><div className="surface p-6 sm:p-8"><div className="mb-8"><BrandLogo size="auth" className="mb-5" /><h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></div><form className="space-y-4" onSubmit={submit}>{mode === "update" ? <><Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" required /><Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" required /></> : <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />}<Button className="h-11 w-full" type="submit" disabled={loading}>{loading ? mode === "update" ? "Updating…" : "Sending…" : mode === "update" ? "Update password" : "Send reset link"}</Button></form>{message && <p className="notice-success mt-4" role="status">{message}</p>}{error && <p className="notice-error mt-4" role="alert">{error}</p>}</div></div></main>
}

function Field({ label, type, value, onChange, autoComplete, required }: { label: string; type: string; value: string; onChange: (value: string) => void; autoComplete: string; required?: boolean }) { return <label className="block"><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required && <span className="ml-1 text-destructive">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required={required} /></label> }
