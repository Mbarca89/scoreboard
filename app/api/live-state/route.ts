import { NextRequest, NextResponse } from "next/server"
import { getLiveState, setLiveState } from "@/lib/live-state-store"

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 })
  }

  return NextResponse.json(getLiveState(eventId))
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
    left_entry_side,
    right_entry_side,
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

  const state = setLiveState(event_id, {
    event_id,
    active_match_id: active_match_id ?? null,
    active_slot: active_slot ?? "A",
    break_timer_sec: break_timer_sec ?? 60,
    game_timer_sec: game_timer_sec ?? 0,
    timer_mode: timer_mode ?? "IDLE",
    timer_running: timer_running ?? false,
    left_score: left_score ?? 0,
    right_score: right_score ?? 0,
    left_team_name: left_team_name ?? "",
    right_team_name: right_team_name ?? "",
    left_team_logo_path: left_team_logo_path ?? null,
    right_team_logo_path: right_team_logo_path ?? null,
    left_entry_side: left_entry_side === "blue" ? "blue" : "red",
    right_entry_side: right_entry_side === "red" ? "red" : "blue",
    waiting_match_id: waiting_match_id ?? null,
    waiting_left_score: waiting_left_score ?? 0,
    waiting_right_score: waiting_right_score ?? 0,
    waiting_left_team_name: waiting_left_team_name ?? "",
    waiting_right_team_name: waiting_right_team_name ?? "",
    waiting_left_team_logo_path: waiting_left_team_logo_path ?? null,
    waiting_right_team_logo_path: waiting_right_team_logo_path ?? null,
    category: category ?? "",
  })

  return NextResponse.json({ ok: true, updated_at: state.updated_at })
}
