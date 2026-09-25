import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const databaseUrl = process.env.SUPABASE_DB_URL?.trim()
const explicitlyEnabled = process.env.SUPABASE_SQL_SMOKE === "1"

if (!explicitlyEnabled || !databaseUrl) {
  console.log("Supabase SQL smoke test skipped. Set SUPABASE_SQL_SMOKE=1 and SUPABASE_DB_URL explicitly to run it.")
  process.exit(0)
}

const sqlPath = fileURLToPath(new URL("./rls-smoke.sql", import.meta.url))
const result = spawnSync("psql", [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", path.resolve(sqlPath)], {
  stdio: "inherit",
  windowsHide: true,
})

if (result.error) {
  console.error(`Supabase SQL smoke test could not start psql: ${result.error.message}`)
  console.error("Install PostgreSQL client tools and ensure psql is on PATH.")
  process.exit(1)
}

process.exit(result.status ?? 1)
