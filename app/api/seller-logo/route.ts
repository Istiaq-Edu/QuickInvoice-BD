import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const maxBytes = 2 * 1024 * 1024
const fileTypes = {
  "image/png": { extension: "png", signature: (bytes: Uint8Array) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value) },
  "image/jpeg": { extension: "jpg", signature: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/webp": { extension: "webp", signature: (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP" },
} as const

async function getWorkspaceId(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>, userId: string) {
  const { data } = await supabase.from("profiles").select("workspace_id").eq("user_id", userId).single()
  return data?.workspace_id ?? null
}

async function getContext() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) }
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return { error: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) }
  const workspaceId = await getWorkspaceId(supabase, authData.user.id)
  if (!workspaceId) return { error: NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 }) }
  return { supabase, workspaceId }
}

export async function GET() {
  const context = await getContext()
  if (context.error) return context.error
  const { data: workspace, error: workspaceError } = await context.supabase.from("workspaces").select("current_logo_asset_id").eq("id", context.workspaceId).single()
  if (workspaceError || !workspace?.current_logo_asset_id) return NextResponse.json({ logo: null })
  const { data: asset, error: assetError } = await context.supabase.from("logo_assets").select("id, mime_type, byte_size").eq("id", workspace.current_logo_asset_id).is("deleted_at", null).single()
  if (assetError || !asset) return NextResponse.json({ logo: null })
  const { data: pathData, error: pathError } = await context.supabase.from("logo_assets").select("storage_path").eq("id", asset.id).single()
  if (pathError || !pathData) return NextResponse.json({ logo: null })
  const { data: signed, error: signedError } = await context.supabase.storage.from("seller-logos").createSignedUrl(pathData.storage_path, 3600)
  if (signedError || !signed?.signedUrl) return NextResponse.json({ logo: null })
  return NextResponse.json({ logo: { id: asset.id, url: signed.signedUrl, mimeType: asset.mime_type, byteSize: asset.byte_size } })
}

export async function POST(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const formData = await request.formData().catch(() => null)
  const file = formData?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a logo file first." }, { status: 400 })
  if (file.size < 1 || file.size > maxBytes) return NextResponse.json({ error: "Logo must be smaller than 2 MB." }, { status: 400 })
  const type = fileTypes[file.type as keyof typeof fileTypes]
  if (!type) return NextResponse.json({ error: "Logo must be a PNG, JPEG, or WebP image." }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!type.signature(bytes)) return NextResponse.json({ error: "The file contents do not match its image type." }, { status: 400 })

  const assetId = crypto.randomUUID()
  const storagePath = `workspaces/${context.workspaceId}/logos/${assetId}.${type.extension}`
  const { error: uploadError } = await context.supabase.storage.from("seller-logos").upload(storagePath, file, { contentType: file.type, cacheControl: "31536000", upsert: false })
  if (uploadError) return NextResponse.json({ error: "Logo could not be uploaded." }, { status: 500 })

  const { error: assetError } = await context.supabase.from("logo_assets").insert({ id: assetId, workspace_id: context.workspaceId, storage_path: storagePath, mime_type: file.type, byte_size: file.size, content_hash: `${file.size}:${file.lastModified}` })
  if (assetError) {
    await context.supabase.storage.from("seller-logos").remove([storagePath])
    return NextResponse.json({ error: "Logo metadata could not be saved." }, { status: 500 })
  }

  const { data: switched, error: switchError } = await context.supabase.rpc("set_current_logo", { p_logo_asset_id: assetId })
  if (switchError || switched !== true) {
    await context.supabase.from("logo_assets").delete().eq("id", assetId)
    await context.supabase.storage.from("seller-logos").remove([storagePath])
    return NextResponse.json({ error: "Logo could not be activated." }, { status: 500 })
  }

  const { data: signed } = await context.supabase.storage.from("seller-logos").createSignedUrl(storagePath, 3600)
  return NextResponse.json({ logo: { id: assetId, url: signed?.signedUrl ?? null, mimeType: file.type, byteSize: file.size } }, { status: 201 })
}

export async function DELETE() {
  const context = await getContext()
  if (context.error) return context.error
  const { data, error } = await context.supabase.rpc("set_current_logo", { p_logo_asset_id: null })
  if (error || data !== true) return NextResponse.json({ error: "Logo could not be removed." }, { status: 500 })
  return NextResponse.json({ success: true })
}
