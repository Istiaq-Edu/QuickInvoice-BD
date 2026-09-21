"use client"


import { FormEvent, useEffect, useState } from "react"
import { Pencil, Search, Trash2, X } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { Button } from "@/components/ui/button"

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

  return <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
    <WorkspaceHeader backHref="/invoices" />
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Customers</h1><p className="mt-2 text-sm text-slate-500">Keep reusable customer details for faster invoice creation.</p></div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" onSubmit={save}><div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{editingId ? "Edit customer" : "New customer"}</p><h2 className="mt-1 font-semibold">{editingId ? "Update details" : "Add a customer"}</h2></div>{editingId && <button className="text-slate-400 hover:text-slate-950" type="button" aria-label="Cancel editing" onClick={reset}><X size={18} /></button>}</div><div className="space-y-4"><Field label="Company name" value={form.companyName} onChange={(value) => update("companyName", value)} /><Field label="Contact name" value={form.name} onChange={(value) => update("name", value)} required /><Field label="Email" type="email" value={form.email} onChange={(value) => update("email", value)} /><Field label="Phone" value={form.phone} onChange={(value) => update("phone", value)} /><Field label="Website" type="url" value={form.website} onChange={(value) => update("website", value)} /><label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Address</span><textarea className="field min-h-24 resize-y" value={form.address} onChange={(event) => update("address", event.target.value)} /></label></div><div className="mt-5 flex items-center gap-3"><Button className="h-10" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Add customer"}</Button>{message && <p className="text-xs text-emerald-700" role="status">{message}</p>}</div></form>
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Customer directory" aria-busy={loading}><div className="border-b border-slate-200 p-4 sm:p-5"><label className="relative block"><span className="sr-only">Search customers</span><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className="field pl-9" placeholder="Search customers" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>{error && <p className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}{loading ? <p className="p-8 text-sm text-slate-500">Loading customers…</p> : customers.length === 0 ? <div className="p-8 text-center"><p className="font-medium">{query ? "No customers match your search" : "No customers yet"}</p><p className="mt-2 text-sm text-slate-500">Add a customer to reuse their details on future invoices.</p></div> : <div className="divide-y divide-slate-100">{customers.map((customer) => <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5" key={customer.id}><div className="min-w-0"><p className="font-semibold">{customer.companyName || customer.name}</p>{customer.companyName && <p className="text-sm text-slate-600">{customer.name}</p>}{(customer.email || customer.phone) && <p className="mt-1 text-xs text-slate-500">{[customer.email, customer.phone].filter(Boolean).join(" · ")}</p>}{customer.address && <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{customer.address}</p>}</div><div className="flex shrink-0 gap-3"><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:underline" type="button" onClick={() => edit(customer)}><Pencil size={13} />Edit</button><button className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:underline" type="button" onClick={() => void remove(customer)}><Trash2 size={13} />Remove</button></div></div>)}</div>}</section>
      </div>
    </div>
  </main>
}

function Field({ label, type = "text", value, onChange, required }: { label: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>
}
