"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import type { MatchLiveState, TimerMode } from "@/lib/types"
import { Shield } from "lucide-react"
import { Badge } from "../ui/badge"

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

/* ── High-contrast colors for outdoor sun visibility ── */
function SideBadge({ side }: { side: "red" | "blue" }) {
  const className =
    side === "red"
      ? "h-3 w-full max-w-[25rem] border-transparent bg-red-600"
      : "h-3 w-full max-w-[25rem] border-transparent bg-blue-600"

  return <Badge className={className} aria-label={side === "red" ? "Lado rojo" : "Lado azul"} />
}

const MODE_STYLES: Record<TimerMode | string, { text: string; bg: string }> = {
  BREAK: { text: "text-amber-300", bg: "bg-amber-300/15" },
  GAME: { text: "text-cyan-300", bg: "bg-cyan-300/10" },
  PAUSED: { text: "text-red-400", bg: "bg-red-400/10" },
  IDLE: { text: "text-neutral-400", bg: "" },
}

function TeamLogo({
  src,
  alt,
  size = 64,
}: {
  src: string | null | undefined
  alt: string
  size?: number | string
}) {
  const [error, setError] = useState(false)

  if (!src || error) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border-2 border-neutral-700 bg-neutral-800"
        style={{ width: size, height: size }}
      >
        <Shield
          className="text-neutral-500"
          style={{
            width: typeof size === "number" ? size * 0.5 : "50%",
            height: typeof size === "number" ? size * 0.5 : "50%",
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg"
      style={{ width: size, height: size }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-contain"
        onError={() => setError(true)}
        unoptimized
      />
    </div>
  )
}

function WaitingTeamLogo({
  src,
  alt,
}: {
  src: string | null | undefined
  alt: string
}) {
  const [error, setError] = useState(false)

  if (!src || error) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded border border-neutral-700 bg-neutral-800">
        <Shield className="h-4 w-4 text-neutral-600" />
      </div>
    )
  }

  return (
    <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
      <Image
        src={src}
        alt={alt}
        fill
        className="object-contain"
        onError={() => setError(true)}
        unoptimized
      />
    </div>
  )
}

interface ScoreboardProps {
  eventId: string
}

export function Scoreboard({ eventId }: ScoreboardProps) {
  const [now, setNow] = useState(() => Date.now())

  const [data, setData] = useState<MatchLiveState | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(`/api/live-state?eventId=${eventId}`)
      .then((r) => r.json())
      .then((initial) => {
        if (!cancelled) setData(initial)
      })
      .catch(() => {
        // silent
      })

    const es = new EventSource(`/api/live-state/stream?eventId=${eventId}`)
    es.onmessage = (event) => {
      try {
        setData(JSON.parse(event.data))
      } catch {
        // ignore malformed payload
      }
    }

    return () => {
      cancelled = true
      es.close()
    }
  }, [eventId])

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, 250)

    return () => window.clearInterval(id)
  }, [])

  const displayedTimers = useMemo(() => {
    if (!data) {
      return { gameTimerSec: 0, breakTimerSec: 0 }
    }

    const updatedAtMs = Date.parse(data.updated_at)
    const elapsedSeconds = Number.isNaN(updatedAtMs)
      ? 0
      : Math.max(0, Math.floor((now - updatedAtMs) / 1000))

    if (!data.timer_running) {
      return {
        gameTimerSec: data.game_timer_sec,
        breakTimerSec: data.break_timer_sec,
      }
    }

    if (data.timer_mode === "GAME") {
      return {
        gameTimerSec: Math.max(0, data.game_timer_sec - elapsedSeconds),
        breakTimerSec: data.break_timer_sec,
      }
    }

    if (data.timer_mode === "BREAK") {
      return {
        gameTimerSec: data.game_timer_sec,
        breakTimerSec: Math.max(0, data.break_timer_sec - elapsedSeconds),
      }
    }

    return {
      gameTimerSec: data.game_timer_sec,
      breakTimerSec: data.break_timer_sec,
    }
  }, [data, now])

  if (!data || !data.active_match_id) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black">
        <Image
          src="/images/axl-logo.png"
          alt="AXL - Argentinean Xball League"
          width={200}
          height={200}
          className="mb-6 opacity-60"
          unoptimized
        />
        <p className="text-lg font-semibold uppercase tracking-widest text-neutral-500">
          Esperando inicio del partido...
        </p>
      </div>
    )
  }

  const mode = (data.timer_mode as TimerMode) || "IDLE"
  const isBreak = mode === "BREAK"
  const hasWaiting = !!data.waiting_match_id
  const style = MODE_STYLES[mode] ?? MODE_STYLES.IDLE
  const leftEntrySide = data.left_entry_side ?? "red"
  const rightEntrySide = data.right_entry_side ?? "blue"

  return (
    <div className="flex min-h-dvh flex-col overflow-y-auto bg-black">
      {/* ── Break timer banner ── */}
      {isBreak && (
        <div className="absolute left-0 right-0 top-0 z-10 flex flex-col items-center justify-center gap-1 px-[clamp(1rem,4vmin,2rem)] py-[clamp(0.75rem,3vmin,1.5rem)]">
          <span className="text-xs font-black uppercase tracking-[0.5em] text-amber-300">
            Break - Tiempo para entrar
          </span>
          <span className="font-mono text-[clamp(4rem,18vmin,10rem)] font-black tracking-tight text-amber-300">
            {formatTime(displayedTimers.breakTimerSec)}
          </span>
        </div>
      )}

      {/* ── Main scoreboard ── */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[clamp(0.5rem,2vmin,1rem)] px-[clamp(1rem,4vmin,3rem)] py-2">
        {/* Category + AXL logo */}


        {/* Teams + Score row */}
        <div className="flex w-full min-w-0 items-center justify-between gap-[clamp(0.5rem,2.5vmin,2rem)]">
          {/* Left team */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-[clamp(0.5rem,2vmin,1rem)]">
            <SideBadge side={leftEntrySide} />
            <TeamLogo
              src={data.left_team_logo_path}
              alt={data.left_team_name}
              size="clamp(8rem, 27vmin, 18rem)"
            />
            <h2 className="w-full truncate text-center text-[clamp(1.25rem,4vmin,3rem)] font-black uppercase tracking-wide text-white">
              {data.left_team_name}
            </h2>
            <SideBadge side={leftEntrySide} />
          </div>

          {/* Score */}
          <div className="flex shrink-0 flex-col items-center gap-[clamp(0.75rem,3vmin,1.5rem)] rounded-lg px-[clamp(0.5rem,3vmin,2rem)] py-[clamp(0.5rem,2vmin,1.5rem)]">

            <div className="flex items-center gap-[clamp(0.5rem,2vmin,1.25rem)]">
              <span className="font-mono text-[clamp(4rem,14vmin,8rem)] font-black text-white" style={{ textShadow: "0 0 30px rgba(255,255,255,0.3)" }}>
                {data.left_score}
              </span>
              <span className="text-[clamp(2rem,7vmin,3.75rem)] font-black text-neutral-600">:</span>
              <span className="font-mono text-[clamp(4rem,14vmin,8rem)] font-black text-white" style={{ textShadow: "0 0 30px rgba(255,255,255,0.3)" }}>
                {data.right_score}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Image
                src="/images/axl-logo.png"
                alt="AXL"
                width={36}
                height={36}
                className="opacity-80"
                unoptimized
              />
              {data.category && (
                <span className="text-xs font-black uppercase tracking-[0.4em] text-neutral-400">
                  {data.category}
                </span>
              )}
            </div>
          </div>

          {/* Right team */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-start gap-[clamp(0.5rem,2vmin,1rem)]">
            <SideBadge side={rightEntrySide} />
            <TeamLogo
              src={data.right_team_logo_path}
              alt={data.right_team_name}
              size="clamp(8rem, 27vmin, 18rem)"
            />
            <h2 className="w-full truncate text-center text-[clamp(1.25rem,4vmin,3rem)] font-black uppercase tracking-wide text-white">
              {data.right_team_name}
            </h2>
            <SideBadge side={rightEntrySide} />
          </div>
        </div>

        {/* Game timer + Mode */}
        <div className="flex flex-col items-center gap-1">
          <span
            className={`font-mono font-black tracking-tight ${isBreak
              ? "text-[clamp(1.5rem,4vmin,1.875rem)] text-neutral-500"
              : `text-[clamp(3rem,9vmin,4.5rem)] ${style.text}`
              }`}
            style={!isBreak ? { textShadow: "0 0 20px currentColor" } : undefined}
          >
            {formatTime(displayedTimers.gameTimerSec)}
          </span>
          <span className={`text-sm font-black uppercase tracking-[0.4em] ${style.text}`}>
            {getModeLabel(mode)}
          </span>
          {!isBreak && displayedTimers.breakTimerSec > 0 && (
            <span className="mt-1 font-mono text-lg font-bold text-amber-300/40">
              Break: {formatTime(displayedTimers.breakTimerSec)}
            </span>
          )}
        </div>
      </div>

      {/* ── Waiting match (bottom bar) ── */}
      {hasWaiting && (
        <div className="shrink-0 border-t border-neutral-800 bg-neutral-950 px-[clamp(1rem,4vmin,1.5rem)] py-[clamp(0.5rem,1.5vmin,0.75rem)]">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <div className="flex items-center gap-2">
              <WaitingTeamLogo
                src={data.waiting_left_team_logo_path}
                alt={data.waiting_left_team_name}
              />
              <span className="text-sm font-bold text-neutral-400">
                {data.waiting_left_team_name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-black text-neutral-300">
                {data.waiting_left_score}
              </span>
              <span className="text-xs font-bold text-neutral-600">-</span>
              <span className="font-mono text-lg font-black text-neutral-300">
                {data.waiting_right_score}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-400">
                {data.waiting_right_team_name}
              </span>
              <WaitingTeamLogo
                src={data.waiting_right_team_logo_path}
                alt={data.waiting_right_team_name}
              />
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-[0.4em] text-neutral-600">
            En espera
          </p>
        </div>
      )}
    </div>
  )
}
