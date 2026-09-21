import type { SupabaseClient } from "@supabase/supabase-js"

type BuyerDetails = {
  buyerCompanyName: string
  buyerName: string
  buyerEmail?: string
  buyerPhone?: string
  buyerAddress?: string
}

export async function syncCustomer(supabase: SupabaseClient, workspaceId: string, invoice: BuyerDetails) {
  const name = invoice.buyerName.trim()
  if (!name) return

  const customer = {
    company_name: invoice.buyerCompanyName.trim(),
    name,
    address_text: invoice.buyerAddress?.trim() ?? "",
    email: invoice.buyerEmail?.trim() ?? "",
    phone: invoice.buyerPhone?.trim() ?? "",
    website: "",
  }

  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("company_name", customer.company_name)
    .eq("name", customer.name)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    await supabase.from("customers").update({ ...customer, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("workspace_id", workspaceId)
    return
  }

  await supabase.from("customers").insert({ workspace_id: workspaceId, ...customer })
}
