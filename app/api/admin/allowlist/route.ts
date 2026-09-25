import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const emailSchema = z.object({ email: z.string().trim().email().max(320) })
const idSchema = z.string().uuid()

type AdminContext = {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>
  userId: string
}

async function getAdminContext(): Promise<{ context: AdminContext } | { error: NextResponse }> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) }

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return { error: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) }
  }

  // Single source of truth: the database function also requires an active
  // workspace, which a profiles-only check would miss.
  const { data: isAdmin, error: adminError } = await supabase.rpc("current_profile_is_admin")

  if (adminError) {
    return { error: NextResponse.json({ error: "Administrator status could not be checked." }, { status: 500 }) }
  }
  if (isAdmin !== true) {
    return { error: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) }
  }

  return { context: { supabase, userId: authData.user.id } }
}

function hasSameOrigin(request: Request) {
  const requestOrigin = request.headers.get("origin")
  if (!requestOrigin) return false

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
  try {
    return new URL(requestOrigin).origin === new URL(configuredOrigin).origin
  } catch {
    return false
  }
}

function rpcErrorResponse(error: { code?: string; message?: string }, fallback: string) {
  const message = error.message ?? ""
  if (error.code === "42501") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 })
  if (error.code === "22023") return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  if (error.code === "P0002") return NextResponse.json({ error: "Allowlist entry was not found." }, { status: 404 })
  if (error.code === "55000" && message.includes("last administrator")) {
    return NextResponse.json({ error: "The last administrator cannot be removed." }, { status: 409 })
  }
  if (error.code === "55000") {
    return NextResponse.json({ error: "This account is disabled and is pending purge." }, { status: 409 })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function GET() {
  const result = await getAdminContext()
  if ("error" in result) return result.error

  const [{ data: entries, error: entriesError }, { data: jobs, error: jobsError }] = await Promise.all([
    result.context.supabase
      .from("allowlist_entries")
      .select("id, email_original, email_normalized, status, created_at, removed_at, purge_completed_at")
      .order("created_at", { ascending: false }),
    result.context.supabase
      .from("account_purge_jobs")
      .select("id, allowlist_entry_id, status, retry_count, last_error_code, created_at, started_at, completed_at, updated_at")
      .order("created_at", { ascending: false }),
  ])

  if (entriesError || jobsError) {
    return NextResponse.json({ error: "Allowlist status could not be loaded." }, { status: 500 })
  }

  const purgeJobsByEntry = new Map((jobs ?? []).map((job) => [job.allowlist_entry_id, {
    status: job.status,
    retryCount: job.retry_count,
    lastErrorCode: job.last_error_code,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    updatedAt: job.updated_at,
  }]))

  return NextResponse.json({
    entries: (entries ?? []).map((entry) => ({
      id: entry.id,
      email: entry.email_original,
      normalizedEmail: entry.email_normalized,
      status: entry.status,
      createdAt: entry.created_at,
      removedAt: entry.removed_at,
      purgeCompletedAt: entry.purge_completed_at,
      purgeJob: purgeJobsByEntry.get(entry.id) ?? null,
    })),
  })
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 })
  }

  const result = await getAdminContext()
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = emailSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })

  const { data, error } = await result.context.supabase.rpc("admin_add_allowlist_entry", {
    p_email_original: parsed.data.email,
  })
  if (error) return rpcErrorResponse(error, "Allowlist entry could not be added.")

  const entry = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ entry }, { status: 201 })
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 })
  }

  const result = await getAdminContext()
  if ("error" in result) return result.error

  const id = idSchema.safeParse(new URL(request.url).searchParams.get("id"))
  if (!id.success) return NextResponse.json({ error: "Allowlist entry ID is invalid." }, { status: 400 })

  const { data, error } = await result.context.supabase.rpc("admin_remove_allowlist_entry", {
    p_entry_id: id.data,
  })
  if (error) return rpcErrorResponse(error, "Allowlist entry could not be removed.")

  return NextResponse.json({ result: Array.isArray(data) ? data[0] : data })
}
