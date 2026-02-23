import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 })
  }

  const rows = await sql`
    SELECT * FROM fixture_blocks
    WHERE event_id = ${eventId}
    ORDER BY block_order ASC
  `
  return NextResponse.json(rows)
}
