import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = getSafeRedirectPath(requestUrl.searchParams.get("next"), requestUrl.origin)
  const supabase = await createSupabaseServerClient()

  if (!code || !supabase) {
    return NextResponse.redirect(new URL("/auth/login?error=confirmation_failed", requestUrl.origin))
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL("/auth/login?error=confirmation_failed", requestUrl.origin))
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin))
}

function getSafeRedirectPath(value: string | null, origin: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/"

  try {
    const url = new URL(value, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : "/"
  } catch {
    return "/"
  }
}
