"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useAudio } from "@/hooks/use-audio"

type TrainingMode = "IDLE" | "READY_COUNTDOWN" | "GAME"

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

const SOCKET_SCRIPT_SRC = "https://cdn.socket.io/4.7.5/socket.io.min.js"
const GAME_TIME_SEC = 5 * 60
const READY_COUNTDOWN_SEC = 11

const BEEP_2_QUICK = { freq: 1800, duration: 0.08, count: 2, silence: 0.05, type: "square" as const, gain: 0.22 }
const BEEP_3_LONG = { freq: 800, duration: 0.18, count: 3, silence: 0.06, type: "square" as const, gain: 0.25 }
const BEEP_BREAK_EACH_SEC = { freq: 1800, duration: 0.08, count: 1, silence: 0, type: "square" as const, gain: 0.22 }
const BEEP_BREAK_ZERO = { freq: 800, duration: 1, count: 1, silence: 0, type: "square" as const, gain: 0.28 }

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function TrainingView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "axl-2026-fecha-2"

  const { prime, playWav, playBeeps, playSequence } = useAudio()

  const [mode, setMode] = useState<TrainingMode>("IDLE")
  const [readyCountdownSec, setReadyCountdownSec] = useState(READY_COUNTDOWN_SEC)
  const [gameSec, setGameSec] = useState(GAME_TIME_SEC)
  const [leftReady, setLeftReady] = useState(false)
  const [rightReady, setRightReady] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [socketError, setSocketError] = useState<string | null>(null)
  const [lastButtonId, setLastButtonId] = useState<number | null>(null)

  const audioOnceRef = useRef<Set<string>>(new Set())
  const emitOnce = useCallback((key: string, fn: () => void) => {
    if (audioOnceRef.current.has(key)) return
    audioOnceRef.current.add(key)
    fn()
    window.setTimeout(() => audioOnceRef.current.delete(key), 2000)
  }, [])

  const resetToIdle = useCallback(() => {
    setMode("IDLE")
    setLeftReady(false)
    setRightReady(false)
    setReadyCountdownSec(READY_COUNTDOWN_SEC)
    setGameSec(GAME_TIME_SEC)
  }, [])

  const onReadyButton = useCallback((side: "left" | "right") => {
    if (mode !== "IDLE") return

    prime()
    emitOnce(`training:ready:${side}`, () => playBeeps(BEEP_2_QUICK))

    const nextLeft = side === "left" ? true : leftReady
    const nextRight = side === "right" ? true : rightReady

    setLeftReady(nextLeft)
    setRightReady(nextRight)

    if (nextLeft && nextRight) {
      setMode("READY_COUNTDOWN")
      setReadyCountdownSec(READY_COUNTDOWN_SEC)
    }
  }, [emitOnce, leftReady, mode, playBeeps, prime, rightReady])

  const finalizePoint = useCallback((action: "base" | "concede") => {
    prime()

    if (action === "base") {
      emitOnce(`training:base:${Date.now()}`, () =>
        playSequence({ preBeeps: BEEP_3_LONG, wav: "base" })
      )
    } else {
      emitOnce(`training:concede:${Date.now()}`, () =>
        playSequence({ preBeeps: BEEP_3_LONG, wav: "concede" })
      )
    }

    window.setTimeout(() => {
      emitOnce(`training:point-approved:${Date.now()}`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
      )
    }, 1100)

    resetToIdle()
  }, [emitOnce, playSequence, prime, resetToIdle])

  const onBaseButton = useCallback((side: "left" | "right") => {
    if (mode === "IDLE") {
      onReadyButton(side)
      return
    }

    if (mode === "GAME") {
      finalizePoint("base")
    }
  }, [finalizePoint, mode, onReadyButton])

  const onPitButton = useCallback(() => {
    if (mode === "GAME") {
      finalizePoint("concede")
    }
  }, [finalizePoint, mode])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (mode === "READY_COUNTDOWN") {
        setReadyCountdownSec((prev) => {
          const next = prev - 1

          if (next === 10) {
            emitOnce("training:10-seconds", () => playWav("10-seconds"))
          }

          if (next <= 9 && next >= 1) {
            emitOnce(`training:countdown:${next}`, () => playBeeps(BEEP_BREAK_EACH_SEC))
          }

          if (next <= 0) {
            emitOnce("training:countdown:zero", () =>
              playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" })
            )
            setMode("GAME")
            return 0
          }

          return next
        })
      }

      if (mode === "GAME") {
        setGameSec((prev) => {
          const next = prev - 1
          if (next <= 0) {
            emitOnce("training:game-time-finished", () => playWav("game-time-finished"))
            resetToIdle()
            return 0
          }
          return next
        })
      }
    }, 1000)

    return () => window.clearInterval(id)
  }, [emitOnce, mode, playBeeps, playSequence, playWav, resetToIdle])

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

      const onButtonEvent = (payload: unknown) => {
        if (!payload || typeof payload !== "object") return

        const maybeButtonId = (payload as { buttonId?: unknown }).buttonId
        if (typeof maybeButtonId !== "number") return

        setLastButtonId(maybeButtonId)

        if (maybeButtonId === 1) onBaseButton("left")
        if (maybeButtonId === 2) onPitButton()
        if (maybeButtonId === 3) onBaseButton("right")
        if (maybeButtonId === 4) onPitButton()
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
      if (socket) socket.disconnect()
    }
  }, [onBaseButton, onPitButton])

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-background p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
        <div>
          <h1 className="text-xl font-bold text-foreground">Modo de entrenamiento</h1>
          <p className="text-xs text-muted-foreground">Evento: {eventId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Socket</span>
          <span className={`h-2.5 w-2.5 rounded-full ${socketConnected ? "bg-emerald-400" : "bg-red-500"}`} />
          <span className="font-mono text-xs text-muted-foreground">{socketConnected ? "online" : "offline"}</span>
          {lastButtonId !== null && <span className="font-mono text-xs text-muted-foreground">btn:{lastButtonId}</span>}
        </div>
      </div>

      {socketError && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {socketError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Equipo izquierdo</p>
          <p className={`mt-2 text-lg font-bold ${leftReady ? "text-emerald-400" : "text-muted-foreground"}`}>{leftReady ? "LISTO" : "NO LISTO"}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Estado</p>
          <p className="mt-2 text-lg font-bold text-foreground">{mode}</p>
          <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">Cuenta regresiva (11s)</p>
          <p className="font-mono text-4xl font-black text-amber-300">{formatTime(readyCountdownSec)}</p>
          <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">Juego (5:00)</p>
          <p className="font-mono text-3xl font-black text-cyan-300">{formatTime(gameSec)}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Equipo derecho</p>
          <p className={`mt-2 text-lg font-bold ${rightReady ? "text-emerald-400" : "text-muted-foreground"}`}>{rightReady ? "LISTO" : "NO LISTO"}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button onClick={() => onBaseButton("left")} className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-card/80">Base izquierda (btn 1)</button>
        <button onClick={() => onBaseButton("right")} className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-card/80">Base derecha (btn 3)</button>
        <button onClick={onPitButton} className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-card/80">Pit izquierdo conceder (btn 2)</button>
        <button onClick={onPitButton} className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-card/80">Pit derecho conceder (btn 4)</button>
      </div>
    </div>
  )
}

export default function TrainingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-foreground">Cargando entrenamiento...</div>}>
      <TrainingView />
    </Suspense>
  )
}
