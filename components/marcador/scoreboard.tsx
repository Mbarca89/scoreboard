"use client"

import useSWR from "swr"
import type { MatchLiveState, TimerMode } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function getModeLabel(mode: TimerMode): string {
  switch (mode) {
    case "BREAK":
      return "BREAK"
    case "GAME":
      return "EN JUEGO"
    case "PAUSED":
      return "PAUSADO"
    default:
      return "ESPERANDO"
  }
}

function getModeColor(mode: TimerMode): string {
  switch (mode) {
    case "BREAK":
      return "text-timer-break"
    case "GAME":
      return "text-timer-game"
    case "PAUSED":
      return "text-timer-paused"
    default:
      return "text-muted-foreground"
  }
}

interface ScoreboardProps {
  eventId: string
}

export function Scoreboard({ eventId }: ScoreboardProps) {
  const { data } = useSWR<MatchLiveState>(
    `/api/live-state?eventId=${eventId}`,
    fetcher,
    { refreshInterval: 500 }
  )

  if (!data || !data.active_match_id) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <p className="text-xl text-muted-foreground">Esperando inicio del partido...</p>
      </div>
    )
  }

  const mode = data.timer_mode as TimerMode
  const isBreak = mode === "BREAK"
  const hasWaiting = !!data.waiting_match_id

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Break Timer - MOST PROMINENT when in break mode */}
      {isBreak && (
        <div className="flex flex-col items-center justify-center gap-2 bg-timer-break/10 px-8 py-8">
          <span className="text-sm font-bold uppercase tracking-[0.4em] text-timer-break">
            Break - Tiempo para entrar
          </span>
          <span className="font-mono text-8xl font-black tracking-tight text-timer-break md:text-[10rem]">
            {formatTime(data.break_timer_sec)}
          </span>
        </div>
      )}

      {/* Main scoreboard */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
        {/* Category */}
        {data.category && (
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {data.category}
          </span>
        )}

        {/* Teams and Score */}
        <div className="flex w-full max-w-4xl items-center justify-center gap-8">
          {/* Left team */}
          <div className="flex flex-1 flex-col items-end gap-1">
            <h2 className="text-right text-3xl font-bold text-foreground md:text-5xl">
              {data.left_team_name}
            </h2>
          </div>

          {/* Score */}
          <div className="flex items-center gap-4">
            <span className="font-mono text-7xl font-black text-foreground md:text-9xl">
              {data.left_score}
            </span>
            <span className="text-3xl font-light text-muted-foreground md:text-5xl">:</span>
            <span className="font-mono text-7xl font-black text-foreground md:text-9xl">
              {data.right_score}
            </span>
          </div>

          {/* Right team */}
          <div className="flex flex-1 flex-col items-start gap-1">
            <h2 className="text-left text-3xl font-bold text-foreground md:text-5xl">
              {data.right_team_name}
            </h2>
          </div>
        </div>

        {/* Game Timer + Mode - always visible */}
        <div className="flex flex-col items-center gap-2">
          {/* When in break, game timer shows smaller as reference */}
          <span className={`font-mono font-black tracking-tight ${
            isBreak 
              ? "text-2xl text-muted-foreground md:text-3xl" 
              : "text-5xl md:text-7xl"
          } ${!isBreak ? getModeColor(mode) : ""}`}>
            {formatTime(data.game_timer_sec)}
          </span>
          <span className={`text-sm font-semibold uppercase tracking-widest ${getModeColor(mode)}`}>
            {getModeLabel(mode)}
          </span>
          {/* When NOT in break, show break timer as small reference */}
          {!isBreak && data.break_timer_sec > 0 && (
            <span className="mt-1 font-mono text-lg text-timer-break/60">
              Break: {formatTime(data.break_timer_sec)}
            </span>
          )}
        </div>
      </div>

      {/* Waiting match (smaller, at bottom) */}
      {hasWaiting && (
        <div className="border-t border-border bg-card/30 px-8 py-4">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-sm text-muted-foreground">{data.waiting_left_team_name}</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-bold text-muted-foreground">
                {data.waiting_left_score}
              </span>
              <span className="text-xs text-muted-foreground/60">-</span>
              <span className="font-mono text-lg font-bold text-muted-foreground">
                {data.waiting_right_score}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">{data.waiting_right_team_name}</span>
          </div>
          <p className="mt-1 text-center text-[10px] uppercase tracking-widest text-muted-foreground/50">
            En espera
          </p>
        </div>
      )}
    </div>
  )
}
