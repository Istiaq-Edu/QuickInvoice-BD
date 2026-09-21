"use client"

import Image from "next/image"

import { FormEvent, useEffect, useState } from "react"
import { CheckCircle2, UserRound } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { Button } from "@/components/ui/button"

type SellerLogo = { id: string; url: string | null; mimeType: string; byteSize: number }
type SellerProfile = {
  companyName: string
  sellerName: string
  address: string
  email: string
  phone: string
  website: string
}

const emptyProfile: SellerProfile = { companyName: "", sellerName: "", address: "", email: "", phone: "", website: "" }

export default function AccountSettingsPage() {
  const [profile, setProfile] = useState<SellerProfile>(emptyProfile)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logo, setLogo] = useState<SellerLogo | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/seller-profile").then(async (response) => {
      const result = await response.json() as SellerProfile & { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Seller profile could not be loaded.")
      setProfile({ companyName: result.companyName ?? "", sellerName: result.sellerName ?? "", address: result.address ?? "", email: result.email ?? "", phone: result.phone ?? "", website: result.website ?? "" })
      setLoading(false)
    }).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : "Seller profile could not be loaded.")
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    fetch("/api/seller-logo").then(async (response) => {
      const result = await response.json() as { logo?: SellerLogo | null }
      if (response.ok) setLogo(result.logo ?? null)
    }).catch(() => undefined)
  }, [])

  const update = (key: keyof SellerProfile, value: string) => setProfile((current) => ({ ...current, [key]: value }))
  const uploadLogo = async () => {
    if (!logoFile) return
    setUploadingLogo(true)
    setMessage("")
    setError("")
    try {
      const body = new FormData()
      body.append("file", logoFile)
      const response = await fetch("/api/seller-logo", { method: "POST", body })
      const result = await response.json() as { logo?: SellerLogo; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Logo could not be uploaded.")
      setLogo(result.logo ?? null)
      setLogoFile(null)
      setMessage("Seller logo uploaded.")
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Logo could not be uploaded.")
    } finally {
      setUploadingLogo(false)
    }
  }
  const removeLogo = async () => {
    if (!window.confirm("Remove the seller logo from future invoices? Existing finalized invoices keep their snapshot.")) return
    setUploadingLogo(true)
    setError("")
    try {
      const response = await fetch("/api/seller-logo", { method: "DELETE" })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Logo could not be removed.")
      setLogo(null)
      setMessage("Seller logo removed from future invoices.")
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : "Logo could not be removed.")
    } finally {
      setUploadingLogo(false)
    }
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setMessage("")
    setError("")
    try {
      const response = await fetch("/api/seller-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Seller profile could not be saved.")
      setMessage("Seller profile saved. New invoices can reuse it.")
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Seller profile could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  return <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
    <WorkspaceHeader backHref="/invoices" />
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Account</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Seller profile</h1><p className="mt-2 text-sm text-slate-500">Save your business details once and reuse them on future invoices.</p></div>
      {loading && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading seller profile…</div>}
      {!loading && <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" onSubmit={save}>
        <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-5"><span className="flex size-10 items-center justify-center rounded-xl bg-slate-100"><UserRound size={18} /></span><div><h2 className="font-semibold">Business details</h2><p className="text-sm text-slate-500">Required fields are marked with an asterisk.</p></div></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Company name" value={profile.companyName} onChange={(value) => update("companyName", value)} required />
          <Field label="Seller name" value={profile.sellerName} onChange={(value) => update("sellerName", value)} required />
          <Field label="Email" type="email" value={profile.email} onChange={(value) => update("email", value)} />
          <Field label="Phone" value={profile.phone} onChange={(value) => update("phone", value)} />
          <Field label="Website" type="url" value={profile.website} onChange={(value) => update("website", value)} />
          <label className="block sm:col-span-2"><span className="mb-2 block text-sm font-medium text-slate-700">Address</span><textarea className="field min-h-28 resize-y" value={profile.address} onChange={(event) => update("address", event.target.value)} /></label>
        </div>
        <div className="mt-7 border-t border-slate-200 pt-6"><div className="mb-4"><h2 className="font-semibold">Seller logo</h2><p className="mt-1 text-sm text-slate-500">Use a PNG, JPEG, or WebP logo up to 2 MB. It stays private.</p></div><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">{logo?.url ? <Image src={logo.url} alt="Current seller logo" width={96} height={96} unoptimized className="max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-xs text-slate-400">No logo</span>}</div><div className="space-y-2"><input className="block max-w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} /><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" type="button" disabled={!logoFile || uploadingLogo} onClick={() => void uploadLogo}>{uploadingLogo ? "Uploading…" : "Upload logo"}</Button>{logo && <Button variant="ghost" size="sm" type="button" disabled={uploadingLogo} onClick={() => void removeLogo}>Remove logo</Button>}</div></div></div></div><div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center"><Button className="h-11" type="submit" disabled={saving}>{saving ? "Saving…" : "Save seller profile"}</Button>{message && <p className="flex items-center gap-2 text-sm text-emerald-700" role="status"><CheckCircle2 size={16} />{message}</p>}{error && <p className="text-sm text-rose-700" role="alert">{error}</p>}</div>
      </form>}
    </div>
  </main>
}

function Field({ label, type = "text", value, onChange, required }: { label: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>
}
