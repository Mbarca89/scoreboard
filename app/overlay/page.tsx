"use client"

import { DEFAULT_EVENT_ID } from "@/lib/event-config"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ObsScorebar } from "@/components/marcador/obs-scorebar"

function OverlayView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? DEFAULT_EVENT_ID

  return <ObsScorebar eventId={eventId} />
}

export default function OverlayPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-end justify-center bg-transparent p-8 text-xs font-semibold text-white/70">Cargando overlay...</div>}>
      <OverlayView />
    </Suspense>
  )
}
