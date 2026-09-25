import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const noteTemplateSchema = z.object({
  title: z.string().trim().min(1, "Note title is required.").max(200),
  body: z.string().trim().min(1, "Note body is required.").max(10_000),
})
const noteIdSchema = z.string().uuid()


async function getContext() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) }
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return { error: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) }
  const { data: profile, error: profileError } = await supabase.from("profiles").select("workspace_id").eq("user_id", authData.user.id).single()
  if (profileError || !profile?.workspace_id) return { error: NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 }) }
  return { supabase, workspaceId: profile.workspace_id }
}

const selectFields = "id, title, body, created_at, updated_at"
const mapNote = (note: { id: string; title: string; body: string; created_at: string; updated_at: string }) => ({
  id: note.id,
  title: note.title,
  body: note.body,
  createdAt: note.created_at,
  updatedAt: note.updated_at,
})

export async function GET(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  const { data, error } = await context.supabase.from("note_templates").select(selectFields).eq("workspace_id", context.workspaceId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: "Saved notes could not be loaded." }, { status: 500 })
  const normalizedQuery = query.toLowerCase()
  const notes = (data ?? []).filter((note) => !normalizedQuery || note.title.toLowerCase().includes(normalizedQuery) || note.body.toLowerCase().includes(normalizedQuery))
  return NextResponse.json({ notes: notes.map(mapNote) }, { headers: { "cache-control": "no-store" } })
}

export async function POST(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const parsed = noteTemplateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Saved note data is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("note_templates").insert({
    workspace_id: context.workspaceId,
    title: parsed.data.title,
    body: parsed.data.body,
  }).select(selectFields).single()
  if (error || !data) return NextResponse.json({ error: "Saved note could not be created." }, { status: 500 })
  return NextResponse.json({ note: mapNote(data) }, { status: 201 })
}

export async function PATCH(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const body = await request.json().catch(() => null)
  const id = noteIdSchema.safeParse(body?.id)
  const parsed = noteTemplateSchema.safeParse(body)
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Saved note data is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("note_templates").update({
    title: parsed.data.title,
    body: parsed.data.body,
    updated_at: new Date().toISOString(),
  }).eq("id", id.data).eq("workspace_id", context.workspaceId).is("deleted_at", null).select(selectFields).single()
  if (error || !data) return NextResponse.json({ error: "Saved note could not be updated." }, { status: 404 })
  return NextResponse.json({ note: mapNote(data) })
}

export async function DELETE(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const id = noteIdSchema.safeParse(new URL(request.url).searchParams.get("id"))
  if (!id.success) return NextResponse.json({ error: "Saved note ID is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("note_templates").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id.data).eq("workspace_id", context.workspaceId).is("deleted_at", null).select("id").maybeSingle()
  if (error || !data) return NextResponse.json({ error: "Saved note could not be deleted." }, { status: 404 })
  return NextResponse.json({ success: true })
}
