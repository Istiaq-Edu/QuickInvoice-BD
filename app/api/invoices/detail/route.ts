import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { resolveLogoUrl } from "@/lib/supabase/logo"

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

  const canonicalLogoAssetId = data.canonical_document && typeof data.canonical_document === "object" && typeof data.canonical_document.logoAssetId === "string"
    ? data.canonical_document.logoAssetId
    : null
  const logoAssetId = data.lifecycle_status === "finalized" ? data.logo_asset_id_snapshot : canonicalLogoAssetId
  const logoUrl = await resolveLogoUrl(supabase, logoAssetId)

  return NextResponse.json({
    id: data.id,
    invoiceNumber: data.invoice_number,
    lifecycleStatus: data.lifecycle_status,
    logoAssetId,
    logoUrl,
    version: data.version,
    document: data.canonical_document,
  })
}
