/**
 * Retention policy for superseded seller logos.
 *
 * Uploads are append-only by design, because finalized invoices snapshot the
 * asset they were issued with. That means every replacement leaves the old file
 * behind, so the cost of keeping them has to be bounded. The two windows below
 * are the whole policy, and both are plain integer days with a floor and a
 * ceiling: a misconfigured value must not retire live logos or disable the
 * sweep entirely.
 */

/** How long a superseded logo stays selectable before it is marked. */
const DEFAULT_RETENTION_DAYS = 30
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 3650

/**
 * How long a marked logo is left alone before its object is removed. The row is
 * already invisible by then, so this only widens the margin for a mistake in the
 * selection rules.
 */
const DEFAULT_GRACE_DAYS = 7
const MAX_GRACE_DAYS = 365

/** Bounds one run, so a first run on a large bucket cannot time out. */
const DEFAULT_BATCH_LIMIT = 500
const MAX_BATCH_LIMIT = 5000

/** Any env-shaped record, so callers can pass `process.env` or a test double. */
type EnvLike = Record<string, string | undefined>

function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export function logoRetentionDays(env: EnvLike = process.env) {
  return boundedInt(env.LOGO_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)
}

export function logoGraceDays(env: EnvLike = process.env) {
  return boundedInt(env.LOGO_SWEEP_GRACE_DAYS, DEFAULT_GRACE_DAYS, 0, MAX_GRACE_DAYS)
}

export function logoSweepLimit(env: EnvLike = process.env) {
  return boundedInt(env.LOGO_SWEEP_LIMIT, DEFAULT_BATCH_LIMIT, 1, MAX_BATCH_LIMIT)
}
