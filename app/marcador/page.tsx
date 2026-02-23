"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Scoreboard } from "@/components/marcador/scoreboard"

function MarcadorView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "evt-001"

  return <Scoreboard eventId={eventId} />
}

export default function MarcadorPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-foreground">Cargando marcador...</div>}>
      <MarcadorView />
    </Suspense>
  )
}
