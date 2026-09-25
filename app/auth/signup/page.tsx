"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setMessage("")
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Supabase is not configured yet. Add the values from .env.example to enable account creation.")
      setLoading(false)
      return
    }
    const result = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    if (result.error) setError(result.error.message)
    else setMessage("Check your email to verify your account. Private beta access is limited to approved addresses.")
    setLoading(false)
  }

  const resendConfirmation = async () => {
    const normalizedEmail = email.trim()
    setError("")
    setMessage("")
    if (!normalizedEmail) {
      setError("Enter your email address first.")
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Supabase is not configured yet. Add the values from .env.example to enable account creation.")
      setLoading(false)
      return
    }
    const result = await supabase.auth.resend({ type: "signup", email: normalizedEmail, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    if (result.error) setError(result.error.message)
    else setMessage("A new confirmation email was sent. Use the newest email and ignore older links.")
    setLoading(false)
  }

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"><div className="pointer-events-none absolute inset-0" aria-hidden="true"><div className="absolute left-1/2 top-[-25%] h-[26rem] w-[44rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(220,231,223,0.72),transparent_70%)]" /></div><div className="relative w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-4 duration-500"><Link className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground" href="/"><ArrowLeft size={16} />Back to invoice</Link><div className="surface p-6 sm:p-8"><div className="mb-8"><BrandLogo size="auth" className="mb-5" /><h1 className="text-2xl font-semibold tracking-tight text-foreground">Join the private beta</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Create an account to save invoices and customers across devices.</p></div><form className="space-y-4" onSubmit={submit}><Field label="Email" type="email" value={email} onChange={setEmail} required /><Field label="Password" type="password" value={password} onChange={setPassword} required /><Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} required /><Button className="h-11 w-full" type="submit" disabled={loading}>{loading ? "Creating account…" : "Create account"}</Button></form>{message && <p className="notice-success mt-4" role="status">{message}</p>}<button className="mt-4 w-full text-center text-xs font-medium text-muted-foreground underline decoration-primary/40 underline-offset-4 transition hover:text-foreground" type="button" onClick={resendConfirmation} disabled={loading}>Resend confirmation email</button>{error && <p className="notice-error mt-4" role="alert">{error}</p>}<p className="mt-6 text-center text-xs text-muted-foreground/80">Already have an account? <Link className="font-medium text-foreground underline decoration-primary/50 underline-offset-4 transition hover:text-foreground" href="/auth/login">Sign in</Link></p></div></div></main>
}

function Field({ label, type, value, onChange, required }: { label: string; type: string; value: string; onChange: (value: string) => void; required?: boolean }) { const autocomplete = type === "email" ? "email" : label.startsWith("Confirm") ? "new-password" : type === "password" ? "new-password" : undefined; return <label className="block"><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required && <span className="ml-1 text-destructive">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autocomplete} required={required} /></label> }
