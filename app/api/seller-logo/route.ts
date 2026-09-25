import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { LOGO_BUCKET, signLogoUrl } from "@/lib/supabase/logo"

const maxBytes = 2 * 1024 * 1024
/** Clamp client-reported pixel dimensions; they are display hints, not trusted data. */
const maxDimension = 4096
const fileTypes = {
  "image/png": { extension: "png", signature: (bytes: Uint8Array) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value) },
  "image/jpeg": { extension: "jpg", signature: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/webp": { extension: "webp", signature: (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP" },
} as const

type ServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>

function readDimension(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.min(parsed, maxDimension)
}

async function getWorkspaceId(supabase: ServerClient, userId: string) {
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

  // One lookup for the asset instead of two: the storage path used to be fetched
  // in a separate round trip that re-read the row we had just selected.
  const { data: asset, error: assetError } = await context.supabase
    .from("logo_assets")
    .select("id, storage_path, mime_type, byte_size, width, height")
    .eq("id", workspace.current_logo_asset_id)
    .is("deleted_at", null)
    .maybeSingle()
  if (assetError || !asset) return NextResponse.json({ logo: null })

  const url = await signLogoUrl(context.supabase, asset.storage_path)
  if (!url) return NextResponse.json({ logo: null })
  return NextResponse.json(
    { logo: { id: asset.id, url, mimeType: asset.mime_type, byteSize: asset.byte_size, width: asset.width, height: asset.height } },
    { headers: { "cache-control": "private, no-store" } },
  )
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
  const { error: uploadError } = await context.supabase.storage.from(LOGO_BUCKET).upload(storagePath, file, { contentType: file.type, cacheControl: "31536000", upsert: false })
  if (uploadError) return NextResponse.json({ error: "Logo could not be uploaded." }, { status: 500 })

  // The client already cropped and downscaled, so it can report the real pixel
  // size. Persisting it lets the UI reserve space and avoid layout shift.
  const width = readDimension(formData?.get("width") ?? null)
  const height = readDimension(formData?.get("height") ?? null)
  const { error: assetError } = await context.supabase.from("logo_assets").insert({ id: assetId, workspace_id: context.workspaceId, storage_path: storagePath, mime_type: file.type, byte_size: file.size, width, height, content_hash: `${file.size}:${file.lastModified}` })
  if (assetError) {
    await context.supabase.storage.from(LOGO_BUCKET).remove([storagePath])
    return NextResponse.json({ error: "Logo metadata could not be saved." }, { status: 500 })
  }

  const { data: switched, error: switchError } = await context.supabase.rpc("set_current_logo", { p_logo_asset_id: assetId })
  if (switchError || switched !== true) {
    await context.supabase.from("logo_assets").delete().eq("id", assetId)
    await context.supabase.storage.from(LOGO_BUCKET).remove([storagePath])
    return NextResponse.json({ error: "Logo could not be activated." }, { status: 500 })
  }

  const url = await signLogoUrl(context.supabase, storagePath)
  return NextResponse.json({ logo: { id: assetId, url, mimeType: file.type, byteSize: file.size, width, height } }, { status: 201 })
}

export async function DELETE() {
  const context = await getContext()
  if (context.error) return context.error
  const { data, error } = await context.supabase.rpc("set_current_logo", { p_logo_asset_id: null })
  if (error || data !== true) return NextResponse.json({ error: "Logo could not be removed." }, { status: 500 })
  return NextResponse.json({ success: true })
}
