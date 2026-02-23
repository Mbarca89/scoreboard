"use client"

import { Button } from "@/components/ui/button"
import type { MatchState } from "@/lib/types"
import { Clock, Siren, Flag } from "lucide-react"

interface TeamPanelProps {
  match: MatchState | null
  side: "left" | "right"
  isActive: boolean
  onBase: () => void
  onTimeout: () => void
  onConcede: () => void
  disabled: boolean
  isPaused: boolean
}

export function TeamPanel({ match, side, isActive, onBase, onTimeout, onConcede, disabled, isPaused }: TeamPanelProps) {
  if (!match) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-border bg-card p-6">
        <p className="text-muted-foreground">Sin equipo</p>
      </div>
    )
  }

  const team = side === "left" ? match.leftTeam : match.rightTeam
  const isFinished = match.isFinished
  const isGameOrPaused = match.timerMode === "GAME" || isPaused

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
          {match.slot === "A" ? "Partido A" : "Partido B"} - {side === "left" ? "Izquierda" : "Derecha"}
        </span>
        <h2 className="text-center text-xl font-bold text-foreground">{team.name}</h2>
      </div>

      {/* Score */}
      <div className="my-4 flex flex-col items-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-score-bg">
          <span className="font-mono text-5xl font-black text-foreground">{team.score}</span>
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
          disabled={disabled || team.timeoutUsed || isFinished || !isActive}
        >
          <Clock className="h-4 w-4" />
          {team.timeoutUsed ? "Timeout usado" : "Time Out"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 border-amber-600 text-amber-500 hover:bg-amber-600/10 hover:text-amber-400"
          onClick={onConcede}
          disabled={disabled || isFinished || !isActive || !(isGameOrPaused)}
        >
          <Flag className="h-4 w-4" />
          Conceder
        </Button>

        <Button
          className="h-14 w-full text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onBase}
          disabled={disabled || isFinished || !isActive || !(isGameOrPaused)}
        >
          <Siren className="mr-2 h-5 w-5" />
          BASE
        </Button>
      </div>
    </div>
  )
}
