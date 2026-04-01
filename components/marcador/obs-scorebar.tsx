"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import type { MatchLiveState, TimerMode } from "@/lib/types"
import { Shield } from "lucide-react"

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function getClockLabel(mode: TimerMode): string {
  switch (mode) {
    case "BREAK":
      return "BREAK"
    case "GAME":
      return "EN JUEGO"
    case "PAUSED":
      return "PAUSA"
    default:
      return "ESPERA"
  }
}

function TeamLogo({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [error, setError] = useState(false)

  if (!src || error) {
    return (
      <div className="flex h-13 w-13 items-center justify-center rounded-full border border-white/20 bg-white/8 backdrop-blur-sm">
        <Shield className="h-6 w-6 text-white/50" />
      </div>
    )
  }

  return (
    <div className="relative h-13 w-13 overflow-hidden rounded-full border border-white/20 bg-black/30">
      <Image src={src} alt={alt} fill className="object-contain p-1" onError={() => setError(true)} unoptimized />
    </div>
  )
}

export function ObsScorebar({ eventId }: { eventId: string }) {
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
        // silent on broadcast view
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
    const previous = document.body.style.background
    document.body.style.background = "transparent"

    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => {
      window.clearInterval(id)
      document.body.style.background = previous
    }
  }, [])

  const clock = useMemo(() => {
    if (!data) return { mode: "IDLE" as TimerMode, value: "00:00" }

    const updatedAtMs = Date.parse(data.updated_at)
    const elapsed = Number.isNaN(updatedAtMs) ? 0 : Math.max(0, Math.floor((now - updatedAtMs) / 1000))

    const gameSeconds = data.timer_running && data.timer_mode === "GAME"
      ? Math.max(0, data.game_timer_sec - elapsed)
      : data.game_timer_sec

    const breakSeconds = data.timer_running && data.timer_mode === "BREAK"
      ? Math.max(0, data.break_timer_sec - elapsed)
      : data.break_timer_sec

    if (data.timer_mode === "BREAK") {
      return { mode: data.timer_mode, value: formatTime(breakSeconds) }
    }

    return { mode: data.timer_mode, value: formatTime(gameSeconds) }
  }, [data, now])

  if (!data || !data.active_match_id) {
    return (
      <div className="flex h-screen w-screen items-end justify-center bg-transparent p-8">
        <div className="rounded-2xl border border-white/15 bg-black/50 px-6 py-3 text-sm font-semibold tracking-wider text-white/75 backdrop-blur-md">
          ESPERANDO INICIO DEL PARTIDO
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen items-end bg-transparent p-6 md:p-8">
      <div className="flex items-center justify-center z-1 absolute right-0 top-0 px-6 py-6">
        <Image src="/images/axl-logo.png" alt="AXL" width={80} height={80} className="h-30 w-30 object-contain" unoptimized />
      </div>
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-2xl border border-white/15 bg-gradient-to-r from-sky-950/85 via-black/80 to-sky-950/85 px-5 py-3 text-white shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-lg">
        <div className="flex min-w-0 items-center gap-3">
          <TeamLogo src={data.left_team_logo_path} alt={data.left_team_name} />
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold uppercase tracking-wide">{data.left_team_name}</p>
            <p className="font-mono text-2xl font-black text-cyan-300">{data.left_score}</p>
          </div>
        </div>

        <div className="min-w-[132px] text-center absolute left-50 right-50 z-2">
          <p className="font-mono text-3xl font-black tracking-wider text-amber-300">{clock.value}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/75">{getClockLabel(clock.mode)}</p>
        </div>


        <div className="min-w-[50px] text-center font-mono text-3xl font-black text-white/60"></div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          <div className="min-w-0 text-right">
            <p className="truncate text-xl font-extrabold uppercase tracking-wide">{data.right_team_name}</p>
            <p className="font-mono text-2xl font-black text-cyan-300">{data.right_score}</p>
          </div>
          <TeamLogo src={data.right_team_logo_path} alt={data.right_team_name} />
        </div>
      </div>
    </div>
  )
}
