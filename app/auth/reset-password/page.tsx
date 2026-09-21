"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setMessage("")
    setError("")
    const supabase = createSupabaseBrowserClient()
    if (!supabase) setError("Supabase is not configured yet. Add the values from .env.example to enable password reset.")
    else {
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset-password` })
      if (result.error) setError(result.error.message)
      else setMessage("If an account exists for that email, a password reset link is on its way.")
    }
    setLoading(false)
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-4 py-10"><div className="w-full max-w-md"><Link className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-950" href="/auth/login"><ArrowLeft size={16} />Back to sign in</Link><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8"><div className="mb-8"><BrandLogo size="auth" className="-ml-4 mb-1" /><h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1><p className="mt-2 text-sm leading-6 text-slate-500">Enter your account email and we will send a secure reset link.</p></div><form className="space-y-4" onSubmit={submit}><label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Email<span className="ml-1 text-rose-500">*</span></span><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><Button className="h-11 w-full" type="submit" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</Button></form>{message && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700" role="status">{message}</p>}{error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700" role="alert">{error}</p>}</div></div></main>
}
