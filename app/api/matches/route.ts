import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")
  const blockId = req.nextUrl.searchParams.get("blockId")

  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 })
  }

  if (blockId) {
    const rows = await sql`
      SELECT * FROM matches
      WHERE event_id = ${eventId} AND block_id = ${blockId}
      ORDER BY slot ASC
    `
    return NextResponse.json(rows)
  }

  const rows = await sql`
    SELECT * FROM matches
    WHERE event_id = ${eventId}
    ORDER BY block_id, slot ASC
  `
  return NextResponse.json(rows)
}
