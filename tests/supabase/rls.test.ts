import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

const supabaseUrl = process.env.SUPABASE_TEST_URL?.trim() ?? ""
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY?.trim() ?? ""
const testEmail = process.env.SUPABASE_TEST_EMAIL?.trim() ?? ""
const testPassword = process.env.SUPABASE_TEST_PASSWORD ?? ""
const hasAnonymousConfig = Boolean(supabaseUrl && publishableKey)
const hasAuthenticatedConfig = Boolean(hasAnonymousConfig && testEmail && testPassword)

const protectedTables = ["workspaces", "profiles", "seller_profiles", "customers", "templates", "invoices", "invoice_lines"] as const

function testClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

describe("Supabase RLS smoke test", () => {
  it.skipIf(!hasAnonymousConfig)("does not expose protected rows or helper RPCs to anonymous clients (requires SUPABASE_TEST_URL and SUPABASE_TEST_PUBLISHABLE_KEY)", async () => {
    const supabase = testClient()

    for (const table of protectedTables) {
      const { data, error } = await supabase.from(table).select("*").limit(1)
      if (error) {
        // The hardened migration revokes anonymous EXECUTE on the helper used
        // by these policies. A permission denial is therefore an expected
        // secure result, equivalent to seeing no rows.
        expect(error.code, `Unexpected anonymous error for public.${table}`).toBe("42501")
        continue
      }
      expect(data, `Anonymous client unexpectedly read public.${table}`).toEqual([])
    }

    const { error } = await supabase.rpc("current_workspace_id")
    expect(error, "Anonymous client can execute current_workspace_id RPC").not.toBeNull()
  })

  it.skipIf(!hasAuthenticatedConfig)("limits an explicit test account to its own workspace (requires all SUPABASE_TEST_* credentials)", async () => {
    const supabase = testClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: testEmail, password: testPassword })
    if (signInError) {
      throw new Error(`Supabase RLS test account could not sign in. Use a dedicated approved test account: ${signInError.message}`)
    }

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw new Error("Supabase RLS test account returned no authenticated user.")

      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("workspace_id")
        .eq("user_id", userData.user.id)
      if (profileError) throw new Error(`Could not read the authenticated test profile: ${profileError.message}`)
      expect(profiles).toHaveLength(1)

      const workspaceId = profiles[0]?.workspace_id
      expect(workspaceId).toBeTruthy()

      const { data: workspaces, error: workspaceError } = await supabase
        .from("workspaces")
        .select("id, owner_user_id")
      if (workspaceError) throw new Error(`Could not read the authenticated test workspace: ${workspaceError.message}`)
      expect(workspaces).toEqual([{ id: workspaceId, owner_user_id: userData.user.id }])

      for (const table of ["seller_profiles", "customers", "templates", "invoices"] as const) {
        const { data, error } = await supabase.from(table).select("workspace_id")
        if (error) throw new Error(`Could not query authenticated public.${table}: ${error.message}`)
        expect(data?.every((row) => row.workspace_id === workspaceId), `Authenticated client crossed workspace boundary in public.${table}`).toBe(true)
      }

      let draftInvoiceId: string | null = null
      try {
        const { data: draftData, error: draftError } = await supabase.rpc("save_invoice_draft", {
          p_canonical: {
            schemaVersion: 1,
            sellerCompanyName: "RLS Probe Seller",
            sellerName: "RLS Probe",
            buyerCompanyName: "RLS Probe Buyer",
            buyerName: "Buyer",
            lines: [{ description: "Supported draft line", quantity: 1, unitPrice: 1 }],
          },
          p_customer_snapshot: {},
          p_discount_input_value: 0,
          p_discount_type: "none",
          p_due_date: "2026-01-01",
          p_expected_version: null,
          p_invoice_id: null,
          p_issue_date: "2026-01-01",
          p_lines: [{ description: "Supported draft line", quantity: 1, unitPrice: 1 }],
          p_payment_status: "unpaid",
          p_seller_snapshot: {},
        })
        if (draftError) throw new Error(`Supported draft RPC failed: ${draftError.message}`)
        const draftResult = (Array.isArray(draftData) ? draftData[0] : draftData) as { result_invoice_id?: string } | null
        draftInvoiceId = draftResult?.result_invoice_id ?? null
        expect(draftInvoiceId).toBeTruthy()

        const { error: invoiceWriteError } = await supabase.from("invoices").insert({
          workspace_id: workspaceId,
          issue_date: "2026-01-01",
          due_date: "2026-01-01",
          canonical_document: {},
          seller_snapshot: {},
          customer_snapshot: {},
          template_snapshot: {},
        })
        expect(invoiceWriteError?.code, "Authenticated clients can insert invoices directly").toBe("42501")

        const { error: invoiceUpdateError } = await supabase
          .from("invoices")
          .update({ canonical_document: { directWriteProbe: true } })
          .eq("id", draftInvoiceId)
        expect(invoiceUpdateError?.code, "Authenticated clients can update invoices directly").toBe("42501")

        const { error: invoiceDeleteError } = await supabase
          .from("invoices")
          .delete()
          .eq("id", draftInvoiceId)
        expect(invoiceDeleteError?.code, "Authenticated clients can delete invoices directly").toBe("42501")

        const { error: lineInsertError } = await supabase.from("invoice_lines").insert({
          invoice_id: draftInvoiceId,
          position: 1,
          description: "Direct write probe",
          quantity: 1,
          unit_price: 1,
          line_total: 1,
        })
        expect(lineInsertError?.code, "Authenticated clients can insert invoice lines directly").toBe("42501")

        const { error: lineUpdateError } = await supabase
          .from("invoice_lines")
          .update({ description: "Direct update probe" })
          .eq("invoice_id", draftInvoiceId)
        expect(lineUpdateError?.code, "Authenticated clients can update invoice lines directly").toBe("42501")

        const { error: lineDeleteError } = await supabase
          .from("invoice_lines")
          .delete()
          .eq("invoice_id", draftInvoiceId)
        expect(lineDeleteError?.code, "Authenticated clients can delete invoice lines directly").toBe("42501")
      } finally {
        if (draftInvoiceId) {
          await supabase.rpc("trash_invoice", { p_invoice_id: draftInvoiceId })
          await supabase.rpc("permanently_delete_invoice", { p_invoice_id: draftInvoiceId })
        }
      }
    } finally {
      await supabase.auth.signOut()
    }
  })
})
