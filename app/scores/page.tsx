"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Standings } from "@/components/scores/standings"
import { BracketManager } from "@/components/scores/bracket-manager"

function ScoresView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "axl-2026-fecha-2"

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Scores</h1>
        <p className="text-xs text-muted-foreground">
          Puntajes por categoría y grupo (Ganado = 5, Empate = 1, Perdido = 0)
        </p>
      </header>
      <Standings eventId={eventId} />
      <BracketManager eventId={eventId} />
    </div>
  )
}

export default function ScoresPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-foreground">Cargando scores...</div>}>
      <ScoresView />
    </Suspense>
  )
}
