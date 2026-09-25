import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const itemSchema = z.object({
  description: z.string().trim().min(1, "Item description is required.").max(2_000),
  defaultUnitPrice: z.number().int().nonnegative(),
})
const itemIdSchema = z.string().uuid()


async function getContext() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) }
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return { error: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) }
  const { data: profile, error: profileError } = await supabase.from("profiles").select("workspace_id").eq("user_id", authData.user.id).single()
  if (profileError || !profile?.workspace_id) return { error: NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 }) }
  return { supabase, workspaceId: profile.workspace_id }
}

const selectFields = "id, description, default_unit_price, created_at, updated_at"
const mapItem = (item: { id: string; description: string; default_unit_price: number; created_at: string; updated_at: string }) => ({
  id: item.id,
  description: item.description,
  defaultUnitPrice: item.default_unit_price,
  createdAt: item.created_at,
  updatedAt: item.updated_at,
})

export async function GET(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  let builder = context.supabase.from("saved_items").select(selectFields).eq("workspace_id", context.workspaceId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(100)
  if (query) builder = builder.ilike("description", `%${query}%`)
  const { data, error } = await builder
  if (error) return NextResponse.json({ error: "Saved items could not be loaded." }, { status: 500 })
  return NextResponse.json({ items: (data ?? []).map(mapItem) }, { headers: { "cache-control": "no-store" } })
}

export async function POST(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const parsed = itemSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Saved item data is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("saved_items").insert({
    workspace_id: context.workspaceId,
    description: parsed.data.description,
    default_unit_price: parsed.data.defaultUnitPrice,
  }).select(selectFields).single()
  if (error || !data) return NextResponse.json({ error: "Saved item could not be created." }, { status: 500 })
  return NextResponse.json({ item: mapItem(data) }, { status: 201 })
}

export async function PATCH(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const body = await request.json().catch(() => null)
  const id = itemIdSchema.safeParse(body?.id)
  const parsed = itemSchema.safeParse(body)
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Saved item data is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("saved_items").update({
    description: parsed.data.description,
    default_unit_price: parsed.data.defaultUnitPrice,
    updated_at: new Date().toISOString(),
  }).eq("id", id.data).eq("workspace_id", context.workspaceId).is("deleted_at", null).select(selectFields).single()
  if (error || !data) return NextResponse.json({ error: "Saved item could not be updated." }, { status: 404 })
  return NextResponse.json({ item: mapItem(data) })
}

export async function DELETE(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const id = itemIdSchema.safeParse(new URL(request.url).searchParams.get("id"))
  if (!id.success) return NextResponse.json({ error: "Saved item ID is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("saved_items").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id.data).eq("workspace_id", context.workspaceId).is("deleted_at", null).select("id").maybeSingle()
  if (error || !data) return NextResponse.json({ error: "Saved item could not be deleted." }, { status: 404 })
  return NextResponse.json({ success: true })
}
