import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import type { Match, FixtureBlock } from "@/lib/types"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { eventId, blockId, matches: providedMatches, fixtureBlocks: providedFixtureBlocks } = body

  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 })
  }

  const normalizedBlockId = typeof blockId === "string" && blockId.trim().length > 0 ? blockId.trim() : null

  const syncToken = process.env.DYNAMO_SYNC_TOKEN
  const lambdaUrl = process.env.DYNAMO_SYNC_LAMBDA_URL

  if (!syncToken) {
    return NextResponse.json({ error: "DYNAMO_SYNC_TOKEN is not configured" }, { status: 500 })
  }
  if (!lambdaUrl) {
    return NextResponse.json({ error: "DYNAMO_SYNC_LAMBDA_URL is not configured" }, { status: 500 })
  }

  const hasProvidedMatches = Array.isArray(providedMatches)
  const hasProvidedBlocks = Array.isArray(providedFixtureBlocks)

  const matches = hasProvidedMatches
    ? (providedMatches as Match[])
      .filter((m) => m.event_id === eventId && (!normalizedBlockId || m.block_id === normalizedBlockId))
      .sort((a, b) => (normalizedBlockId ? a.slot.localeCompare(b.slot) : `${a.block_id}:${a.slot}`.localeCompare(`${b.block_id}:${b.slot}`)))
    : normalizedBlockId
      ? await sql<Match[]>`
        SELECT *
        FROM matches
        WHERE event_id = ${eventId} AND block_id = ${normalizedBlockId}
        ORDER BY slot ASC
      `
      : await sql<Match[]>`
        SELECT *
        FROM matches
        WHERE event_id = ${eventId}
        ORDER BY block_id, slot ASC
      `

  const blocks = hasProvidedBlocks
    ? (providedFixtureBlocks as FixtureBlock[])
      .filter((b) => b.event_id === eventId && (!normalizedBlockId || b.block_id === normalizedBlockId))
      .sort((a, b) => a.block_order - b.block_order)
    : normalizedBlockId
      ? await sql<FixtureBlock[]>`
        SELECT *
        FROM fixture_blocks
        WHERE event_id = ${eventId} AND block_id = ${normalizedBlockId}
        ORDER BY block_order ASC
      `
      : await sql<FixtureBlock[]>`
        SELECT *
        FROM fixture_blocks
        WHERE event_id = ${eventId}
        ORDER BY block_order ASC
      `

  if (normalizedBlockId && blocks.length === 0) {
    return NextResponse.json({ error: `blockId '${normalizedBlockId}' not found for event '${eventId}'` }, { status: 404 })
  }

  const matchAByBlock = new Map<string, string>()
  const matchBByBlock = new Map<string, string>()
  for (const m of matches) {
    if (m.slot === "A") matchAByBlock.set(m.block_id, m.match_id)
    if (m.slot === "B") matchBByBlock.set(m.block_id, m.match_id)
  }

  const payload = {
    region: "sa-east-1",
    tables: {
      matches: "Matches",
      fixtureBlocks: "FixtureBlocks",
    },
    event_id: eventId,
    block_id: normalizedBlockId,
    matches: matches.map((m) => ({
      ...m,
      sk: `MATCH#${m.match_id}`,
      block_sk: `BLOCK#${m.block_id}`,
    })),
    fixtureBlocks: blocks.map((b) => ({
      ...b,
      sk: `BLOCK#${b.block_id}`,
      match_a_id: matchAByBlock.get(b.block_id) ?? null,
      match_b_id: matchBByBlock.get(b.block_id) ?? null,
    })),
  }

  const syncRes = await fetch(lambdaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-token": syncToken,
    },
    body: JSON.stringify(payload),
  })

  const text = await syncRes.text()
  if (!syncRes.ok) {
    return NextResponse.json({ error: "lambda sync failed", details: text }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    scope: normalizedBlockId ? "block" : "event",
    blockId: normalizedBlockId,
    matches: matches.length,
    fixtureBlocks: blocks.length,
    lambdaResponse: text,
  })
}
