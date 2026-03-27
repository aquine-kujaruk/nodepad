import { NextRequest, NextResponse } from "next/server"

// ── Sliding-window rate limiter ───────────────────────────────────────────────
// In-memory store: ip → array of request timestamps within the current window.
// Note: on Vercel each serverless invocation may get a fresh instance, so this
// provides best-effort protection (stops bursts within a single instance) while
// remaining zero-dependency. For stricter enforcement, swap the map for Vercel KV.

const store = new Map<string, number[]>()

const LIMITS: Record<string, { window: number; max: number }> = {
  "/api/enrich": { window: 60_000, max: 60 }, // 60 req / min — generous for real use
  "/api/ghost":  { window: 60_000, max: 10 }, // 10 req / min — expensive call, low cadence
}

function isRateLimited(ip: string, path: string): boolean {
  const rule = LIMITS[path]
  if (!rule) return false

  const key   = `${ip}:${path}`
  const now   = Date.now()
  const hits  = (store.get(key) ?? []).filter(t => now - t < rule.window)

  if (hits.length >= rule.max) return true

  hits.push(now)
  store.set(key, hits)
  return false
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only guard the two AI proxy routes
  if (!pathname.startsWith("/api/enrich") && !pathname.startsWith("/api/ghost")) {
    return NextResponse.next()
  }

  // Origin check — block requests that don't originate from this app.
  // Localhost and same-origin are always allowed (covers dev + production).
  const origin  = req.headers.get("origin")  ?? ""
  const referer = req.headers.get("referer") ?? ""
  const host    = req.headers.get("host")    ?? ""

  const isLocalhost   = origin.includes("localhost") || referer.includes("localhost")
  const isSameOrigin  = origin.includes(host) || referer.includes(host)

  if (origin && !isLocalhost && !isSameOrigin) {
    return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  // IP extraction (Vercel sets x-forwarded-for; fall back to a sentinel)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
           ?? req.headers.get("x-real-ip")
           ?? "unknown"

  if (isRateLimited(ip, pathname)) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    })
  }

  // Forward the request but strip the API key from any response headers
  // so it doesn't appear in Vercel's edge logs or leak via CORS preflight responses.
  // The key is still forwarded to the route handler via the request — the route
  // reads it from req.headers directly before the response is formed.
  const res = NextResponse.next()
  res.headers.delete("x-or-key")
  return res
}

export const config = {
  matcher: ["/api/enrich", "/api/ghost"],
}
