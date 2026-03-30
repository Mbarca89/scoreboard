import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params
  const body = await req.json()
  const { eventId, leftScore, rightScore, timeRemainingSec, isFinished, resultType, winnerTeamId } = body

  if (!eventId || !matchId) {
    return NextResponse.json({ error: "eventId and matchId required" }, { status: 400 })
  }

  if (isFinished) {
    await sql`
      UPDATE matches SET
        left_score = ${leftScore},
        right_score = ${rightScore},
        time_remaining_sec = ${timeRemainingSec},
        is_finished = TRUE,
        result_type = ${resultType ?? null},
        winner_team_id = ${winnerTeamId ?? null},
        finished_at = now()
      WHERE event_id = ${eventId} AND match_id = ${matchId}
    `
  } else {
    await sql`
      UPDATE matches SET
        left_score = ${leftScore},
        right_score = ${rightScore},
        time_remaining_sec = ${timeRemainingSec}
      WHERE event_id = ${eventId} AND match_id = ${matchId}
    `
  }

  const matchBlockRows = await sql<{ block_id: string }[]>`
    SELECT block_id
    FROM matches
    WHERE event_id = ${eventId} AND match_id = ${matchId}
    LIMIT 1
  `

  const blockId = matchBlockRows[0]?.block_id
  if (blockId) {
    const blockProgressRows = await sql<{ total_matches: number; finished_matches: number }[]>`
      SELECT
        COUNT(*)::int AS total_matches,
        COUNT(*) FILTER (WHERE is_finished = TRUE)::int AS finished_matches
      FROM matches
      WHERE event_id = ${eventId} AND block_id = ${blockId}
    `

    const progress = blockProgressRows[0]
    if (progress && progress.total_matches > 0) {
      const nextStatus = progress.finished_matches >= progress.total_matches ? "DONE" : "IN_PROGRESS"
      await sql`
        UPDATE fixture_blocks
        SET status = ${nextStatus}
        WHERE event_id = ${eventId} AND block_id = ${blockId}
      `
    }
  }

  return NextResponse.json({ ok: true })
}
