import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

/**
 * Shared guard for the cron-triggered internal workers.
 *
 * Both workers exist to mutate data no end user is allowed to touch, so the
 * secret check is kept in one place: one timing-safe comparison, one refusal
 * path, one error body shape. Vercel Cron sends the secret as a bearer token
 * while manual runs use the dedicated header, so both are accepted.
 */

function secretsMatch(received: string | null, expected: string) {
  if (!received) return false
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  if (receivedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(receivedBytes, expectedBytes)
}

export function authorizeWorkerRequest(request: Request, missingMessage: string) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: missingMessage }, { status: 503 })
  }

  const authorization = request.headers.get("authorization")
  const bearerSecret = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null
  const headerSecret = request.headers.get("x-cron-secret")
  if (!secretsMatch(bearerSecret, cronSecret) && !secretsMatch(headerSecret, cronSecret)) {
    return NextResponse.json({ error: "Invalid worker credentials." }, { status: 401 })
  }

  return null
}
