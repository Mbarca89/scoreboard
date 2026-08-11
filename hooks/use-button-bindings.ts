"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  actionForButtonId,
  EMPTY_BUTTON_BINDINGS,
  type ButtonAction,
  type ButtonBindings,
} from "@/lib/button-bindings"

const BINDINGS_CHANNEL = "scoreboard-button-bindings"

export function useButtonBindings() {
  const [bindings, setBindings] = useState<ButtonBindings>(EMPTY_BUTTON_BINDINGS)
  const bindingsRef = useRef<ButtonBindings>(EMPTY_BUTTON_BINDINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const applyBindings = useCallback((nextBindings: ButtonBindings) => {
    bindingsRef.current = nextBindings
    setBindings(nextBindings)
  }, [])

  const fetchBindings = useCallback(async () => {
    const response = await fetch("/api/button-bindings", { cache: "no-store" })
    const body = await readJsonResponse(response)
    if (!response.ok) {
      const message = body.detail ? `${body.error}: ${body.detail}` : body.error
      throw new Error(message ?? "No se pudo cargar el emparejamiento")
    }
    return body.bindings as ButtonBindings
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      applyBindings(await fetchBindings())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de configuración")
    } finally {
      setLoading(false)
    }
  }, [applyBindings, fetchBindings])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const channel = new BroadcastChannel(BINDINGS_CHANNEL)
    const refresh = () => void load()

    channel.addEventListener("message", refresh)
    window.addEventListener("focus", refresh)

    return () => {
      channel.removeEventListener("message", refresh)
      channel.close()
      window.removeEventListener("focus", refresh)
    }
  }, [load])

  const pair = useCallback(async (action: ButtonAction, buttonId: number) => {
    const response = await fetch("/api/button-bindings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, buttonId }),
    })
    const body = await readJsonResponse(response)
    if (!response.ok) {
      const message = body.detail ? `${body.error}: ${body.detail}` : body.error
      throw new Error(message ?? "No se pudo guardar el emparejamiento")
    }
    applyBindings(body.bindings)
    setError(null)
    const channel = new BroadcastChannel(BINDINGS_CHANNEL)
    channel.postMessage("changed")
    channel.close()
  }, [applyBindings])

  // A physical press is always resolved against the persisted configuration.
  // This prevents an already-open screen from acting on a stale/default mapping.
  const resolveAction = useCallback(async (buttonId: number) => {
    try {
      const latestBindings = await fetchBindings()
      applyBindings(latestBindings)
      setError(null)
      return actionForButtonId(latestBindings, buttonId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de configuración")
      return null
    }
  }, [applyBindings, fetchBindings])

  return { bindings, loading, error, pair, reload: load, resolveAction }
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) {
    throw new Error(`El servidor respondió ${response.status} sin contenido`)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`El servidor respondió ${response.status} con una respuesta inválida`)
  }
}
