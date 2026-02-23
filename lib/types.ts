/* ── Enums ─────────────────────────────────────────── */

export type AXLCategory = "5v5 D3/D4" | "3v3 D5" | "3v3 D6"
export type AXLSlot = "A" | "B"
export type AXLBlockStatus = "SCHEDULED" | "IN_PROGRESS" | "DONE"
export type AXLMatchResult = "LEFT_WIN" | "RIGHT_WIN" | "DRAW"
export type AXLEventStage = "GROUP" | "BRACKET" | "QUARTER" | "SEMI" | "FINAL"
export type AXLOvertimeType = "POINT" | "1V1"

export type TimerMode = "IDLE" | "BREAK" | "GAME" | "PAUSED"

/* ── DB rows ──────────────────────────────────────── */

export interface FixtureBlock {
  event_id: string
  block_id: string
  block_order: number
  category: AXLCategory
  stage: AXLEventStage
  group_id: string | null
  round_number: number | null
  scheduled_at: string | null
  active_slot: AXLSlot
  status: AXLBlockStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Match {
  event_id: string
  match_id: string
  block_id: string
  slot: AXLSlot
  category: AXLCategory
  stage: AXLEventStage
  group_id: string | null
  round_number: number | null
  scheduled_at: string | null
  display_label: string | null
  left_team_id: string
  left_team_name: string
  left_team_logo_path: string | null
  right_team_id: string
  right_team_name: string
  right_team_logo_path: string | null
  left_score: number
  right_score: number
  time_remaining_sec: number
  notes: string | null
  is_finished: boolean
  result_type: AXLMatchResult | null
  winner_team_id: string | null
  is_overtime: boolean
  overtime_type: AXLOvertimeType | null
  overtime_winner_team_id: string | null
  reported_by_user_id: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

export interface MatchLiveState {
  event_id: string
  active_match_id: string | null
  active_slot: string
  break_timer_sec: number
  game_timer_sec: number
  timer_mode: TimerMode
  timer_running: boolean
  left_score: number
  right_score: number
  left_team_name: string
  right_team_name: string
  left_team_logo_path: string | null
  right_team_logo_path: string | null
  waiting_match_id: string | null
  waiting_left_score: number
  waiting_right_score: number
  waiting_left_team_name: string
  waiting_right_team_name: string
  waiting_left_team_logo_path: string | null
  waiting_right_team_logo_path: string | null
  category: string
  updated_at: string
}

/* ── Client-side state ────────────────────────────── */

export interface TeamState {
  id: string
  name: string
  logoPath: string | null
  score: number
  timeoutUsed: boolean
}

export interface MatchState {
  matchId: string
  slot: AXLSlot
  leftTeam: TeamState
  rightTeam: TeamState
  gameTimerSec: number
  breakTimerSec: number
  timerMode: TimerMode
  isFinished: boolean
  category: AXLCategory
  maxPoints: number
  maxGameTimeSec: number
}

export interface ControlState {
  eventId: string
  blockId: string
  matchA: MatchState | null
  matchB: MatchState | null
  activeSlot: AXLSlot
  pendingDecision: {
    side: "left" | "right"
    matchId: string
    fromStop?: boolean
  } | null
  singleMatchMode: boolean
}

export type SoundName =
  | "1-minute"
  | "2-minutes"
  | "10-seconds"
  | "20-seconds"
  | "30-seconds"
  | "60-seconds"
  | "base"
  | "concede"
  | "game-finished"
  | "game-start"
  | "game-stop"
  | "game-time-finished"
  | "no-points"
  | "overtime"
  | "point-approved"
  | "reverse-point"
  | "timeout"
  | "time-over"
  | "towel"

export type BeepSpec = { freq: number; duration: number; count: number; silence?: number }
