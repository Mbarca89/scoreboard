import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import type { AXLCategory } from "@/lib/types"

type Stage = "SEMI" | "FINAL"

interface MatchInput {
  leftTeamId: string
  leftTeamName: string
  leftTeamLogoKey?: string | null
  rightTeamId?: string
  rightTeamName?: string
  rightTeamLogoKey?: string | null
  isBye?: boolean
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { eventId, category, stage, matches } = body as {
    eventId: string
    category: AXLCategory
    stage: Stage
    matches: MatchInput[]
  }

  if (!eventId || !category || !stage || !Array.isArray(matches) || matches.length !== 2) {
    return NextResponse.json({ error: "eventId, category, stage and exactly 2 matches are required" }, { status: 400 })
  }

  const blockId = `block_${crypto.randomUUID()}`
  const matchAId = `match_${crypto.randomUUID()}`
  const matchBId = `match_${crypto.randomUUID()}`

  const maxOrderRows = await sql<{ max_order: number | null }[]>`
    SELECT MAX(block_order) AS max_order FROM fixture_blocks WHERE event_id = ${eventId}
  `
  const nextOrder = (maxOrderRows[0]?.max_order ?? 0) + 1

  for (let i = 0; i < 2; i++) {
    const item = matches[i]
    const isBye = item.isBye === true
    if (!item.leftTeamId || !item.leftTeamName) {
      return NextResponse.json({ error: `Match ${i + 1}: left team is required` }, { status: 400 })
    }
    if (!isBye && (!item.rightTeamId || !item.rightTeamName)) {
      return NextResponse.json({ error: `Match ${i + 1}: right team is required when it is not BYE` }, { status: 400 })
    }
  }

  await sql`
    INSERT INTO fixture_blocks (
      event_id, block_id, block_order, category, stage, group_id, round_number, status, active_slot
    ) VALUES (
      ${eventId}, ${blockId}, ${nextOrder}, ${category}, ${stage}, null, null, 'SCHEDULED', 'A'
    )
  `

  const slots: Array<"A" | "B"> = ["A", "B"]
  const ids = [matchAId, matchBId]

  for (let i = 0; i < 2; i++) {
    const item = matches[i]
    const isBye = item.isBye === true
    const rightTeamId = isBye ? "BYE" : (item.rightTeamId ?? "")
    const rightTeamName = isBye ? "BYE" : (item.rightTeamName ?? "")

    await sql`
      INSERT INTO matches (
        event_id, match_id, block_id, slot, category, stage,
        left_team_id, left_team_name, left_team_logo_path,
        right_team_id, right_team_name, right_team_logo_path,
        left_score, right_score, time_remaining_sec,
        is_finished, result_type, winner_team_id, display_label
      ) VALUES (
        ${eventId}, ${ids[i]}, ${blockId}, ${slots[i]}, ${category}, ${stage},
        ${item.leftTeamId}, ${item.leftTeamName}, ${item.leftTeamLogoKey ?? null},
        ${rightTeamId}, ${rightTeamName}, ${isBye ? null : item.rightTeamLogoKey ?? null},
        ${isBye ? 1 : 0}, 0, 0,
        ${isBye}, ${isBye ? "LEFT_WIN" : null}, ${isBye ? item.leftTeamId : null},
        ${stage === "SEMI" ? `Semifinal ${slots[i]}` : `Final ${slots[i]}`}
      )
    `
  }


  return NextResponse.json({ ok: true, blockId, matchAId, matchBId, blockOrder: nextOrder })
}
