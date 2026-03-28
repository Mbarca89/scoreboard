"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { MatchState } from "@/lib/types"
import { Play, Pause, Megaphone, Pencil, Check, X, Plus, Minus } from "lucide-react"

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
  onSetGameTimer: (seconds: number) => void
  onCampoActivo: () => void
  hasPendingDecision: boolean
}

export function TimerControl({
  match,
  onStart,
  onStop,
  onResume,
  onSetBreak,
  onSetGameTimer,
  onCampoActivo,
  hasPendingDecision,
}: TimerControlProps) {
  const [editingGameTime, setEditingGameTime] = useState(false)
  const [editMinutes, setEditMinutes] = useState(0)
  const [editSeconds, setEditSeconds] = useState(0)

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
  const canEditGameTime = isIdle || isPaused

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
        {editingGameTime ? (
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-8 p-0"
                onClick={() => setEditMinutes((v) => v + 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <input
                type="number"
                min={0}
                max={99}
                value={editMinutes}
                onChange={(e) => setEditMinutes(Math.max(0, Math.min(99, Number(e.target.value))))}
                className="h-10 w-12 rounded border border-border bg-background text-center font-mono text-2xl font-black text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-8 p-0"
                onClick={() => setEditMinutes((v) => Math.max(0, v - 1))}
              >
                <Minus className="h-3 w-3" />
              </Button>
            </div>
            <span className="font-mono text-2xl font-black text-foreground">:</span>
            <div className="flex flex-col items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-8 p-0"
                onClick={() => setEditSeconds((v) => (v >= 59 ? 0 : v + 1))}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <input
                type="number"
                min={0}
                max={59}
                value={editSeconds}
                onChange={(e) => setEditSeconds(Math.max(0, Math.min(59, Number(e.target.value))))}
                className="h-10 w-12 rounded border border-border bg-background text-center font-mono text-2xl font-black text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-8 p-0"
                onClick={() => setEditSeconds((v) => Math.max(0, v - 1))}
              >
                <Minus className="h-3 w-3" />
              </Button>
            </div>
            <div className="ml-1 flex flex-col gap-1">
              <Button
                variant="default"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  onSetGameTimer(editMinutes * 60 + editSeconds)
                  setEditingGameTime(false)
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setEditingGameTime(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`font-mono text-4xl font-black tracking-tight ${gameColor}`}>
              {formatTime(match.gameTimerSec)}
            </span>
            {canEditGameTime && !hasPendingDecision && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setEditMinutes(Math.floor(match.gameTimerSec / 60))
                  setEditSeconds(match.gameTimerSec % 60)
                  setEditingGameTime(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetBreak(121)}
          disabled={isGame || hasPendingDecision}
          className="text-xs"
        >
          2 min
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetBreak(300)}
          disabled={isGame || hasPendingDecision}
          className="text-xs"
        >
          5 min
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
