import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const querySchema = z.string().uuid()

export async function GET(request: Request) {
  const invoiceId = querySchema.safeParse(new URL(request.url).searchParams.get("id"))
  if (!invoiceId.success) return NextResponse.json({ error: "Invoice ID is invalid." }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })

  const { data, error } = await supabase
    .from("invoices")
    .select("id, lifecycle_status, invoice_number, version, canonical_document, logo_asset_id_snapshot")
    .eq("id", invoiceId.data)
    .single()

  if (error || !data) return NextResponse.json({ error: "Invoice could not be loaded." }, { status: 404 })
  if (!["draft", "finalized"].includes(data.lifecycle_status)) return NextResponse.json({ error: "Trashed invoices cannot be opened in the editor." }, { status: 409 })

  let logoUrl: string | null = null
  if (data.lifecycle_status === "finalized" && data.logo_asset_id_snapshot) {
    const { data: asset } = await supabase.from("logo_assets").select("storage_path").eq("id", data.logo_asset_id_snapshot).single()
    if (asset?.storage_path) {
      const { data: signed } = await supabase.storage.from("seller-logos").createSignedUrl(asset.storage_path, 3600)
      logoUrl = signed?.signedUrl ?? null
    }
  }

  return NextResponse.json({
    id: data.id,
    invoiceNumber: data.invoice_number,
    lifecycleStatus: data.lifecycle_status,
    logoUrl,
    version: data.version,
    document: data.canonical_document,
  })
}
