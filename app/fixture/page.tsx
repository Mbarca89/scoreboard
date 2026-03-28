"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { BlockList } from "@/components/fixture/block-list"
import { Button } from "@/components/ui/button"

function FixtureView() {
  const searchParams = useSearchParams()
  const eventId = searchParams.get("eventId") ?? "axl-2026-fecha-1"

  return (
    <div className="fixture-print-area min-h-screen bg-background p-4 print:bg-white print:p-3">
      <header className="mb-4 flex items-center justify-between gap-3 print:mb-2 print:block">
        <div>
          <h1 className="text-xl font-bold text-foreground print:text-base print:text-slate-900">Fixture</h1>
          <p className="text-xs text-muted-foreground print:text-[10px] print:text-slate-600">
            Todos los bloques y partidos del evento
          </p>
        </div>
        <Button
          type="button"
          variant="default"
          className="print:hidden"
          onClick={() => window.print()}
        >
          Descargar PDF
        </Button>
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
