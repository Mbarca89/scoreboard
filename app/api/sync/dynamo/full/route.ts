import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

interface MatchRow {
  event_id: string
  match_id: string
  block_id: string
  category: string
  created_at: string
  display_label: string | null
  is_finished: boolean
  left_score: number
  left_team_id: string
  left_team_logo_path: string | null
  left_team_name: string
  notes: string | null
  result_type: string | null
  right_score: number
  right_team_id: string
  right_team_logo_path: string | null
  right_team_name: string
  slot: string
  stage: string
  time_remaining_sec: number
  updated_at: string
  winner_team_id: string | null
}

interface BlockRow {
  event_id: string
  block_id: string
  active_slot: string
  block_order: number
  category: string
  created_at: string
  stage: string
  status: string
  updated_at: string
}

export async function POST(req: NextRequest) {
  const { eventId, blockId } = await req.json()

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

  const matches = normalizedBlockId
    ? await sql<MatchRow[]>`
      SELECT event_id, match_id, block_id, category, created_at, display_label, is_finished,
        left_score, left_team_id, left_team_logo_path, left_team_name, notes, result_type,
        right_score, right_team_id, right_team_logo_path, right_team_name,
        slot, stage, time_remaining_sec, updated_at, winner_team_id
      FROM matches
      WHERE event_id = ${eventId} AND block_id = ${normalizedBlockId}
      ORDER BY slot ASC
    `
    : await sql<MatchRow[]>`
      SELECT event_id, match_id, block_id, category, created_at, display_label, is_finished,
        left_score, left_team_id, left_team_logo_path, left_team_name, notes, result_type,
        right_score, right_team_id, right_team_logo_path, right_team_name,
        slot, stage, time_remaining_sec, updated_at, winner_team_id
      FROM matches
      WHERE event_id = ${eventId}
      ORDER BY block_id, slot ASC
    `

  const blocks = normalizedBlockId
    ? await sql<BlockRow[]>`
      SELECT event_id, block_id, active_slot, block_order, category, created_at, stage, status, updated_at
      FROM fixture_blocks
      WHERE event_id = ${eventId} AND block_id = ${normalizedBlockId}
      ORDER BY block_order ASC
    `
    : await sql<BlockRow[]>`
      SELECT event_id, block_id, active_slot, block_order, category, created_at, stage, status, updated_at
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
