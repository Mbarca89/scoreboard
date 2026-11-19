"use client"

import { DEFAULT_EVENT_ID } from "@/lib/event-config"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Scoreboard } from "@/components/marcador/scoreboard"

function MarcadorView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? DEFAULT_EVENT_ID

  return <Scoreboard eventId={eventId} />
}

export default function MarcadorPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background text-foreground">Cargando marcador...</div>}>
      <MarcadorView />
    </Suspense>
  )
}
