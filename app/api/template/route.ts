import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const defaultTemplateSettings = {
  accent: "slate" as const,
  showAddresses: true,
  showSellerContact: true,
  showBuyerContact: true,
  showNotes: true,
}

const templateSchema = z.object({
  accent: z.enum(["slate", "blue", "emerald", "indigo"]),
  showAddresses: z.boolean(),
  showSellerContact: z.boolean(),
  showBuyerContact: z.boolean(),
  showNotes: z.boolean(),
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

  const { data, error } = await supabase.from("templates").select("settings").eq("workspace_id", workspaceId).single()
  if (error || !data) return NextResponse.json({ settings: defaultTemplateSettings })
  const parsed = templateSchema.safeParse(data.settings)
  return NextResponse.json({ settings: parsed.success ? parsed.data : defaultTemplateSettings })
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 })
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
  const workspaceId = await getWorkspaceId(supabase, authData.user.id)
  if (!workspaceId) return NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 })

  const parsed = templateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Template settings are invalid." }, { status: 400 })
  const settings = { schemaVersion: 1, ...parsed.data }
  const { error } = await supabase.from("templates").upsert({ workspace_id: workspaceId, schema_version: 1, settings, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" })
  if (error) return NextResponse.json({ error: "Template settings could not be saved." }, { status: 500 })
  return NextResponse.json({ success: true, settings: parsed.data })
}
