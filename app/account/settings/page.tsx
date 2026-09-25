"use client"

import Image from "next/image"
import Link from "next/link"

import { FormEvent, useEffect, useState } from "react"
import { Building2, CheckCircle2, LockKeyhole, Upload } from "lucide-react"

import { WorkspaceHeader } from "@/components/workspace-header"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { LogoCropper, type CroppedLogo } from "@/components/logo-cropper"
import { Button, buttonVariants } from "@/components/ui/button"
import { MAX_UPLOAD_BYTES } from "@/lib/image/crop"

type SellerLogo = { id: string; url: string | null; mimeType: string; byteSize: number; width: number | null; height: number | null }
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
  const [pendingCrop, setPendingCrop] = useState<File | null>(null)
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

  const chooseLogo = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That image is larger than 2 MB. Choose a smaller file.")
      return
    }
    setError("")
    setPendingCrop(file)
  }
  const uploadLogo = async (logo: CroppedLogo) => {
    setUploadingLogo(true)
    setMessage("")
    setError("")
    try {
      const body = new FormData()
      body.append("file", logo.file)
      body.append("width", String(logo.width))
      body.append("height", String(logo.height))
      const response = await fetch("/api/seller-logo", { method: "POST", body })
      const result = await response.json() as { logo?: SellerLogo; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Logo could not be uploaded.")
      setLogo(result.logo ?? null)
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

  const requiresAuthentication = error.toLowerCase().includes("authentication") || error.toLowerCase().includes("sign in")

  return <main className="min-h-screen bg-transparent text-foreground">
    <WorkspaceHeader backHref="/invoices" active="profile" />
    <div className="workspace-page">
      <WorkspacePageHeader
        eyebrow="Account"
        title="Seller profile"
        description="Save the business information and logo that should appear on every new invoice."
      />
      {loading && <div className="surface p-8 text-sm text-muted-foreground">Loading seller profile…</div>}
      {!loading && requiresAuthentication && <div className="surface flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-muted text-primary"><LockKeyhole size={21} /></span><h2 className="mt-5 font-heading text-2xl font-medium">Your seller profile is private</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Sign in to save your business details once, keep your logo secure, and reuse both on future invoices.</p><Link className={`${buttonVariants()} mt-6`} href="/auth/login">Sign in to continue</Link></div>}
      {!loading && !requiresAuthentication && <form onSubmit={save}>
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <section className="surface p-5 sm:p-7">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-5"><span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/80 text-primary"><Building2 size={18} /></span><div><h2 className="font-semibold">Business details</h2><p className="mt-1 text-sm text-muted-foreground">Used as the sender identity on new documents.</p></div></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Company name" value={profile.companyName} onChange={(value) => update("companyName", value)} required />
              <Field label="Seller name" value={profile.sellerName} onChange={(value) => update("sellerName", value)} required />
              <Field label="Email" type="email" value={profile.email} onChange={(value) => update("email", value)} />
              <Field label="Phone" value={profile.phone} onChange={(value) => update("phone", value)} />
              <Field label="Website" type="url" value={profile.website} onChange={(value) => update("website", value)} />
              <label className="block sm:col-span-2"><span className="mb-2 block text-sm font-medium text-foreground/80">Address</span><textarea className="field min-h-28 resize-y" value={profile.address} onChange={(event) => update("address", event.target.value)} /></label>
            </div>
          </section>

          <aside className="surface p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-border pb-5"><span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/80 text-primary"><Upload size={18} /></span><div><h2 className="font-semibold">Brand mark</h2><p className="mt-1 text-sm text-muted-foreground">Private and used on new invoices.</p></div></div>
            <div className="flex size-32 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-muted/45">{logo?.url ? <Image src={logo.url} alt="Current seller logo" width={logo.width ?? 128} height={logo.height ?? 128} unoptimized className="max-h-full max-w-full object-contain" /> : <span className="px-3 text-center text-xs text-muted-foreground">No logo uploaded</span>}</div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">PNG, JPEG, or WebP up to 2 MB. You can crop and zoom to frame the logo before it is uploaded.</p>
            <input className="mt-5 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingLogo} onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ""; chooseLogo(chosen) }} />
            <div className="mt-3 flex flex-wrap gap-2">{logo && <Button variant="ghost" size="sm" type="button" disabled={uploadingLogo} onClick={() => void removeLogo}>{uploadingLogo ? "Working…" : "Remove logo"}</Button>}</div>
          </aside>
        </div>
        <div className="surface mt-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div><p className="text-sm font-semibold">Ready to reuse these details?</p><p className="mt-1 text-xs text-muted-foreground">New invoices can load this profile in one click.</p></div><div className="flex flex-col items-start gap-3 sm:items-end">{message && <p className="flex items-center gap-2 text-sm text-emerald-800" role="status"><CheckCircle2 size={16} />{message}</p>}{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button className="h-11 w-full sm:w-auto" type="submit" disabled={saving}>{saving ? "Saving…" : "Save seller profile"}</Button></div></div>
      </form>}
    </div>
    {pendingCrop && (
      <LogoCropper
        file={pendingCrop}
        onCancel={() => setPendingCrop(null)}
        onConfirm={(cropped) => {
          setPendingCrop(null)
          void uploadLogo(cropped)
        }}
      />
    )}
  </main>
}

function Field({ label, type = "text", value, onChange, required }: { label: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-foreground/80">{label}{required && <span className="ml-1 text-destructive">*</span>}</span><input className="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>
}
