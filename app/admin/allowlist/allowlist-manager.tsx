"use client"

import Link from "next/link"
import { FormEvent, useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, MailPlus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"

type PurgeJob = {
  status: "pending" | "running" | "complete" | "failed"
  retryCount: number
  lastErrorCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

type AllowlistEntry = {
  id: string
  email: string
  normalizedEmail: string
  status: "approved" | "removed" | "purge_pending" | "purged"
  createdAt: string
  removedAt: string | null
  purgeCompletedAt: string | null
  purgeJob: PurgeJob | null
}

function formatDate(value: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function statusClasses(status: AllowlistEntry["status"] | PurgeJob["status"]) {
  if (status === "approved" || status === "complete") return "bg-emerald-500/10 text-emerald-800"
  if (status === "failed") return "bg-rose-500/10 text-destructive"
  if (status === "running") return "bg-sky-500/10 text-sky-800"
  return "bg-amber-500/10 text-amber-300"
}

export function AllowlistManager({ currentEmail }: { currentEmail: string }) {
  const [entries, setEntries] = useState<AllowlistEntry[]>([])
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/admin/allowlist", { cache: "no-store" })
      const result = await response.json() as { entries?: AllowlistEntry[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Allowlist could not be loaded.")
      setEntries(result.entries ?? [])
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Allowlist could not be loaded.")
    } finally {
      if (background) setRefreshing(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => load())
  }, [load])

  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Allowlist entry could not be added.")
      setEmail("")
      setMessage("Email approved for the private beta.")
      await load(true)
    } catch (addError: unknown) {
      setError(addError instanceof Error ? addError.message : "Allowlist entry could not be added.")
    } finally {
      setSaving(false)
    }
  }

  const removeEntry = async (entry: AllowlistEntry) => {
    const confirmed = window.confirm(`Remove ${entry.email} from the approved allowlist? If this account exists, it will be disabled and queued for permanent purge.`)
    if (!confirmed) return

    setRemovingId(entry.id)
    setError("")
    setMessage("")
    try {
      const response = await fetch(`/api/admin/allowlist?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Allowlist entry could not be removed.")
      setMessage(entry.status === "approved" ? "Allowlist entry removed. Existing account data is queued for purge." : "Allowlist entry removed.")
      await load(true)
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : "Allowlist entry could not be removed.")
    } finally {
      setRemovingId(null)
    }
  }

  return <main className="min-h-screen bg-transparent text-foreground">
    <header className="glass-header">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Administration</p>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Allowlist and account lifecycle</h1>
        </div>
        <Link className={`${buttonVariants({ variant: "outline", size: "sm" })} shrink-0`} href="/invoices">Back to workspace</Link>
      </div>
    </header>

    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <section className="surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/80 text-muted-foreground"><ShieldCheck size={19} /></span>
            <div><h2 className="font-semibold">Private beta access</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Signed in as <span className="font-medium text-foreground/80">{currentEmail}</span>. Only active administrators can change this list.</p></div>
          </div>
          <Button className="shrink-0" variant="outline" size="sm" type="button" disabled={loading || refreshing} onClick={() => void load(true)}><RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh status"}</Button>
        </div>
        <form className="mt-6 flex flex-col gap-3 border-t border-border/60 pt-5 sm:flex-row" onSubmit={addEntry}>
          <label className="min-w-0 flex-1"><span className="sr-only">Email address</span><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" autoComplete="email" required maxLength={320} /></label>
          <Button className="h-11 shrink-0" type="submit" disabled={saving}><MailPlus data-icon="inline-start" />{saving ? "Approving…" : "Approve email"}</Button>
        </form>
        {message && <p className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800" role="status"><CheckCircle2 size={16} />{message}</p>}
        {error && <p className="mt-4 flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-destructive" role="alert"><AlertTriangle size={16} />{error}</p>}
      </section>

      <section className="surface" aria-busy={loading}>
        <div className="border-b border-border px-5 py-4 sm:px-6"><h2 className="font-semibold">Allowlist entries</h2><p className="mt-1 text-sm text-muted-foreground">Removing an existing account disables its workspace immediately. The protected worker removes private logo files and account data.</p></div>
        {loading ? <p className="p-8 text-sm text-muted-foreground">Loading allowlist…</p> : entries.length === 0 ? <div className="p-8 text-center"><p className="font-medium">No allowlist entries yet</p><p className="mt-2 text-sm text-muted-foreground">Approve an email above to invite the first account.</p></div> : <div className="divide-y divide-border/70">
          {entries.map((entry) => <article className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:px-6" key={entry.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="break-all font-semibold">{entry.email}</p><span className={`rounded-lg border border-border px-2 py-0.5 text-[11px] font-mono font-semibold capitalize ${statusClasses(entry.status)}`}>{entry.status.replace("_", " ")}</span></div>
              <p className="mt-2 text-xs text-muted-foreground">Added {formatDate(entry.createdAt)}{entry.removedAt ? ` · Removed ${formatDate(entry.removedAt)}` : ""}</p>
              {entry.purgeJob && <div className="mt-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">Purge</span><span className={`rounded-lg border border-border px-2 py-0.5 text-[11px] font-mono font-semibold capitalize ${statusClasses(entry.purgeJob.status)}`}>{entry.purgeJob.status}</span><span>Attempt {entry.purgeJob.retryCount}</span></div>{entry.purgeJob.lastErrorCode && <p className="mt-1 text-destructive">Last worker error: {entry.purgeJob.lastErrorCode}</p>}{entry.purgeJob.completedAt && <p className="mt-1">Completed {formatDate(entry.purgeJob.completedAt)}</p>}</div>}
            </div>
            <Button className="min-h-10 shrink-0 self-stretch sm:self-start" variant="outline" size="sm" type="button" disabled={removingId === entry.id} onClick={() => void removeEntry(entry)}><Trash2 data-icon="inline-start" />{removingId === entry.id ? "Removing…" : "Remove"}</Button>
          </article>)}
        </div>}
      </section>

      <aside className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-5 text-sm leading-6 text-amber-950 sm:p-6">
        <h2 className="font-semibold">Purge worker setup</h2>
        <p className="mt-1">Purges are not run by the browser. Configure a server-side cron job to POST to <code className="rounded-lg border border-amber-400/30 bg-amber-400/15 px-1.5 py-0.5 font-mono text-xs">/api/internal/purge</code> with <code className="rounded-lg border border-amber-400/30 bg-amber-400/15 px-1.5 py-0.5 font-mono text-xs">Authorization: Bearer CRON_SECRET</code>. Keep both <code className="rounded-lg border border-amber-400/30 bg-amber-400/15 px-1.5 py-0.5 font-mono text-xs">CRON_SECRET</code> and <code className="rounded-lg border border-amber-400/30 bg-amber-400/15 px-1.5 py-0.5 font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code> in server-only environment variables. Refresh this page to see the result.</p>
      </aside>
    </div>
  </main>
}
