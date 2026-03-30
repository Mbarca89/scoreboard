"use client"

import { useState } from "react"
import { toast } from "@/hooks/use-toast"

export function DynamoSyncButton({ eventId, blockId }: { eventId: string; blockId: string }) {
  const [loading, setLoading] = useState(false)

  const onSync = async () => {
    if (!blockId) {
      toast({
        variant: "destructive",
        title: "Seleccioná un bloque",
        description: "Para evitar carga innecesaria, la sincronización solo se hace del bloque activo.",
      })
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/sync/dynamo/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, blockId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Error de sincronización")

      toast({
        title: "Sincronización completada",
        description: `Bloque ${blockId} · Matches: ${data.matches} · FixtureBlocks: ${data.fixtureBlocks}`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al sincronizar",
        description: err instanceof Error ? err.message : "Error desconocido",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={onSync}
      disabled={loading || !blockId}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
      type="button"
    >
      {loading ? "Sincronizando..." : "Sync a Dynamo"}
    </button>
  )
}
