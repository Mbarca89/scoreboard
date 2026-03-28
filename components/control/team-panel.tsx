"use client"

import { Button } from "@/components/ui/button"
import type { MatchState, TeamState } from "@/lib/types"
import { Clock, Siren, Flag, Plus, Minus } from "lucide-react"

interface TeamPanelProps {
  match: MatchState | null
  team: TeamState | null
  physicalSide: "left" | "right"
  isActive: boolean
  onBase: () => void
  onTimeout: () => void
  onConcede: () => void
  onScoreUp: () => void
  onScoreDown: () => void
  disabled: boolean
  isPaused: boolean
}

export function TeamPanel({
  match,
  team,
  physicalSide,
  isActive,
  onBase,
  onTimeout,
  onConcede,
  onScoreUp,
  onScoreDown,
  disabled,
  isPaused,
}: TeamPanelProps) {
  if (!match || !team) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-border bg-card p-6">
        <p className="text-muted-foreground">Sin equipo</p>
      </div>
    )
  }

  const isFinished = match.isFinished
  const isGame = match.timerMode === "GAME"
  const isBreakTimeoutWindow = match.timerMode === "BREAK" && match.breakTimerSec > 11
  const canEditScore = match.timerMode === "IDLE" || isPaused

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-between rounded-lg border p-4 transition-all ${
        isActive && !isFinished
          ? "border-primary/50 bg-card shadow-[0_0_20px_rgba(100,200,100,0.08)]"
          : isFinished
            ? "border-border/50 bg-card/50 opacity-60"
            : "border-border bg-card"
      }`}
    >
      {/* Team name */}
      <div className="flex w-full flex-col items-center gap-1">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {match.slot === "A" ? "Partido A" : "Partido B"} - {physicalSide === "left" ? "Izquierda" : "Derecha"}
        </span>
        <h2 className="text-center text-xl font-bold text-foreground">{team.name}</h2>
        {match.sidesSwapped && (
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
            Lado cambiado
          </span>
        )}
      </div>

      {/* Score with +/- buttons */}
      <div className="my-4 flex flex-col items-center">
        <div className="flex items-center gap-2">
          {canEditScore && !isFinished && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-10 p-0"
              onClick={onScoreDown}
              disabled={team.score <= 0}
            >
              <Minus className="h-4 w-4" />
            </Button>
          )}
          <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-score-bg">
            <span className="font-mono text-5xl font-black text-foreground">{team.score}</span>
          </div>
          {canEditScore && !isFinished && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-10 p-0"
              onClick={onScoreUp}
              disabled={team.score >= match.maxPoints}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        <span className="mt-1 text-xs text-muted-foreground">
          / {match.maxPoints} pts
        </span>
      </div>

      {/* Actions */}
      <div className="flex w-full flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={onTimeout}
          disabled={disabled || team.timeoutUsed || isFinished || !isActive || !isBreakTimeoutWindow}
        >
          <Clock className="h-4 w-4" />
          {team.timeoutUsed ? "Timeout usado" : "Time Out"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 border-amber-600 text-amber-500 hover:bg-amber-600/10 hover:text-amber-400"
          onClick={onConcede}
          disabled={disabled || isFinished || !isActive || !isGame}
        >
          <Flag className="h-4 w-4" />
          Conceder
        </Button>

        <Button
          className="h-14 w-full text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onBase}
          disabled={disabled || isFinished || !isActive || !isGame}
        >
          <Siren className="mr-2 h-5 w-5" />
          BASE
        </Button>
      </div>
    </div>
  )
}
