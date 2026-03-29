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
  const { eventId } = await req.json()

  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 })
  }

  const syncToken = process.env.DYNAMO_SYNC_TOKEN
  const lambdaUrl = process.env.DYNAMO_SYNC_LAMBDA_URL

  if (!syncToken) {
    return NextResponse.json({ error: "DYNAMO_SYNC_TOKEN is not configured" }, { status: 500 })
  }
  if (!lambdaUrl) {
    return NextResponse.json({ error: "DYNAMO_SYNC_LAMBDA_URL is not configured" }, { status: 500 })
  }

  const matches = await sql<MatchRow[]>`
    SELECT event_id, match_id, block_id, category, created_at, display_label, is_finished,
      left_score, left_team_id, left_team_logo_path, left_team_name, notes, result_type,
      right_score, right_team_id, right_team_logo_path, right_team_name,
      slot, stage, time_remaining_sec, updated_at, winner_team_id
    FROM matches
    WHERE event_id = ${eventId}
    ORDER BY block_id, slot ASC
  `

  const blocks = await sql<BlockRow[]>`
    SELECT event_id, block_id, active_slot, block_order, category, created_at, stage, status, updated_at
    FROM fixture_blocks
    WHERE event_id = ${eventId}
    ORDER BY block_order ASC
  `

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
    eventId,
    matches: matches.map((m) => ({
      eventId: m.event_id,
      sk: `MATCH#${m.match_id}`,
      blockSk: `BLOCK#${m.block_id}`,
      category: m.category,
      createdAt: m.created_at,
      displayLabel: m.display_label,
      isFinished: m.is_finished,
      leftScore: m.left_score,
      leftTeamId: m.left_team_id,
      leftTeamLogoKey: m.left_team_logo_path,
      leftTeamNameSnapshot: m.left_team_name,
      matchId: m.match_id,
      notes: m.notes,
      resultType: m.result_type,
      rightScore: m.right_score,
      rightTeamId: m.right_team_id,
      rightTeamLogoKey: m.right_team_logo_path,
      rightTeamNameSnapshot: m.right_team_name,
      slot: m.slot,
      stage: m.stage,
      timeRemainingSec: m.time_remaining_sec,
      updatedAt: m.updated_at,
      winnerTeamId: m.winner_team_id,
    })),
    fixtureBlocks: blocks.map((b) => ({
      eventId: b.event_id,
      sk: `BLOCK#${b.block_id}`,
      activeSlot: b.active_slot,
      blockOrder: b.block_order,
      category: b.category,
      createdAt: b.created_at,
      matchAId: matchAByBlock.get(b.block_id) ?? null,
      matchBId: matchBByBlock.get(b.block_id) ?? null,
      stage: b.stage,
      status: b.status,
      updatedAt: b.updated_at,
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

  return NextResponse.json({ ok: true, matches: matches.length, fixtureBlocks: blocks.length, lambdaResponse: text })
}
