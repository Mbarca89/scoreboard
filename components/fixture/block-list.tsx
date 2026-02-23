"use client"

import useSWR from "swr"
import type { FixtureBlock, Match } from "@/lib/types"
import { MatchCard } from "./match-card"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

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

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => {
        const blockMatches = matches.filter((m) => m.block_id === block.block_id)
        const isDone = block.status === "DONE"
        const isInProgress = block.status === "IN_PROGRESS"

        return (
          <div
            key={block.block_id}
            className={`rounded-lg border p-4 transition-colors ${
              isInProgress
                ? "border-primary/50 bg-card shadow-[0_0_15px_rgba(100,200,100,0.05)]"
                : isDone
                  ? "border-border/50 bg-card/50 opacity-70"
                  : "border-border bg-card"
            }`}
          >
            {/* Block header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary font-mono text-xs font-bold text-secondary-foreground">
                  {block.block_order}
                </span>
                <div>
                  <span className="text-sm font-semibold text-foreground">{block.category}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {block.stage}{block.group_id ? ` - Grupo ${block.group_id}` : ""}
                  </span>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
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

            {/* Matches */}
            <div className="grid gap-2 sm:grid-cols-2">
              {blockMatches.map((match) => (
                <MatchCard key={match.match_id} match={match} />
              ))}
              {blockMatches.length === 0 && (
                <p className="text-xs text-muted-foreground">Sin partidos asignados</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
