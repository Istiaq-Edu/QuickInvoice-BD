import { NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const customerSchema = z.object({
  companyName: z.string().trim().max(500),
  name: z.string().trim().min(1, "Customer name is required").max(500),
  address: z.string().trim().max(2_000),
  email: z.string().trim().email().or(z.literal("")),
  phone: z.string().trim().max(100),
  website: z.string().trim().url().or(z.literal("")),
})
const idSchema = z.string().uuid()

async function getWorkspaceId(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>, userId: string) {
  const { data } = await supabase.from("profiles").select("workspace_id").eq("user_id", userId).single()
  return data?.workspace_id ?? null
}

async function getContext() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) }
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return { error: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) }
  const workspaceId = await getWorkspaceId(supabase, authData.user.id)
  if (!workspaceId) return { error: NextResponse.json({ error: "Your workspace could not be found." }, { status: 403 }) }
  return { supabase, workspaceId }
}

const mapCustomer = (customer: { id: string; company_name: string; name: string; address_text: string; email: string; phone: string; website: string; updated_at: string }) => ({
  id: customer.id,
  companyName: customer.company_name,
  name: customer.name,
  address: customer.address_text,
  email: customer.email,
  phone: customer.phone,
  website: customer.website,
  updatedAt: customer.updated_at,
})

export async function GET(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? ""
  const { data, error } = await context.supabase.from("customers").select("id, company_name, name, address_text, email, phone, website, updated_at").is("deleted_at", null).order("updated_at", { ascending: false })
  if (error) return NextResponse.json({ error: "Customers could not be loaded." }, { status: 500 })
  const customers = (data ?? []).filter((customer) => !query || [customer.company_name, customer.name, customer.email, customer.phone].some((value) => value.toLowerCase().includes(query)))
  return NextResponse.json({ customers: customers.map(mapCustomer) })
}

export async function POST(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const parsed = customerSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Customer data is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("customers").insert({
    workspace_id: context.workspaceId,
    company_name: parsed.data.companyName,
    name: parsed.data.name,
    address_text: parsed.data.address,
    email: parsed.data.email,
    phone: parsed.data.phone,
    website: parsed.data.website,
  }).select("id, company_name, name, address_text, email, phone, website, updated_at").single()
  if (error || !data) return NextResponse.json({ error: "Customer could not be created." }, { status: 500 })
  return NextResponse.json({ customer: mapCustomer(data) }, { status: 201 })
}

export async function PATCH(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const body = await request.json().catch(() => null)
  const id = idSchema.safeParse(body?.id)
  const parsed = customerSchema.safeParse(body)
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Customer data is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("customers").update({
    company_name: parsed.data.companyName,
    name: parsed.data.name,
    address_text: parsed.data.address,
    email: parsed.data.email,
    phone: parsed.data.phone,
    website: parsed.data.website,
    updated_at: new Date().toISOString(),
  }).eq("id", id.data).eq("workspace_id", context.workspaceId).is("deleted_at", null).select("id, company_name, name, address_text, email, phone, website, updated_at").single()
  if (error || !data) return NextResponse.json({ error: "Customer could not be updated." }, { status: 404 })
  return NextResponse.json({ customer: mapCustomer(data) })
}

export async function DELETE(request: Request) {
  const context = await getContext()
  if (context.error) return context.error
  const id = idSchema.safeParse(new URL(request.url).searchParams.get("id"))
  if (!id.success) return NextResponse.json({ error: "Customer ID is invalid." }, { status: 400 })
  const { data, error } = await context.supabase.from("customers").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id.data).eq("workspace_id", context.workspaceId).is("deleted_at", null).select("id").maybeSingle()
  if (error || !data) return NextResponse.json({ error: "Customer could not be deleted." }, { status: 404 })
  return NextResponse.json({ success: true })
}
