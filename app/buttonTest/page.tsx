"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Radio, RotateCcw, Save, SquareArrowDown, X } from "lucide-react"
import { useAudio } from "@/hooks/use-audio"
import { useButtonBindings } from "@/hooks/use-button-bindings"
import {
  actionForButtonId,
  BUTTON_ACTION_LABELS,
  BUTTON_ACTIONS,
  type ButtonAction,
} from "@/lib/button-bindings"

const SOCKET_SCRIPT_SRC = "https://cdn.socket.io/4.7.5/socket.io.min.js"

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

type TestState = Record<ButtonAction, boolean>

const EMPTY_TEST_STATE: TestState = {
  BASE_LEFT: false,
  PIT_LEFT: false,
  BASE_RIGHT: false,
  PIT_RIGHT: false,
}

export default function ButtonTestPage() {
  const { playWav } = useAudio()
  const { bindings, loading, error: loadError, pair, reload } = useButtonBindings()
  const [socketConnected, setSocketConnected] = useState(false)
  const [socketError, setSocketError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastButtonId, setLastButtonId] = useState<number | null>(null)
  const [pairingAction, setPairingAction] = useState<ButtonAction | null>(null)
  const [detectedButtonId, setDetectedButtonId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [testState, setTestState] = useState<TestState>(EMPTY_TEST_STATE)
  const pairingActionRef = useRef<ButtonAction | null>(null)
  const detectedButtonIdRef = useRef<number | null>(null)
  const lastSocketEventRef = useRef<{ buttonId: number; ts: number } | null>(null)

  useEffect(() => {
    pairingActionRef.current = pairingAction
  }, [pairingAction])

  const startPairing = (action: ButtonAction) => {
    pairingActionRef.current = action
    detectedButtonIdRef.current = null
    setPairingAction(action)
    setDetectedButtonId(null)
    setSaveError(null)
  }

  const cancelPairing = () => {
    pairingActionRef.current = null
    detectedButtonIdRef.current = null
    setPairingAction(null)
    setDetectedButtonId(null)
    setSaveError(null)
  }

  const confirmPairing = async () => {
    if (!pairingAction || detectedButtonId === null) return
    setSaving(true)
    setSaveError(null)
    try {
      await pair(pairingAction, detectedButtonId)
      pairingActionRef.current = null
      detectedButtonIdRef.current = null
      setPairingAction(null)
      setDetectedButtonId(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "No se pudo guardar")
    } finally {
      setSaving(false)
    }
  }

  const activateTest = useCallback((action: ButtonAction) => {
    setTestState((previous) => ({ ...previous, [action]: true }))
    window.setTimeout(() => {
      setTestState((previous) => ({ ...previous, [action]: false }))
    }, 350)

    playWav(action.startsWith("BASE") ? "base" : "concede")
  }, [playWav])

  useEffect(() => {
    let socket: SocketConnection | null = null
    let isMounted = true

    const connectSocket = () => {
      if (!isMounted || !window.io) return

      socket = window.io(
        process.env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin,
        { transports: ["polling", "websocket"], upgrade: true }
      )

      socket.on("connect", () => {
        if (!isMounted) return
        setSocketConnected(true)
        setSocketError(null)
      })
      socket.on("disconnect", () => {
        if (isMounted) setSocketConnected(false)
      })
      socket.on("connect_error", (cause: unknown) => {
        if (!isMounted) return
        setSocketError(cause instanceof Error ? cause.message : "Error de conexión")
      })

      const onButtonEvent = (payload: unknown) => {
        if (!payload || typeof payload !== "object") return
        const buttonId = (payload as { buttonId?: unknown }).buttonId
        if (typeof buttonId !== "number") return

        const now = Date.now()
        const last = lastSocketEventRef.current
        if (last && last.buttonId === buttonId && now - last.ts < 250) return
        lastSocketEventRef.current = { buttonId, ts: now }
        setLastButtonId(buttonId)

        if (pairingActionRef.current) {
          if (detectedButtonIdRef.current !== null) return
          detectedButtonIdRef.current = buttonId
          setDetectedButtonId(buttonId)
          return
        }

        if (loading) return
        const action = actionForButtonId(bindings, buttonId)
        if (action) activateTest(action)
      }

      socket.on("button_press", onButtonEvent)
      socket.on("button", onButtonEvent)
    }

    if (window.io) {
      connectSocket()
    } else {
      const script = document.createElement("script")
      script.src = SOCKET_SCRIPT_SRC
      script.async = true
      script.onload = connectSocket
      document.body.appendChild(script)
    }

    return () => {
      isMounted = false
      socket?.disconnect()
    }
  }, [activateTest, bindings, loading])

  const sideClass = (action: ButtonAction) =>
    testState[action] ? "text-emerald-400 scale-110" : "text-muted-foreground"
  const conflictingAction =
    detectedButtonId === null ? null : actionForButtonId(bindings, detectedButtonId)
  const hasConflict =
    conflictingAction !== null &&
    pairingAction !== null &&
    bindings[pairingAction] !== detectedButtonId

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-3">
          <div>
            <h1 className="text-xl font-bold">Emparejamiento y prueba de botones</h1>
            <p className="text-xs text-muted-foreground">Configuración global del hardware físico</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${socketConnected ? "bg-emerald-400" : "bg-red-500"}`} />
            <span className="font-mono text-xs text-muted-foreground">
              socket {socketConnected ? "online" : "offline"}
            </span>
            {lastButtonId !== null && (
              <span className="rounded bg-muted px-2 py-1 font-mono text-xs">último: {lastButtonId}</span>
            )}
          </div>
        </header>

        {(loadError || socketError || saveError) && (
          <div className="flex items-center justify-between rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{saveError ?? loadError ?? socketError}</span>
            {loadError && (
              <button className="flex items-center gap-1" onClick={() => void reload()}>
                <RotateCcw className="h-4 w-4" /> Reintentar
              </button>
            )}
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-2">
          {BUTTON_ACTIONS.map((action) => (
            <div
              key={action}
              className={`rounded-lg border bg-card p-4 ${
                pairingAction === action ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{BUTTON_ACTION_LABELS[action]}</p>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    {loading ? "Cargando…" : `ID ${bindings[action]}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => startPairing(action)}
                  className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Radio className="h-4 w-4" />
                  Emparejar
                </button>
              </div>
            </div>
          ))}
        </section>

        {pairingAction && (
          <section className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-5">
            <p className="font-semibold">Emparejando: {BUTTON_ACTION_LABELS[pairingAction]}</p>
            {detectedButtonId === null ? (
              <p className="mt-2 animate-pulse text-sm text-muted-foreground">
                Presioná ahora el botón físico que querés asignar…
              </p>
            ) : (
              <div className="mt-3">
                <p className="text-sm">Se detectó el botón ID <strong>{detectedButtonId}</strong>.</p>
                {hasConflict && (
                  <p className="mt-1 text-sm text-destructive">
                    Ese ID ya está asignado a {BUTTON_ACTION_LABELS[conflictingAction!]}.
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={detectedButtonId === null || saving || hasConflict}
                onClick={() => void confirmPairing()}
                className="flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                <Save className="h-4 w-4" /> {saving ? "Guardando…" : "Confirmar"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={cancelPairing}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <X className="h-4 w-4" /> Cancelar
              </button>
            </div>
          </section>
        )}

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold">Prueba en vivo</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Fuera del modo de emparejamiento, cada botón configurado ilumina su función.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
            {BUTTON_ACTIONS.map((action) => (
              <div key={action} className="flex flex-col items-center gap-2 text-center">
                <SquareArrowDown className={`h-16 w-16 transition-all ${sideClass(action)}`} />
                <span className="text-sm font-semibold">{BUTTON_ACTION_LABELS[action]}</span>
                <span className="font-mono text-xs text-muted-foreground">ID {bindings[action]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
