import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const profileSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required.").max(500),
  sellerName: z.string().trim().min(1, "Seller name is required.").max(500),
  address: z.string().trim().max(2_000),
  email: z.string().trim().email().or(z.literal("")),
  phone: z.string().trim().max(100),
  website: z.string().trim().url().or(z.literal("")).optional(),
  logoAssetId: z.string().uuid().nullable().optional(),
})

async function getWorkspaceId(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>, userId: string) {
  const { data } = await supabase.from("profiles").select("workspace_id").eq("user_id", userId).single()
  return data?.workspace_id ?? null
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
  const workspaceId = await getWorkspaceId(supabase, authData.user.id)
  if (!workspaceId) return NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 })

  const { data, error } = await supabase.from("seller_profiles").select("company_name, seller_name, address_text, email, phone, website, logo_asset_id").eq("workspace_id", workspaceId).single()
  if (error || !data) return NextResponse.json({ error: "Seller profile could not be loaded." }, { status: 404 })

  let logoUrl: string | null = null
  if (data.logo_asset_id) {
    const { data: asset } = await supabase.from("logo_assets").select("storage_path").eq("id", data.logo_asset_id).is("deleted_at", null).maybeSingle()
    if (asset?.storage_path) {
      const { data: signed } = await supabase.storage.from("seller-logos").createSignedUrl(asset.storage_path, 3600)
      logoUrl = signed?.signedUrl ?? null
    }
  }

  return NextResponse.json({
    companyName: data.company_name,
    sellerName: data.seller_name,
    address: data.address_text,
    email: data.email,
    phone: data.phone,
    website: data.website,
    logoAssetId: data.logo_asset_id,
    logoUrl,
  }, { headers: { "cache-control": "no-store" } })
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
  const workspaceId = await getWorkspaceId(supabase, authData.user.id)
  if (!workspaceId) return NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 })

  const parsed = profileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Seller profile data is invalid." }, { status: 400 })

  const { data: existing, error: existingError } = await supabase.from("seller_profiles").select("website, logo_asset_id").eq("workspace_id", workspaceId).maybeSingle()
  if (existingError) return NextResponse.json({ error: "Seller profile could not be saved." }, { status: 500 })

  if (parsed.data.logoAssetId) {
    const { data: logo, error: logoError } = await supabase.from("logo_assets").select("id").eq("id", parsed.data.logoAssetId).eq("workspace_id", workspaceId).is("deleted_at", null).maybeSingle()
    if (logoError) return NextResponse.json({ error: "Seller profile could not be saved." }, { status: 500 })
    if (!logo) return NextResponse.json({ error: "The selected company logo is no longer available." }, { status: 400 })
  }

  const { data, error } = await supabase.from("seller_profiles").upsert({
    workspace_id: workspaceId,
    company_name: parsed.data.companyName,
    seller_name: parsed.data.sellerName,
    address_text: parsed.data.address,
    email: parsed.data.email,
    phone: parsed.data.phone,
    website: parsed.data.website ?? existing?.website ?? "",
    ...(parsed.data.logoAssetId !== undefined ? { logo_asset_id: parsed.data.logoAssetId } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" }).select("company_name, seller_name, address_text, email, phone, website").single()

  if (error || !data) return NextResponse.json({ error: "Seller profile could not be saved." }, { status: 500 })
  return NextResponse.json({ success: true })
}
