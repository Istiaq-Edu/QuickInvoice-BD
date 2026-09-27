// Verifies the real migration chain against a real Postgres.
//
// There is no dedicated test Supabase project to lean on, so the migrations are
// applied to PGlite (Postgres compiled to WASM) with the two Supabase-provided
// schemas stubbed. That checks what a mock cannot: that every migration parses
// and applies in order, and that the logo retention rules select the right rows.
//
// Runs the same assertions as the live smoke test, so a migration that breaks
// them is caught here rather than in production.
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url))
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8")

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` (${detail})` : ""}`)
}

async function main() {
  // pgcrypto ships with PGlite but has to be requested explicitly; the chain
  // creates it in 0001.
  const db = await PGlite.create({ extensions: { pgcrypto } })

  // 1. The Supabase-provided schemas the migrations reference.
  await db.exec(read("./bootstrap.sql"))
  console.log("bootstrap applied")

  // 2. The real migration chain, in order.
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8")
    try {
      await db.exec(sql)
    } catch (error) {
      console.error(`\n${file} failed to apply:\n  ${error.message}`)
      await db.close()
      process.exit(1)
    }
  }
  console.log(`applied ${files.length} migrations (${files[0]} .. ${files[files.length - 1]})`)
  check("every migration applies in order", true, `${files.length} files`)

  // 3. Schema the retention feature depends on.
  const columns = await db.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'logo_assets' and column_name = 'storage_purged_at'
  `)
  check("logo_assets.storage_purged_at exists", columns.rows.length === 1)
  const indexes = await db.query(`
    select indexname from pg_indexes
    where schemaname = 'public' and indexname in (
      'logo_assets_workspace_content_idx',
      'logo_assets_pending_sweep_idx',
      'logo_assets_live_created_idx',
      'invoices_logo_document_idx'
    )
  `)
  check("retention indexes exist", indexes.rows.length === 4, `${indexes.rows.length}/4`)

  // 4. Privileges: the operator function must be closed to browser roles.
  for (const role of ["anon", "authenticated"]) {
    const privilege = await db.query(`select has_function_privilege($1, 'public.mark_unused_logo_assets(integer, integer)', 'execute') as allowed`, [role])
    check(`${role} cannot execute mark_unused_logo_assets`, privilege.rows[0].allowed === false)
  }
  const service = await db.query(`select has_function_privilege('service_role', 'public.mark_unused_logo_assets(integer, integer)', 'execute') as allowed`)
  check("service_role can execute mark_unused_logo_assets", service.rows[0].allowed === true)

  // 4b. The settlement helpers are SECURITY DEFINER, so an EXECUTE grant would
  // let a browser bypass the RPCs' workspace checks and rewrite amount_paid on
  // another workspace's invoice. They must be unreachable from every role.
  for (const role of ["anon", "authenticated", "public"]) {
    for (const fn of ["public.sync_invoice_payment_totals(uuid)", "public.sync_invoice_payments_on_change()"]) {
      const privilege = await db.query(`select has_function_privilege($1, $2, 'execute') as allowed`, [role, fn])
      check(`${role} cannot execute ${fn.split("(")[0].split(".").pop()}`, privilege.rows[0].allowed === false)
    }
  }

  // 5. The retention rules, against seeded data. Rolled back at the end.
  await db.exec(read("./logo-retention.sql"))
  check("logo retention rules", true, "see assertions above")

  // 6. A buyer company is optional end to end. The RPCs are the authority here, so
  // the draft, the update and the finalization are all driven through them with a
  // blank buyerCompanyName to prove the guard no longer rejects it. Rolled back.
  await db.exec(read("./optional-buyer-company.sql"))
  check("buyer company is optional across every write path", true, "see assertions above")

  // 7. Partial payment settlement, through the real ledger RPCs. Rolled back.
  await db.exec(read("./settlement.sql"))
  check("partial payment settlement", true, "see assertions above")

  // 8. Re-raising a balance, and the paid-stamp date. Rolled back.
  await db.exec(read("./reissue-balance.sql"))
  check("re-raise balance and paid stamp", true, "see assertions above")

  await db.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
