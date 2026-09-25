import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID()
  return NextResponse.json(
    {
      status: "ok",
      service: "quickinvoice-bd",
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  )
}
