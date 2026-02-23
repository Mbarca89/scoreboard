import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 })
  }

  const rows = await sql`
    SELECT * FROM match_live_state WHERE event_id = ${eventId}
  `

  if (rows.length === 0) {
    return NextResponse.json(null)
  }

  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const {
    event_id,
    active_match_id,
    active_slot,
    break_timer_sec,
    game_timer_sec,
    timer_mode,
    timer_running,
    left_score,
    right_score,
    left_team_name,
    right_team_name,
    left_team_logo_path,
    right_team_logo_path,
    waiting_match_id,
    waiting_left_score,
    waiting_right_score,
    waiting_left_team_name,
    waiting_right_team_name,
    waiting_left_team_logo_path,
    waiting_right_team_logo_path,
    category,
  } = body

  if (!event_id) {
    return NextResponse.json({ error: "event_id required" }, { status: 400 })
  }

  await sql`
    INSERT INTO match_live_state (
      event_id, active_match_id, active_slot,
      break_timer_sec, game_timer_sec, timer_mode, timer_running,
      left_score, right_score, left_team_name, right_team_name,
      left_team_logo_path, right_team_logo_path,
      waiting_match_id, waiting_left_score, waiting_right_score,
      waiting_left_team_name, waiting_right_team_name,
      waiting_left_team_logo_path, waiting_right_team_logo_path,
      category, updated_at
    ) VALUES (
      ${event_id}, ${active_match_id ?? null}, ${active_slot ?? "A"},
      ${break_timer_sec ?? 60}, ${game_timer_sec ?? 0}, ${timer_mode ?? "IDLE"}, ${timer_running ?? false},
      ${left_score ?? 0}, ${right_score ?? 0}, ${left_team_name ?? ""}, ${right_team_name ?? ""},
      ${left_team_logo_path ?? null}, ${right_team_logo_path ?? null},
      ${waiting_match_id ?? null}, ${waiting_left_score ?? 0}, ${waiting_right_score ?? 0},
      ${waiting_left_team_name ?? ""}, ${waiting_right_team_name ?? ""},
      ${waiting_left_team_logo_path ?? null}, ${waiting_right_team_logo_path ?? null},
      ${category ?? ""}, now()
    )
    ON CONFLICT (event_id) DO UPDATE SET
      active_match_id = EXCLUDED.active_match_id,
      active_slot = EXCLUDED.active_slot,
      break_timer_sec = EXCLUDED.break_timer_sec,
      game_timer_sec = EXCLUDED.game_timer_sec,
      timer_mode = EXCLUDED.timer_mode,
      timer_running = EXCLUDED.timer_running,
      left_score = EXCLUDED.left_score,
      right_score = EXCLUDED.right_score,
      left_team_name = EXCLUDED.left_team_name,
      right_team_name = EXCLUDED.right_team_name,
      left_team_logo_path = EXCLUDED.left_team_logo_path,
      right_team_logo_path = EXCLUDED.right_team_logo_path,
      waiting_match_id = EXCLUDED.waiting_match_id,
      waiting_left_score = EXCLUDED.waiting_left_score,
      waiting_right_score = EXCLUDED.waiting_right_score,
      waiting_left_team_name = EXCLUDED.waiting_left_team_name,
      waiting_right_team_name = EXCLUDED.waiting_right_team_name,
      waiting_left_team_logo_path = EXCLUDED.waiting_left_team_logo_path,
      waiting_right_team_logo_path = EXCLUDED.waiting_right_team_logo_path,
      category = EXCLUDED.category,
      updated_at = now()
  `

  return NextResponse.json({ ok: true })
}
