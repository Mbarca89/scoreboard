"use client"

import { useMatchControl } from "@/hooks/use-match-control"
import { TeamPanel } from "@/components/control/team-panel"
import { TimerControl } from "@/components/control/timer-control"
import { DecisionPanel } from "@/components/control/decision-panel"
import { BlockSelector } from "@/components/control/block-selector"
import { DynamoSyncButton } from "@/components/control/dynamo-sync-button"
import { useButtonBindings } from "@/hooks/use-button-bindings"
import { useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"

type SocketConnection = {
  on: (event: string, cb: (...args: unknown[]) => void) => void
  off: (event: string, cb?: (...args: unknown[]) => void) => void
  disconnect: () => void
}

declare global {
  interface Window {
    io?: (url: string, options?: Record<string, unknown>) => SocketConnection
  }
}

const EVENT_ID = "axl-2026-fecha-2"
const SOCKET_SCRIPT_SRC = "https://cdn.socket.io/4.7.5/socket.io.min.js"

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function ControlBoard() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? EVENT_ID

  const {
    state,
    activeMatch,
    waitingMatch,
    loadBlock,
    startBreak,
    stopTimer,
    resumeTimer,
    setBreakTimer,
    setGameTimer,
    switchSlot,
    setScore,
    handleBase,
    handleConcede,
    approveStoppedPoint,
    approvePoint,
    reversePoint,
    noPoint,
    resumeStoppedGame,
    startOvertime,
    reopenMatch,
    useTimeout,
  } = useMatchControl(eventId)

  const [socketConnected, setSocketConnected] = useState(false)
  const [lastButtonId, setLastButtonId] = useState<number | null>(null)
  const [socketError, setSocketError] = useState<string | null>(null)
  const lastSocketEventRef = useRef<{ buttonId: number; ts: number } | null>(null)
  const scoringInputLockedRef = useRef(false)
  const { resolveAction } = useButtonBindings()

  const hasPendingDecision = state.pendingDecision !== null
  const isFromStop = state.pendingDecision?.fromStop ?? false
  const isPaused = activeMatch?.timerMode === "PAUSED"

  // A base/concede press closes the current scoring window immediately. This
  // ref changes synchronously, so repeated radio packets cannot slip through
  // while React is still rendering the resulting PAUSED/BREAK state.
  useEffect(() => {
    if (activeMatch?.timerMode === "GAME" && !hasPendingDecision) {
      scoringInputLockedRef.current = false
    }
  }, [activeMatch?.matchId, activeMatch?.timerMode, hasPendingDecision])

  // Resolve physical sides: when sidesSwapped, leftTeam is on the right and vice versa
  const swapped = activeMatch?.sidesSwapped ?? false
  const physLeftTeam = activeMatch ? (swapped ? activeMatch.rightTeam : activeMatch.leftTeam) : null
  const physRightTeam = activeMatch ? (swapped ? activeMatch.leftTeam : activeMatch.rightTeam) : null

  // Map physical field side to data side for BASE only.
  // On field, teams swap sides after each valid point.
  const toDataSide = useCallback((physSide: "left" | "right") => {
    if (!swapped) return physSide
    return physSide === "left" ? "right" : "left"
  }, [swapped])

  const getScoringSideFromBase = useCallback((physSide: "left" | "right") => {
    const baseDataSide = toDataSide(physSide)
    return baseDataSide === "left" ? "right" : "left"
  }, [toDataSide])

  const handleBaseSideButton = useCallback((physSide: "left" | "right") => {
    if (isFromStop) {
      approveStoppedPoint(getScoringSideFromBase(physSide))
      return
    }

    handleBase(toDataSide(physSide))
  }, [approveStoppedPoint, getScoringSideFromBase, handleBase, isFromStop, toDataSide])

  // Pit buttons are physically fixed to each side during the whole match.
  // So timeout/concede must always target the same data-side team.
  const handlePitSideButton = useCallback((pitSide: "left" | "right") => {
    if (!activeMatch) return

    // Same pit listener for timeout/concede:
    // - BREAK and break > 11 sec => timeout
    // - GAME => concede
    if (activeMatch.timerMode === "BREAK" && activeMatch.breakTimerSec > 11) {
      useTimeout(state.activeSlot, pitSide)
      return
    }

    if (activeMatch.timerMode === "GAME") {
      handleConcede(pitSide)
    }
  }, [activeMatch, handleConcede, state.activeSlot, useTimeout])

  // For pending decision display, resolve team name using physical position
  const pendingTeamName = hasPendingDecision
    ? (() => {
        const dataSide = state.pendingDecision!.side
        // The pending side is stored as data side, show corresponding team name
        if (dataSide === "left") return activeMatch?.leftTeam.name ?? ""
        return activeMatch?.rightTeam.name ?? ""
      })()
    : ""

  useEffect(() => {
    let socket: SocketConnection | null = null
    let isMounted = true

    const connectSocket = () => {
      if (!isMounted || !window.io) return

      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin
      socket = window.io(socketUrl, {
        transports: ["polling", "websocket"],
        upgrade: true,
      })

      const onConnect = () => {
        if (!isMounted) return
        setSocketConnected(true)
        setSocketError(null)
      }

      const onDisconnect = () => {
        if (isMounted) setSocketConnected(false)
      }

      const onConnectError = (error: unknown) => {
        if (!isMounted) return
        const message = error instanceof Error ? error.message : "error de conexión"
        setSocketError(message)
      }

      const onButtonEvent = async (payload: unknown) => {
        if (!payload || typeof payload !== "object") return

        const maybeButtonId = (payload as { buttonId?: unknown }).buttonId
        if (typeof maybeButtonId !== "number") return
        const now = Date.now()
        const last = lastSocketEventRef.current
        if (last && last.buttonId === maybeButtonId && now - last.ts < 250) {
          return
        }
        lastSocketEventRef.current = { buttonId: maybeButtonId, ts: now }

        setLastButtonId(maybeButtonId)

        const action = await resolveAction(maybeButtonId)
        const isScoringAction =
          action === "BASE_LEFT" ||
          action === "BASE_RIGHT" ||
          ((action === "PIT_LEFT" || action === "PIT_RIGHT") && activeMatch?.timerMode === "GAME")

        if (isScoringAction) {
          if (scoringInputLockedRef.current) return
          scoringInputLockedRef.current = true
        }

        switch (action) {
          case "BASE_LEFT":
            handleBaseSideButton("left")
            break
          case "PIT_LEFT":
            handlePitSideButton("left")
            break
          case "BASE_RIGHT":
            handleBaseSideButton("right")
            break
          case "PIT_RIGHT":
            handlePitSideButton("right")
            break
          default:
            break
        }
      }

      socket.on("connect", onConnect)
      socket.on("disconnect", onDisconnect)
      socket.on("connect_error", onConnectError)
      socket.on("button_press", onButtonEvent)
      socket.on("button", onButtonEvent)
    }

    if (window.io) {
      connectSocket()
    } else {
      const script = document.createElement("script")
      script.src = SOCKET_SCRIPT_SRC
      script.async = true
      script.onload = () => connectSocket()
      document.body.appendChild(script)
    }

    return () => {
      isMounted = false
      if (socket) {
        socket.disconnect()
      }
    }
  }, [activeMatch?.timerMode, handleBaseSideButton, handlePitSideButton, resolveAction])

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-3">
      <div className="flex items-center justify-end gap-2 rounded-lg border border-border bg-card/60 px-3 py-2">
        <DynamoSyncButton eventId={eventId} blockId={state.blockId} />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Socket botonera
        </span>
        <span
          className={`h-2.5 w-2.5 rounded-full ${socketConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-red-500"}`}
          aria-label={socketConnected ? "Socket conectado" : "Socket desconectado"}
          title={socketConnected ? "Socket conectado" : "Socket desconectado"}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {socketConnected ? "online" : "offline"}
        </span>
        {socketError && (
          <span className="max-w-[24rem] truncate font-mono text-[10px] text-destructive">
            {socketError}
          </span>
        )}
        {lastButtonId !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            btn:{lastButtonId}
          </span>
        )}
      </div>

      {/* Main 3-column layout */}
      <div className="flex flex-1 gap-3">
        {/* Left team (physical) */}
        <TeamPanel
          match={activeMatch ?? null}
          team={physLeftTeam}
          pitTeam={activeMatch?.leftTeam ?? null}
          baseTeam={physRightTeam}
          physicalSide="left"
          isActive={!hasPendingDecision || isFromStop}
          onBase={() => handleBaseSideButton("left")}
          onTimeout={() => handlePitSideButton("left")}
          onConcede={() => handlePitSideButton("left")}
          onScoreUp={() => setScore(toDataSide("left"), (physLeftTeam?.score ?? 0) + 1)}
          onScoreDown={() => setScore(toDataSide("left"), (physLeftTeam?.score ?? 0) - 1)}
          disabled={hasPendingDecision && !isFromStop}
          isPaused={isPaused}
          isStoppedDecision={isFromStop}
        />

        {/* Center controls */}
        <div className="flex w-80 shrink-0 flex-col gap-3">
          <TimerControl
            match={activeMatch ?? null}
            onStart={startBreak}
            onStop={stopTimer}
            onResume={resumeTimer}
            onSetBreak={setBreakTimer}
            onSetGameTimer={setGameTimer}
            onStartOvertime={startOvertime}
            onReopenMatch={reopenMatch}
            onCampoActivo={() => {}}
            hasPendingDecision={hasPendingDecision}
          />

          {/* Decision Panel */}
          {hasPendingDecision && (
            <DecisionPanel
              side={state.pendingDecision!.side}
              teamName={pendingTeamName}
              isFromStop={isFromStop}
              onApprove={approvePoint}
              onReverse={reversePoint}
              onNoPoint={noPoint}
              onResumeFromStop={resumeStoppedGame}
            />
          )}

          {/* Waiting match info */}
          {waitingMatch && !waitingMatch.isFinished && (
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                En espera - Partido {waitingMatch.slot}
              </span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-foreground">{waitingMatch.leftTeam.name}</span>
                <div className="flex flex-col items-center">
                  <span className="font-mono text-sm font-bold text-foreground">
                    {waitingMatch.leftTeam.score} - {waitingMatch.rightTeam.score}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                    {formatTime(waitingMatch.gameTimerSec)}
                  </span>
                </div>
                <span className="text-xs text-foreground">{waitingMatch.rightTeam.name}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right team (physical) */}
        <TeamPanel
          match={activeMatch ?? null}
          team={physRightTeam}
          pitTeam={activeMatch?.rightTeam ?? null}
          baseTeam={physLeftTeam}
          physicalSide="right"
          isActive={!hasPendingDecision || isFromStop}
          onBase={() => handleBaseSideButton("right")}
          onTimeout={() => handlePitSideButton("right")}
          onConcede={() => handlePitSideButton("right")}
          onScoreUp={() => setScore(toDataSide("right"), (physRightTeam?.score ?? 0) + 1)}
          onScoreDown={() => setScore(toDataSide("right"), (physRightTeam?.score ?? 0) - 1)}
          disabled={hasPendingDecision && !isFromStop}
          isPaused={isPaused}
          isStoppedDecision={isFromStop}
        />
      </div>

      {/* Bottom: Block selector */}
      <BlockSelector
        eventId={eventId}
        currentBlockId={state.blockId}
        activeSlot={state.activeSlot}
        matchA={state.matchA ? { name: state.matchA.leftTeam.name + " vs " + state.matchA.rightTeam.name, finished: state.matchA.isFinished } : null}
        matchB={state.matchB ? { name: state.matchB.leftTeam.name + " vs " + state.matchB.rightTeam.name, finished: state.matchB.isFinished } : null}
        onSelectBlock={loadBlock}
        onSwitchSlot={switchSlot}
      />
    </div>
  )
}

export default function ControlPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-foreground">Cargando...</div>}>
      <ControlBoard />
    </Suspense>
  )
}
