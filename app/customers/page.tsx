"use client"


import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { LockKeyhole, Pencil, Search, Trash2, UserRound, X } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { Button, buttonVariants } from "@/components/ui/button"

type Customer = {
  id: string
  companyName: string
  name: string
  address: string
  email: string
  phone: string
  website: string
}

type CustomerForm = Omit<Customer, "id">
const emptyForm: CustomerForm = { companyName: "", name: "", address: "", email: "", phone: "", website: "" }

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [query, setQuery] = useState("")
  const [form, setForm] = useState<CustomerForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/customers${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`, { signal: controller.signal }).then(async (response) => {
        const result = await response.json() as { customers?: Customer[]; error?: string }
        if (!response.ok) throw new Error(result.error ?? "Customers could not be loaded.")
        setCustomers(result.customers ?? [])
        setLoading(false)
      }).catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return
        setError(requestError instanceof Error ? requestError.message : "Customers could not be loaded.")
        setLoading(false)
      })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])

  const update = (key: keyof CustomerForm, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const reset = () => { setForm(emptyForm); setEditingId(null); setMessage("") }
  const edit = (customer: Customer) => { setEditingId(customer.id); setForm({ companyName: customer.companyName, name: customer.name, address: customer.address, email: customer.email, phone: customer.phone, website: customer.website }); setMessage("") }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/customers", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingId ? { ...form, id: editingId } : form) })
      const result = await response.json() as { customer?: Customer; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Customer could not be saved.")
      setMessage(editingId ? "Customer updated." : "Customer added.")
      reset()
      setMessage(editingId ? "Customer updated." : "Customer added.")
      const refresh = await fetch(`/api/customers${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`)
      const refreshed = await refresh.json() as { customers?: Customer[] }
      setCustomers(refreshed.customers ?? [])
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Customer could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (customer: Customer) => {
    if (!window.confirm(`Remove ${customer.companyName || customer.name} from your customer directory?`)) return
    setError("")
    try {
      const response = await fetch(`/api/customers?id=${encodeURIComponent(customer.id)}`, { method: "DELETE" })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Customer could not be removed.")
      setCustomers((current) => current.filter((item) => item.id !== customer.id))
      if (editingId === customer.id) reset()
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Customer could not be removed.")
    }
  }

  const requiresAuthentication = error.toLowerCase().includes("authentication") || error.toLowerCase().includes("sign in")

  return <main className="min-h-screen bg-transparent text-foreground">
    <WorkspaceHeader backHref="/invoices" active="customers" />
    <div className="workspace-page">
      <WorkspacePageHeader
        eyebrow="Workspace"
        title="Customers"
        description="Keep trusted customer details ready for faster invoicing and more consistent documents."
      />
      {loading && <div className="surface p-8 text-sm text-muted-foreground">Loading customers…</div>}
      {!loading && requiresAuthentication && <div className="surface flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-primary"><LockKeyhole size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Your customer directory is private</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Sign in to save customer details once, reuse them on future invoices, and keep every invoice accurate.</p><Link className={`${buttonVariants()} mt-6`} href="/auth/login">Sign in to continue</Link></div>}
      {!loading && !requiresAuthentication && <div className="grid items-start gap-6 lg:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
        <form className="surface p-5 sm:p-6 lg:sticky lg:top-24" onSubmit={save}><div className="mb-5 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary"><UserRound size={17} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{editingId ? "Edit customer" : "New customer"}</p><h2 className="mt-1 font-semibold">{editingId ? "Update details" : "Add a customer"}</h2></div></div>{editingId && <button className="text-muted-foreground hover:text-foreground" type="button" aria-label="Cancel editing" onClick={reset}><X size={18} /></button>}</div><div className="grid gap-4 sm:grid-cols-2"><Field label="Company name" value={form.companyName} onChange={(value) => update("companyName", value)} /><Field label="Contact name" value={form.name} onChange={(value) => update("name", value)} required /><Field label="Email" type="email" value={form.email} onChange={(value) => update("email", value)} /><Field label="Phone" value={form.phone} onChange={(value) => update("phone", value)} /><Field label="Website" type="url" value={form.website} onChange={(value) => update("website", value)} /><label className="block sm:col-span-2"><span className="mb-2 block text-sm font-medium text-foreground/80">Address</span><textarea className="field min-h-24 resize-y" value={form.address} onChange={(event) => update("address", event.target.value)} /></label></div><div className="mt-5 flex items-center gap-3 border-t border-border/80 pt-5"><Button className="h-10" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Add customer"}</Button>{message && <p className="text-xs text-emerald-800" role="status">{message}</p>}</div></form>
        <section className="surface" aria-label="Customer directory" aria-busy={loading}><div className="border-b border-border p-4 sm:p-5"><div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">Customer directory</h2><p className="mt-1 text-xs text-muted-foreground">{customers.length} {customers.length === 1 ? "saved customer" : "saved customers"}</p></div></div><label className="relative mt-4 block"><span className="sr-only">Search customers</span><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input className="field pl-9" placeholder="Search by company, contact, email or phone" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>{error && <p className="m-4 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}{loading ? <p className="p-8 text-sm text-muted-foreground">Loading customers…</p> : customers.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><span className="flex size-11 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"><UserRound size={19} /></span><p className="mt-4 font-heading text-xl font-medium">{query ? "No customers match your search" : "No customers yet"}</p><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{query ? "Try a different company name, contact, email, or phone number." : "Add a customer to reuse their details on future invoices."}</p></div> : <div className="divide-y divide-border/70">{customers.map((customer) => <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5" key={customer.id}><div className="flex min-w-0 items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-sm font-bold text-foreground">{((customer.companyName || customer.name || "?").trim().charAt(0) || "?").toUpperCase()}</span><div className="min-w-0"><p className="font-semibold">{customer.companyName || customer.name}</p>{customer.companyName && <p className="text-sm text-muted-foreground">{customer.name}</p>}{(customer.email || customer.phone) && <p className="mt-1 text-xs text-muted-foreground">{[customer.email, customer.phone].filter(Boolean).join(" · ")}</p>}{customer.address && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{customer.address}</p>}</div></div><div className="flex shrink-0 gap-3"><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-foreground/80 hover:bg-muted/60 hover:text-foreground hover:underline" type="button" onClick={() => edit(customer)}><Pencil size={13} />Edit</button><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-destructive hover:bg-rose-500/10 hover:underline" type="button" onClick={() => void remove(customer)}><Trash2 size={13} />Remove</button></div></div>)}</div>}</section>
      </div>}
    </div>
  </main>
}

function Field({ label, type = "text", value, onChange, required }: { label: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required && <span className="ml-1 text-destructive">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>
}
