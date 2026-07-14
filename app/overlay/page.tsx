"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ObsScorebar } from "@/components/marcador/obs-scorebar"

function OverlayView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "axl-2026-fecha-2"

  return <ObsScorebar eventId={eventId} />
}

export default function OverlayPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-end justify-center bg-transparent p-8 text-xs font-semibold text-white/70">Cargando overlay...</div>}>
      <OverlayView />
    </Suspense>
  )
}
