"use client"

import useSWR from "swr"
import type { FixtureBlock, Match } from "@/lib/types"
import { MatchCard } from "./match-card"

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const STAGE_ORDER = ["GROUP", "SEMI", "FINAL", "BRACKET", "QUARTER"] as const

interface BlockListProps {
  eventId: string
}

export function BlockList({ eventId }: BlockListProps) {
  const { data: blocks } = useSWR<FixtureBlock[]>(
    `/api/blocks?eventId=${eventId}`,
    fetcher,
    { refreshInterval: 5000 }
  )
  const { data: matches } = useSWR<Match[]>(
    `/api/matches?eventId=${eventId}`,
    fetcher,
    { refreshInterval: 5000 }
  )

  if (!blocks || !matches) {
    return <p className="text-sm text-muted-foreground">Cargando...</p>
  }

  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay bloques en este evento.</p>
  }

  const categoryOrder = Array.from(new Set(blocks.map((block) => block.category)))

  return (
    <div className="space-y-5 print:space-y-3">
      {categoryOrder.map((category) => {
        const categoryBlocks = blocks.filter((block) => block.category === category)

        return (
          <section key={category} className="space-y-3 rounded-lg border border-border/60 bg-card/20 p-3 print:break-inside-avoid print:border-slate-300 print:bg-transparent print:p-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-foreground print:text-[11px] print:text-slate-900">
              {category}
            </h2>
            <div className="grid gap-3 print:gap-2 md:grid-cols-2 xl:grid-cols-3">
              {categoryBlocks.map((block) => {
                const blockMatches = matches.filter((m) => m.block_id === block.block_id)
                const isDone = block.status === "DONE"
                const isInProgress = block.status === "IN_PROGRESS"

                return (
                  <div
                    key={block.block_id}
                    className={`rounded-lg border p-3 transition-colors print:break-inside-avoid print:border-slate-300 print:bg-white print:p-2 ${
                      isInProgress
                        ? "border-primary/50 bg-card shadow-[0_0_15px_rgba(100,200,100,0.05)]"
                        : isDone
                          ? "border-border/50 bg-card/50 opacity-70 print:opacity-100"
                          : "border-border bg-card"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary font-mono text-[10px] font-bold text-secondary-foreground print:border print:border-slate-300 print:bg-slate-100 print:text-slate-900">
                          {block.block_order}
                        </span>
                        <div>
                          <span className="text-xs font-semibold text-foreground print:text-slate-900">Bloque {block.block_order}</span>
                          <span className="ml-2 text-[10px] text-muted-foreground print:text-slate-600">
                            {block.stage}{block.group_id ? ` - Grupo ${block.group_id}` : ""}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide print:border print:border-slate-300 print:bg-slate-100 print:text-slate-700 ${
                          isInProgress
                            ? "bg-primary/15 text-primary"
                            : isDone
                              ? "bg-muted text-muted-foreground"
                              : "bg-secondary text-secondary-foreground"
                        }`}
                      >
                        {block.status === "IN_PROGRESS" ? "En juego" : block.status === "DONE" ? "Terminado" : "Programado"}
                      </span>
                    </div>

                    <div className="grid gap-1.5">
                      {blockMatches.map((match) => (
                        <MatchCard key={match.match_id} match={match} compact />
                      ))}
                      {blockMatches.length === 0 && (
                        <p className="text-xs text-muted-foreground print:text-slate-600">Sin partidos asignados</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
