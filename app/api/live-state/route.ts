import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 })
  }

  try {
    const rows = await sql`
      SELECT * FROM match_live_state WHERE event_id = ${eventId}
    `

    if (rows.length === 0) {
      return NextResponse.json(null)
    }

    return NextResponse.json(rows[0])
  } catch (error: unknown) {
    console.error("[v0] live-state GET error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
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

  // Coerce values to avoid undefined going into SQL
  const safeActiveMatchId = active_match_id ?? null
  const safeActiveSlot = active_slot ?? "A"
  const safeBreakTimer = break_timer_sec ?? 60
  const safeGameTimer = game_timer_sec ?? 0
  const safeTimerMode = timer_mode ?? "IDLE"
  const safeTimerRunning = timer_running ?? false
  const safeLeftScore = left_score ?? 0
  const safeRightScore = right_score ?? 0
  const safeLeftName = left_team_name ?? ""
  const safeRightName = right_team_name ?? ""
  const safeLeftLogo = left_team_logo_path ?? null
  const safeRightLogo = right_team_logo_path ?? null
  const safeWaitingMatchId = waiting_match_id ?? null
  const safeWaitingLeftScore = waiting_left_score ?? 0
  const safeWaitingRightScore = waiting_right_score ?? 0
  const safeWaitingLeftName = waiting_left_team_name ?? ""
  const safeWaitingRightName = waiting_right_team_name ?? ""
  const safeWaitingLeftLogo = waiting_left_team_logo_path ?? null
  const safeWaitingRightLogo = waiting_right_team_logo_path ?? null
  const safeCategory = category ?? ""

  try {
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
        ${event_id}, ${safeActiveMatchId}, ${safeActiveSlot},
        ${safeBreakTimer}, ${safeGameTimer}, ${safeTimerMode}, ${safeTimerRunning},
        ${safeLeftScore}, ${safeRightScore}, ${safeLeftName}, ${safeRightName},
        ${safeLeftLogo}, ${safeRightLogo},
        ${safeWaitingMatchId}, ${safeWaitingLeftScore}, ${safeWaitingRightScore},
        ${safeWaitingLeftName}, ${safeWaitingRightName},
        ${safeWaitingLeftLogo}, ${safeWaitingRightLogo},
        ${safeCategory}, now()
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
  } catch (error: unknown) {
    console.error("[v0] live-state PUT error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
