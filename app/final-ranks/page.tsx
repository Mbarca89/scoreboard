"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { FinalRanksManager } from "@/components/scores/final-ranks-manager"

function FinalRanksView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "axl-2026-fecha-2"

  return (
    <main className="min-h-screen bg-background p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Posiciones finales</h1>
        <p className="text-sm text-muted-foreground">
          Evento {eventId}. Completá la posición de todos los equipos antes de cerrar el evento.
        </p>
      </header>
      <FinalRanksManager eventId={eventId} />
    </main>
  )
}

export default function FinalRanksPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Cargando...</div>}>
      <FinalRanksView />
    </Suspense>
  )
}
