"use client"

import { useState } from "react"
import { toast } from "@/hooks/use-toast"

export function DynamoSyncButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false)

  const onSync = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/sync/dynamo/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Error de sincronización")

      toast({
        title: "Sincronización completada",
        description: `Matches: ${data.matches} · FixtureBlocks: ${data.fixtureBlocks}`,
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
      disabled={loading}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
      type="button"
    >
      {loading ? "Sincronizando..." : "Sync a Dynamo"}
    </button>
  )
}
