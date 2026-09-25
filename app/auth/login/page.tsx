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
  const [error, setError] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "confirmation_failed" ? "That confirmation link is invalid or expired. Request a new confirmation email and try again." : "")
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


  return <AuthShell title="Welcome back" description="Sign in to access saved invoices and customers."><form className="space-y-4" onSubmit={submit}><Field label="Email" type="email" value={email} onChange={setEmail} required /><Field label="Password" type="password" value={password} onChange={setPassword} required /><div className="flex justify-end"><Link className="text-xs font-medium text-muted-foreground transition hover:text-foreground" href="/auth/reset-password">Forgot password?</Link></div><Button className="h-11 w-full" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button></form>{message && <Notice>{message}</Notice>}{error && <p className="notice-error mt-4" role="alert">{error}</p>}<p className="mt-6 text-center text-xs text-muted-foreground/80">Private beta access is invite-only. <Link className="font-medium text-foreground underline decoration-primary/50 underline-offset-4 transition hover:text-foreground" href="/auth/signup">Create an account</Link></p></AuthShell>
}

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"><div className="pointer-events-none absolute inset-0" aria-hidden="true"><div className="absolute left-1/2 top-[-25%] h-[26rem] w-[44rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(220,231,223,0.72),transparent_70%)]" /></div><div className="relative w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-4 duration-500"><Link className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground" href="/"><ArrowLeft size={16} />Back to invoice</Link><div className="surface p-6 sm:p-8"><div className="mb-8"><BrandLogo size="auth" className="mb-5" /><h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></div>{children}</div></div></main> }

function Field({ label, type, value, onChange, required }: { label: string; type: string; value: string; onChange: (value: string) => void; required?: boolean }) { const autocomplete = type === "email" ? "email" : type === "password" ? "current-password" : undefined; return <label className="block"><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required && <span className="ml-1 text-destructive">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autocomplete} required={required} /></label> }
function Notice({ children }: { children: React.ReactNode }) { return <p className="notice-success mt-4" role="status"><CheckCircle2 size={14} />{children}</p> }
