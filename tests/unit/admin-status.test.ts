import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * `useAdminStatus` is called from the invoice page and the workspace header at
 * the same time. Each call used to fire its own request, so the same page made
 * two identical `/api/profile` round-trips and the Admin link appeared only after
 * the slower one resolved.
 *
 * The fix is a module-level promise shared by all callers. This test reads the
 * source and fails if the fetch is moved back inside the hook, which is the edit
 * that would reintroduce the duplicate request.
 */
const SOURCE = readFileSync(join(process.cwd(), "components/admin-nav.tsx"), "utf8")

describe("admin status is fetched once per page", () => {
  it("keeps the request at module scope, not inside the hook", () => {
    // The hook body must not contain a `fetch(` call directly.
    const hookBody = SOURCE.slice(SOURCE.indexOf("export function useAdminStatus"))
    expect(hookBody).not.toContain("fetch(")
    // The fetch lives in the module-level helper instead.
    expect(SOURCE).toMatch(/let adminStatusRequest: Promise<boolean> \| null = null/)
    expect(SOURCE).toMatch(/function fetchAdminStatus\(\): Promise<boolean>/)
  })

  it("distinguishes unknown from not-an-admin", () => {
    // `null` = still loading, so a caller can reserve space rather than shifting.
    expect(SOURCE).toMatch(/useAdminStatus\(\): boolean \| null/)
    expect(SOURCE).toContain("useState<boolean | null>(null)")
  })
})
