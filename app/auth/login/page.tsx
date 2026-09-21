"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2 } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setMessage("")
    setError("")
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Supabase is not configured yet. Add the values from .env.example to enable sign-in.")
      setLoading(false)
      return
    }
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (result.error) setError(result.error.message)
    else router.push("/")
    setLoading(false)
  }

  const signInWithGoogle = async () => {
    setLoading(true)
    setError("")
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError("Supabase is not configured yet. Add the values from .env.example to enable sign-in.")
      setLoading(false)
      return
    }
    const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })
    if (result.error) setError(result.error.message)
    setLoading(false)
  }

  return <AuthShell title="Welcome back" description="Sign in to access saved invoices and customers."><form className="space-y-4" onSubmit={submit}><Field label="Email" type="email" value={email} onChange={setEmail} required /><Field label="Password" type="password" value={password} onChange={setPassword} required /><div className="flex justify-end"><Link className="text-xs font-medium text-slate-500 hover:text-slate-950" href="/auth/reset-password">Forgot password?</Link></div><Button className="h-11 w-full" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button></form><div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div><Button className="h-11 w-full" variant="outline" type="button" onClick={signInWithGoogle} disabled={loading}>Continue with Google</Button>{message && <Notice>{message}</Notice>}{error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700" role="alert">{error}</p>}<p className="mt-6 text-center text-xs text-slate-500">Private beta access is invite-only. <Link className="font-medium text-slate-900 underline underline-offset-4" href="/auth/signup">Create an account</Link></p></AuthShell>
}

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-4 py-10"><div className="w-full max-w-md"><Link className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-950" href="/"><ArrowLeft size={16} />Back to invoice</Link><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8"><div className="mb-8"><BrandLogo size="auth" className="-ml-4 mb-1" /><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>{children}</div></div></main> }

function Field({ label, type, value, onChange, required }: { label: string; type: string; value: string; onChange: (value: string) => void; required?: boolean }) { return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label> }
function Notice({ children }: { children: React.ReactNode }) { return <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700"><CheckCircle2 size={14} />{children}</p> }
