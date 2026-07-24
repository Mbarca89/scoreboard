"use client"

import { useCallback, useEffect, useState } from "react"
import {
  DEFAULT_BUTTON_BINDINGS,
  type ButtonAction,
  type ButtonBindings,
} from "@/lib/button-bindings"

export function useButtonBindings() {
  const [bindings, setBindings] = useState<ButtonBindings>(DEFAULT_BUTTON_BINDINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/button-bindings", { cache: "no-store" })
      const body = await readJsonResponse(response)
      if (!response.ok) {
        const message = body.detail ? `${body.error}: ${body.detail}` : body.error
        throw new Error(message ?? "No se pudo cargar el emparejamiento")
      }
      setBindings(body.bindings)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de configuración")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
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
    setBindings(body.bindings)
    setError(null)
  }, [])

  return { bindings, loading, error, pair, reload: load }
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
