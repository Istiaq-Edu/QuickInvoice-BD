/**
 * Date and line-item helpers for the invoice editor.
 *
 * These lived at module scope in `app/page.tsx`, mixed in with the component and
 * its JSX. They are pure functions with no React dependency, so they belong in
 * `lib/` where they can be unit-tested and reused. The move is behaviour-preserving:
 * the bodies are unchanged, only the location differs.
 *
 * Dhaka is the seller's timezone for every date the editor produces, so "today"
 * and the issue/due defaults do not drift for a seller working after midnight
 * local time.
 */

export type EditableNumber = number | ""

export type DiscountType = "none" | "fixed" | "percentage"

export type LineItem = {
  id: number
  description: string
  quantity: EditableNumber
  unitPrice: EditableNumber
  discountType: DiscountType
  discountValue: EditableNumber
}

/** Today in Asia/Dhaka, as `YYYY-MM-DD`. */
export const getDhakaDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Dhaka", year: "numeric" }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

/**
 * Adds whole days to an ISO date.
 *
 * Due defaults to two weeks after the issue date, matching the reissue path in
 * migration 0034 (`v_issue_date + 14`). Defaulting it to today made every new
 * invoice due immediately and produced false overdue states on day one.
 */
export const addDaysIso = (iso: string, days: number) => {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return ""
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** `2026-09-27` → `27 Sep 2026`, or `""` for anything malformed. */
export const formatDateLong = (value: string) => {
  if (!value) return ""
  const parts = value.split("-").map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return ""
  const [year, month, day] = parts
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  if (month < 1 || month > 12 || day < 1 || day > 31) return ""
  return `${String(day).padStart(2, "0")} ${months[month - 1]} ${year}`
}

/** Whole days between two ISO dates, or `null` if either is unparseable. */
export const diffDays = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 86_400_000)
}

/** `2026-09-27` → `27/09/2026`, or an em dash when empty. */
export const formatDate = (value: string) => {
  if (!value) return "—"
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

/**
 * A new line starts empty, not pre-filled.
 *
 * Quantity 1 and unit price 0 made a fresh row read as a priced line at a glance,
 * and the ledger's whole claim is that what you see is what has been entered.
 * Blank also means the placeholder is doing its job: the cell says "0" in muted
 * type until it holds a real 0. The autosave mapper coerces both on the way out
 * (`Number(x) || 1`), so a stored draft still receives the 1 the schema requires.
 */
export const newLine = (id: number): LineItem => ({ id, description: "", quantity: "", unitPrice: "", discountType: "none", discountValue: "" })

/** Gross, discount and net for one line, with the discount clamped to the line. */
export const getLineAmounts = (line: LineItem) => {
  const originalAmount = Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0)
  const numericDiscount = Math.max(0, Number(line.discountValue) || 0)
  const discountAmount = line.discountType === "fixed"
    ? Math.min(originalAmount, numericDiscount)
    : line.discountType === "percentage"
      ? Math.round((originalAmount * Math.min(100, numericDiscount)) / 100)
      : 0
  return { originalAmount, discountAmount, amount: Math.max(0, originalAmount - discountAmount) }
}
