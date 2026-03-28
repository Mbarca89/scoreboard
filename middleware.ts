import { NextRequest, NextResponse } from "next/server"

function resolveAllowedOrigin(req: NextRequest): string {
  const requestOrigin = req.headers.get("origin") ?? ""
  const configured = process.env.CORS_ORIGIN?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (!configured || configured.length === 0) {
    return "*"
  }

  if (configured.includes("*")) {
    return "*"
  }

  if (requestOrigin && configured.includes(requestOrigin)) {
    return requestOrigin
  }

  return configured[0]
}

function withCorsHeaders(req: NextRequest, response: NextResponse): NextResponse {
  const origin = resolveAllowedOrigin(req)

  response.headers.set("Access-Control-Allow-Origin", origin)
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  response.headers.set("Vary", "Origin")

  return response
}

export function middleware(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return withCorsHeaders(req, new NextResponse(null, { status: 204 }))
  }

  return withCorsHeaders(req, NextResponse.next())
}

export const config = {
  matcher: "/api/:path*",
}
