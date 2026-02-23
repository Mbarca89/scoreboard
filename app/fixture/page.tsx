"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { BlockList } from "@/components/fixture/block-list"

function FixtureView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "evt-001"

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Fixture</h1>
          <p className="text-xs text-muted-foreground">Todos los bloques y partidos del evento</p>
        </div>
      </header>
      <BlockList eventId={eventId} />
    </div>
  )
}

export default function FixturePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-foreground">Cargando fixture...</div>}>
      <FixtureView />
    </Suspense>
  )
}
