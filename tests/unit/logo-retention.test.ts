import { describe, expect, it } from "vitest"

import { logoGraceDays, logoRetentionDays, logoSweepLimit } from "@/lib/internal/logo-retention"

describe("logo retention policy", () => {
  it("defaults to a month of history and a week of grace", () => {
    expect(logoRetentionDays({})).toBe(30)
    expect(logoGraceDays({})).toBe(7)
    expect(logoSweepLimit({})).toBe(500)
  })

  it("reads configured values", () => {
    expect(logoRetentionDays({ LOGO_RETENTION_DAYS: "90" })).toBe(90)
    expect(logoGraceDays({ LOGO_SWEEP_GRACE_DAYS: "0" })).toBe(0)
    expect(logoSweepLimit({ LOGO_SWEEP_LIMIT: "25" })).toBe(25)
  })

  it("never retires live logos by accident", () => {
    // Zero days would mark a logo that was replaced five minutes ago.
    expect(logoRetentionDays({ LOGO_RETENTION_DAYS: "0" })).toBe(1)
    expect(logoRetentionDays({ LOGO_RETENTION_DAYS: "-5" })).toBe(1)
  })

  it("clamps absurd values instead of trusting them", () => {
    expect(logoRetentionDays({ LOGO_RETENTION_DAYS: "100000" })).toBe(3650)
    expect(logoGraceDays({ LOGO_SWEEP_GRACE_DAYS: "100000" })).toBe(365)
    expect(logoSweepLimit({ LOGO_SWEEP_LIMIT: "100000" })).toBe(5000)
    expect(logoSweepLimit({ LOGO_SWEEP_LIMIT: "0" })).toBe(1)
  })

  it("falls back to defaults for unusable values", () => {
    expect(logoRetentionDays({ LOGO_RETENTION_DAYS: "" })).toBe(30)
    expect(logoRetentionDays({ LOGO_RETENTION_DAYS: "soon" })).toBe(30)
    expect(logoGraceDays({ LOGO_SWEEP_GRACE_DAYS: "   " })).toBe(7)
    expect(logoSweepLimit({ LOGO_SWEEP_LIMIT: "12.5" })).toBe(12)
  })
})
