import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bucketName = "seller-logos"
const pageSize = 1_000
const removeBatchSize = 100

type StorageEntry = { name: string; id: string | null }
type PurgeJob = {
  id: string
  workspace_id: string | null
  allowlist_entry_id: string | null
  target_user_id: string | null
  retry_count: number
}

class PurgeFailure extends Error {
  code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function secretsMatch(received: string | null, expected: string) {
  if (!received) return false
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

function isMissingAuthUser(error: { status?: number; code?: string; message?: string } | null) {
  if (!error) return false
  const message = (error.message ?? "").toLowerCase()
  return error.status === 404 || error.code === "user_not_found" || message.includes("not found")
}

async function listWorkspaceStoragePaths(storage: ReturnType<NonNullable<ReturnType<typeof createSupabaseAdminClient>>["storage"]["from"]>, workspaceId: string) {
  const files: string[] = []
  const pending = [`workspaces/${workspaceId}`]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const path = pending.shift()
    if (!path || visited.has(path)) continue
    visited.add(path)

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await storage.list(path, { limit: pageSize, offset })
      if (error) throw new PurgeFailure("storage_list_failed")

      for (const entry of (data ?? []) as StorageEntry[]) {
        const entryPath = `${path}/${entry.name}`
        if (entry.id) files.push(entryPath)
        else pending.push(entryPath)
      }

      if (!data || data.length < pageSize) break
    }
  }

  return files
}

async function removeWorkspaceStorage(storage: ReturnType<NonNullable<ReturnType<typeof createSupabaseAdminClient>>["storage"]["from"]>, workspaceId: string) {
  const paths = await listWorkspaceStoragePaths(storage, workspaceId)
  for (let index = 0; index < paths.length; index += removeBatchSize) {
    const { error } = await storage.remove(paths.slice(index, index + removeBatchSize))
    if (error) throw new PurgeFailure("storage_remove_failed")
  }
}

async function deleteAuthUser(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string) {
  const { data, error: lookupError } = await admin.auth.admin.getUserById(userId)
  if (lookupError && !isMissingAuthUser(lookupError)) throw new PurgeFailure("auth_lookup_failed")
  if (!data.user && lookupError) return
  if (!data.user) return

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError && !isMissingAuthUser(deleteError)) throw new PurgeFailure("auth_delete_failed")
}

async function processJob(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, job: PurgeJob) {
  let targetUserId = job.target_user_id
  if (!targetUserId && job.workspace_id) {
    const { data, error } = await admin
      .from("workspaces")
      .select("owner_user_id")
      .eq("id", job.workspace_id)
      .maybeSingle()
    if (error) throw new PurgeFailure("workspace_lookup_failed")
    targetUserId = data?.owner_user_id ?? null
  }
  if (!targetUserId) throw new PurgeFailure("missing_target_user")

  if (job.workspace_id) {
    await removeWorkspaceStorage(admin.storage.from(bucketName), job.workspace_id)

    // Remove invoice snapshots before the workspace cascade. Historical logo
    // protection intentionally blocks deleting a logo while finalized invoices
    // still reference it, but account purge is the explicit data-erasure path.
    const { error: invoiceDeleteError } = await admin
      .from("invoices")
      .delete()
      .eq("workspace_id", job.workspace_id)
    if (invoiceDeleteError) throw new PurgeFailure("invoice_delete_failed")

    const { error } = await admin
      .from("workspaces")
      .delete()
      .eq("id", job.workspace_id)
    if (error) throw new PurgeFailure("workspace_delete_failed")
  }

  await deleteAuthUser(admin, targetUserId)

  const completedAt = new Date().toISOString()
  if (job.allowlist_entry_id) {
    const { error } = await admin
      .from("allowlist_entries")
      .update({ status: "purged", purge_completed_at: completedAt })
      .eq("id", job.allowlist_entry_id)
    if (error) throw new PurgeFailure("allowlist_update_failed")
  }

  const { error } = await admin
    .from("account_purge_jobs")
    .update({
      workspace_id: null,
      status: "complete",
      last_error_code: null,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", job.id)
    .eq("status", "running")
  if (error) throw new PurgeFailure("job_complete_failed")
}

async function handlePurgeRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "Purge worker is not configured: set CRON_SECRET in the server environment." }, { status: 503 })
  }

  const authorization = request.headers.get("authorization")
  const bearerSecret = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null
  const headerSecret = request.headers.get("x-cron-secret")
  if (!secretsMatch(bearerSecret, cronSecret) && !secretsMatch(headerSecret, cronSecret)) {
    return NextResponse.json({ error: "Invalid purge worker credentials." }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Purge worker is not configured: set SUPABASE_SERVICE_ROLE_KEY server-side." }, { status: 503 })
  }

  const { data: jobs, error: claimError } = await admin.rpc("claim_account_purge_jobs", { p_limit: 10 })
  if (claimError) {
    return NextResponse.json({ error: "Pending purge jobs could not be claimed." }, { status: 500 })
  }

  const failures: Array<{ id: string; errorCode: string }> = []
  let completed = 0
  for (const job of (jobs ?? []) as PurgeJob[]) {
    try {
      await processJob(admin, job)
      completed += 1
    } catch (error: unknown) {
      const errorCode = error instanceof PurgeFailure ? error.code : "purge_failed"
      failures.push({ id: job.id, errorCode })
      await admin
        .from("account_purge_jobs")
        .update({ status: "failed", last_error_code: errorCode, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "running")
    }
  }

  return NextResponse.json({ claimed: (jobs ?? []).length, completed, failed: failures })
}

// Vercel Cron issues a GET request with `Authorization: Bearer $CRON_SECRET`, so
// the worker must answer GET as well as the POST used for manual/retry runs.
export async function GET(request: Request) {
  return handlePurgeRequest(request)
}

export async function POST(request: Request) {
  return handlePurgeRequest(request)
}
