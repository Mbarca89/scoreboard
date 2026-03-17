"use client"

import { useMatchControl } from "@/hooks/use-match-control"
import { TeamPanel } from "@/components/control/team-panel"
import { TimerControl } from "@/components/control/timer-control"
import { DecisionPanel } from "@/components/control/decision-panel"
import { BlockSelector } from "@/components/control/block-selector"
import { DynamoSyncButton } from "@/components/control/dynamo-sync-button"
import { useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect } from "react"

const EVENT_ID = "axl-2026-fecha-1"

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
    approvePoint,
    reversePoint,
    noPoint,
    useTimeout,
  } = useMatchControl(eventId)

  const hasPendingDecision = state.pendingDecision !== null
  const isFromStop = state.pendingDecision?.fromStop ?? false
  const isPaused = activeMatch?.timerMode === "PAUSED"

  // Resolve physical sides: when sidesSwapped, leftTeam is on the right and vice versa
  const swapped = activeMatch?.sidesSwapped ?? false
  const physLeftTeam = activeMatch ? (swapped ? activeMatch.rightTeam : activeMatch.leftTeam) : null
  const physRightTeam = activeMatch ? (swapped ? activeMatch.leftTeam : activeMatch.rightTeam) : null

  // Map physical side to data side for handleBase/handleConcede/useTimeout
  // Physical "left" = data "left" when not swapped, data "right" when swapped
  const toDataSide = (physSide: "left" | "right") => {
    if (!swapped) return physSide
    return physSide === "left" ? "right" : "left"
  }

  // For pending decision display, resolve team name using physical position
  const pendingTeamName = hasPendingDecision
    ? (() => {
        const dataSide = state.pendingDecision!.side
        // The pending side is stored as data side, show corresponding team name
        if (dataSide === "left") return activeMatch?.leftTeam.name ?? ""
        return activeMatch?.rightTeam.name ?? ""
      })()
    : ""

  const handleLeftBase = useCallback(() => {
    handleBase(toDataSide("left"))
  }, [handleBase, toDataSide])

  const handleLeftConcede = useCallback(() => {
    handleConcede(toDataSide("left"))
  }, [handleConcede, toDataSide])

  const handleRightConcede = useCallback(() => {
    handleConcede(toDataSide("right"))
  }, [handleConcede, toDataSide])

  const handleRightBase = useCallback(() => {
    handleBase(toDataSide("right"))
  }, [handleBase, toDataSide])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase()
        if (target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") {
          return
        }
      }

      const key = event.key.toLowerCase()

      if (key === "q") {
        event.preventDefault()
        handleLeftBase()
      } else if (key === "w") {
        event.preventDefault()
        handleLeftConcede()
      } else if (key === "e") {
        event.preventDefault()
        handleRightConcede()
      } else if (key === "r") {
        event.preventDefault()
        handleRightBase()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleLeftBase, handleLeftConcede, handleRightConcede, handleRightBase])

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-3">
      <div className="flex items-center justify-end">
        <DynamoSyncButton eventId={eventId} />
      </div>
      {/* Main 3-column layout */}
      <div className="flex flex-1 gap-3">
        {/* Left team (physical) */}
        <TeamPanel
          match={activeMatch ?? null}
          team={physLeftTeam}
          physicalSide="left"
          isActive={!hasPendingDecision || isFromStop}
          onBase={handleLeftBase}
          onTimeout={() => useTimeout(state.activeSlot, toDataSide("left"))}
          onConcede={handleLeftConcede}
          onScoreUp={() => setScore(toDataSide("left"), (physLeftTeam?.score ?? 0) + 1)}
          onScoreDown={() => setScore(toDataSide("left"), (physLeftTeam?.score ?? 0) - 1)}
          disabled={hasPendingDecision && !isFromStop}
          isPaused={isPaused}
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
                <span className="font-mono text-sm font-bold text-foreground">
                  {waitingMatch.leftTeam.score} - {waitingMatch.rightTeam.score}
                </span>
                <span className="text-xs text-foreground">{waitingMatch.rightTeam.name}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right team (physical) */}
        <TeamPanel
          match={activeMatch ?? null}
          team={physRightTeam}
          physicalSide="right"
          isActive={!hasPendingDecision || isFromStop}
          onBase={handleRightBase}
          onTimeout={() => useTimeout(state.activeSlot, toDataSide("right"))}
          onConcede={handleRightConcede}
          onScoreUp={() => setScore(toDataSide("right"), (physRightTeam?.score ?? 0) + 1)}
          onScoreDown={() => setScore(toDataSide("right"), (physRightTeam?.score ?? 0) - 1)}
          disabled={hasPendingDecision && !isFromStop}
          isPaused={isPaused}
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
