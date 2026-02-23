"use client"

import { Button } from "@/components/ui/button"
import type { MatchState } from "@/lib/types"
import { Play, Pause, Megaphone } from "lucide-react"

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

interface TimerControlProps {
  match: MatchState | null
  onStart: () => void
  onStop: () => void
  onResume: () => void
  onSetBreak: (seconds: number) => void
  onCampoActivo: () => void
  hasPendingDecision: boolean
}

export function TimerControl({
  match,
  onStart,
  onStop,
  onResume,
  onSetBreak,
  onCampoActivo,
  hasPendingDecision,
}: TimerControlProps) {
  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-8">
        <p className="text-muted-foreground">Selecciona un bloque para empezar</p>
      </div>
    )
  }

  const isRunning = match.timerMode === "BREAK" || match.timerMode === "GAME"
  const isPaused = match.timerMode === "PAUSED"
  const isIdle = match.timerMode === "IDLE"
  const isBreak = match.timerMode === "BREAK"
  const isGame = match.timerMode === "GAME"

  const breakColor = isBreak ? "text-timer-break" : "text-muted-foreground"
  const gameColor = isGame ? "text-timer-game" : "text-muted-foreground"

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-5">
      {/* Active match indicator */}
      <div className="flex items-center gap-2">
        <div className={`h-2.5 w-2.5 rounded-full ${isRunning ? "animate-pulse bg-primary" : isPaused ? "bg-timer-paused" : "bg-muted-foreground"}`} />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {match.slot === "A" ? "Partido A" : "Partido B"}
          {match.isFinished ? " - TERMINADO" : ""}
        </span>
      </div>

      {/* Break Timer */}
      <div className="flex flex-col items-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Break</span>
        <span className={`font-mono text-4xl font-black tracking-tight ${breakColor}`}>
          {formatTime(match.breakTimerSec)}
        </span>
      </div>

      {/* Game Timer */}
      <div className="flex flex-col items-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Juego</span>
        <span className={`font-mono text-4xl font-black tracking-tight ${gameColor}`}>
          {formatTime(match.gameTimerSec)}
        </span>
      </div>

      {/* Timer mode label */}
      <div className="flex h-6 items-center">
        {isBreak && (
          <span className="rounded-full bg-timer-break/15 px-3 py-0.5 text-xs font-semibold text-timer-break">
            BREAK EN CURSO
          </span>
        )}
        {isGame && (
          <span className="rounded-full bg-timer-game/15 px-3 py-0.5 text-xs font-semibold text-timer-game">
            JUEGO EN CURSO
          </span>
        )}
        {isPaused && (
          <span className="rounded-full bg-timer-paused/15 px-3 py-0.5 text-xs font-semibold text-timer-paused">
            PAUSADO
          </span>
        )}
        {isIdle && (
          <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-semibold text-muted-foreground">
            ESPERANDO
          </span>
        )}
      </div>

      {/* Break presets - enabled during break so operator can adjust on the fly */}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetBreak(11)}
          disabled={isGame || hasPendingDecision}
          className="text-xs"
        >
          10s
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetBreak(31)}
          disabled={isGame || hasPendingDecision}
          className="text-xs"
        >
          30s
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetBreak(61)}
          disabled={isGame || hasPendingDecision}
          className="text-xs"
        >
          1 min
        </Button>
      </div>

      {/* Campo Activo */}
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={onCampoActivo}
        disabled={hasPendingDecision}
      >
        <Megaphone className="h-4 w-4" />
        Campo Activo
      </Button>

      {/* Start / Stop */}
      {isIdle && (
        <Button
          className="h-14 w-full text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onStart}
          disabled={hasPendingDecision || match.isFinished}
        >
          <Play className="mr-2 h-5 w-5" />
          START
        </Button>
      )}

      {isRunning && (
        <Button
          className="h-14 w-full text-lg font-bold bg-timer-paused text-foreground hover:bg-timer-paused/90"
          onClick={onStop}
          disabled={hasPendingDecision}
        >
          <Pause className="mr-2 h-5 w-5" />
          STOP
        </Button>
      )}

      {isPaused && !hasPendingDecision && (
        <Button
          className="h-14 w-full text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onResume}
        >
          <Play className="mr-2 h-5 w-5" />
          REANUDAR
        </Button>
      )}
    </div>
  )
}
