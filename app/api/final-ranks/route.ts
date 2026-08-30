import { NextRequest, NextResponse } from "next/server"

const lambdaUrl = process.env.FINAL_RANKS_LAMBDA_URL
const syncToken = process.env.DYNAMO_SYNC_TOKEN

function configurationError() {
  if (!lambdaUrl) return "FINAL_RANKS_LAMBDA_URL is not configured"
  if (!syncToken) return "DYNAMO_SYNC_TOKEN is not configured"
  return null
}

async function forward(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { message: text || "Respuesta inválida de la Lambda" }
  }
  return NextResponse.json(body, { status: response.status })
}

export async function GET(request: NextRequest) {
  const error = configurationError()
  if (error) return NextResponse.json({ message: error }, { status: 500 })

  const eventId = request.nextUrl.searchParams.get("eventId")?.trim()
  if (!eventId) return NextResponse.json({ message: "Falta eventId" }, { status: 400 })

  const url = new URL(lambdaUrl!)
  url.searchParams.set("eventId", eventId)
  return forward(url.toString(), {
    headers: { "x-sync-token": syncToken! },
  })
}

export async function POST(request: NextRequest) {
  const error = configurationError()
  if (error) return NextResponse.json({ message: error }, { status: 500 })

  return forward(lambdaUrl!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sync-token": syncToken!,
    },
    body: JSON.stringify(await request.json()),
  })
}
