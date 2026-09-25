import { NextResponse } from "next/server"
import { authorizeWorkerRequest } from "@/lib/internal/worker-auth"
import { logoGraceDays, logoRetentionDays, logoSweepLimit } from "@/lib/internal/logo-retention"
import { createSupabaseAdminClient } from "@/lib/supabase/admin"
import { LOGO_BUCKET } from "@/lib/supabase/logo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const removeBatchSize = 100

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>

type RetiredAsset = { id: string; storage_path: string }

class SweepFailure extends Error {
  code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/**
 * Reclaims the storage of superseded logos.
 *
 * Runs in two passes so neither pass can destroy something still in use:
 * marking is done by the database under the selection rules in
 * mark_unused_logo_assets(), which skips the current logo, seller profiles and
 * any invoice that references the asset. Only assets that were already marked on
 * an earlier run, and only after the grace window, have their object removed.
 *
 * The object is removed before `storage_purged_at` is stamped, so a failed
 * removal is picked up again on the next run instead of leaking the file. Rows
 * are never hard deleted here; account purge still owns that.
 */
async function retireUnusedAssets(admin: AdminClient, retentionDays: number, batchLimit: number) {
  const { data, error } = await admin.rpc("mark_unused_logo_assets", { p_retention_days: retentionDays, p_limit: batchLimit })
  if (error) throw new SweepFailure("retire_failed")
  return Array.isArray(data) ? (data as string[]).length : 0
}

async function listSweepableAssets(admin: AdminClient, graceDays: number, batchLimit: number) {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await admin
    .from("logo_assets")
    .select("id, storage_path")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .is("storage_purged_at", null)
    .order("deleted_at", { ascending: true })
    .limit(batchLimit)
  if (error) throw new SweepFailure("list_failed")
  return (data ?? []) as RetiredAsset[]
}

async function removeObjects(admin: AdminClient, paths: string[]) {
  const storage = admin.storage.from(LOGO_BUCKET)
  for (let index = 0; index < paths.length; index += removeBatchSize) {
    const { error } = await storage.remove(paths.slice(index, index + removeBatchSize))
    if (error) throw new SweepFailure("storage_remove_failed")
  }
}

/**
 * Stamping happens per asset rather than in one statement so that a single
 * failed object removal only leaves that asset pending. The next run re-requests
 * it because `storage_purged_at` is still null.
 */
async function stampPurgedAssets(admin: AdminClient, ids: string[]) {
  const { error } = await admin
    .from("logo_assets")
    .update({ storage_purged_at: new Date().toISOString() })
    .in("id", ids)
  if (error) throw new SweepFailure("stamp_failed")
}

async function handleSweepRequest(request: Request) {
  const unauthorized = authorizeWorkerRequest(request, "Logo GC worker is not configured: set CRON_SECRET in the server environment.")
  if (unauthorized) return unauthorized

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Logo GC worker is not configured: set SUPABASE_SERVICE_ROLE_KEY server-side." }, { status: 503 })
  }

  const retentionDays = logoRetentionDays()
  const graceDays = logoGraceDays()
  const batchLimit = logoSweepLimit()

  let retired = 0
  try {
    retired = await retireUnusedAssets(admin, retentionDays, batchLimit)
  } catch (retireFailure: unknown) {
    const errorCode = retireFailure instanceof SweepFailure ? retireFailure.code : "retire_failed"
    return NextResponse.json({ error: "Superseded logos could not be retired.", errorCode }, { status: 500 })
  }

  const failures: string[] = []
  let swept = 0
  try {
    const pending = await listSweepableAssets(admin, graceDays, batchLimit)
    for (const asset of pending) {
      try {
        await removeObjects(admin, [asset.storage_path])
        await stampPurgedAssets(admin, [asset.id])
        swept += 1
      } catch (removeFailure: unknown) {
        // Left unstamped on purpose: the next run picks it up again.
        const code = removeFailure instanceof SweepFailure ? removeFailure.code : "storage_remove_failed"
        failures.push(code)
      }
    }
  } catch (listFailure: unknown) {
    const errorCode = listFailure instanceof SweepFailure ? listFailure.code : "list_failed"
    return NextResponse.json({ error: "Retired logos could not be listed.", errorCode, retired }, { status: 500 })
  }

  return NextResponse.json({ retired, swept, retentionDays, graceDays, failed: failures })
}

// Vercel Cron issues a GET request with `Authorization: Bearer $CRON_SECRET`, so
// the worker must answer GET as well as the POST used for manual/retry runs.
export async function GET(request: Request) {
  return handleSweepRequest(request)
}

export async function POST(request: Request) {
  return handleSweepRequest(request)
}
