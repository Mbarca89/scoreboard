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

  return NextResponse.json({ ok: true })
}
