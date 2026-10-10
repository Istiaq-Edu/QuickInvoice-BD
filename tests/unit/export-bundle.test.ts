import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The invoice page used to load html2canvas, docx and jsPDF eagerly, because
 * `lib/invoice/export.ts` imported all three at module scope and the page
 * imported that module for its geometry helpers. Measured, that put ~856 KB in a
 * single first-load chunk — see docs/operations/audit-2026-10-11.md.
 *
 * These tests read the real source and fail if a static import of any of the
 * three is reintroduced, which is the one edit that would silently undo the fix.
 * A dynamic `import("...")` inside a function is allowed and expected.
 */
const EXPORT_MODULE = readFileSync(join(process.cwd(), "lib/invoice/export.ts"), "utf8")

const HEAVY_LIBRARIES = ["html2canvas", "jspdf", "docx"]

// Matches `import x from "lib"` and `import { a } from "lib"` — the module-scope
// form — but not `await import("lib")`.
const staticImportPattern = (library: string) =>
  new RegExp(`^\\s*import\\s+[\\s\\S]*?from\\s+["']${library}["']`, "m")

describe("export libraries stay out of the first-load bundle", () => {
  for (const library of HEAVY_LIBRARIES) {
    it(`does not statically import ${library}`, () => {
      expect(staticImportPattern(library).test(EXPORT_MODULE)).toBe(false)
    })

    it(`loads ${library} lazily with a dynamic import`, () => {
      expect(EXPORT_MODULE).toContain(`import("${library}")`)
    })
  }

  it("keeps the geometry helpers in the main bundle", () => {
    // The preview needs these on every render, so they must stay synchronous.
    expect(EXPORT_MODULE).toMatch(/export function pageGeometry\b/)
    expect(EXPORT_MODULE).toMatch(/export const SHEET_WIDTH_PX\b/)
  })
})
