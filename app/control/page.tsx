"use client"

import { useMatchControl } from "@/hooks/use-match-control"
import { TeamPanel } from "@/components/control/team-panel"
import { TimerControl } from "@/components/control/timer-control"
import { DecisionPanel } from "@/components/control/decision-panel"
import { BlockSelector } from "@/components/control/block-selector"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

const EVENT_ID = "evt-001"

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
    campoActivo,
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
  const pendingTeamName = hasPendingDecision
    ? state.pendingDecision!.side === "left"
      ? activeMatch?.leftTeam.name ?? ""
      : activeMatch?.rightTeam.name ?? ""
    : ""

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-3">
      {/* Header
      <header className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">
            Mesa de Control
          </h1>
          {state.singleMatchMode && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
              PARTIDO UNICO
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {activeMatch?.category ?? ""}
        </span>
      </header> */}

      {/* Main 3-column layout */}
      <div className="flex flex-1 gap-3">
        {/* Left team */}
        <TeamPanel
          match={activeMatch ?? null}
          side="left"
          isActive={!hasPendingDecision || isFromStop}
          onBase={() => handleBase("left")}
          onTimeout={() => useTimeout(state.activeSlot, "left")}
          onConcede={() => handleConcede("left")}
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
            onCampoActivo={campoActivo}
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

        {/* Right team */}
        <TeamPanel
          match={activeMatch ?? null}
          side="right"
          isActive={!hasPendingDecision || isFromStop}
          onBase={() => handleBase("right")}
          onTimeout={() => useTimeout(state.activeSlot, "right")}
          onConcede={() => handleConcede("right")}
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
