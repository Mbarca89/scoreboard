"use client"

import { useState } from "react"
import { toast } from "@/hooks/use-toast"
import type { FixtureBlock, Match } from "@/lib/types"

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
      const [matchesRes, blocksRes] = await Promise.all([
        fetch(`/api/matches?eventId=${encodeURIComponent(eventId)}&blockId=${encodeURIComponent(blockId)}`),
        fetch(`/api/blocks?eventId=${encodeURIComponent(eventId)}`),
      ])
      if (!matchesRes.ok) throw new Error("No se pudieron obtener los matches locales")
      if (!blocksRes.ok) throw new Error("No se pudieron obtener los bloques locales")

      const matches = await matchesRes.json() as Match[]
      const allBlocks = await blocksRes.json() as FixtureBlock[]
      const fixtureBlocks = allBlocks.filter((b) => b.block_id === blockId)

      const res = await fetch("/api/sync/dynamo/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, blockId, matches, fixtureBlocks }),
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
