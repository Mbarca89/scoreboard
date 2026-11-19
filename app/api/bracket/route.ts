import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import type { AXLCategory } from "@/lib/types"

type Stage = "SEMI" | "FINAL"

interface MatchInput {
  category: AXLCategory
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
  const { eventId, stage, matches } = body as {
    eventId: string
    stage: Stage
    matches: MatchInput[]
  }

  if (!eventId || !stage || !Array.isArray(matches) || matches.length < 1 || matches.length > 2) {
    return NextResponse.json({ error: "eventId, stage and 1 or 2 matches are required" }, { status: 400 })
  }

  const validCategories: AXLCategory[] = ["5v5 D3/D4", "3v3 D4/D5", "3v3 D6", "3v3 Open"]
  const blockCategory = matches.every((item) => item.category === matches[0]?.category)
    ? matches[0].category
    : "Mixto"

  const blockId = `block_${crypto.randomUUID()}`
  const matchAId = `match_${crypto.randomUUID()}`
  const matchBId = matches.length === 2 ? `match_${crypto.randomUUID()}` : null

  const maxOrderRows = await sql<{ max_order: number | null }[]>`
    SELECT MAX(block_order) AS max_order FROM fixture_blocks WHERE event_id = ${eventId}
  `
  const nextOrder = (maxOrderRows[0]?.max_order ?? 0) + 1

  for (let i = 0; i < matches.length; i++) {
    const item = matches[i]
    const isBye = item.isBye === true
    if (!validCategories.includes(item.category)) {
      return NextResponse.json({ error: `Match ${i + 1}: invalid category` }, { status: 400 })
    }
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
      ${eventId}, ${blockId}, ${nextOrder}, ${blockCategory}, ${stage}, null, null, 'SCHEDULED', 'A'
    )
  `

  const slots: Array<"A" | "B"> = ["A", "B"]
  const ids = matchBId ? [matchAId, matchBId] : [matchAId]

  for (let i = 0; i < matches.length; i++) {
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
        ${eventId}, ${ids[i]}, ${blockId}, ${slots[i]}, ${item.category}, ${stage},
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
