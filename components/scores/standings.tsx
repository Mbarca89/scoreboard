"use client"

import useSWR from "swr"
import type { Match } from "@/lib/types"
import { buildStandings } from "@/lib/standings"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface StandingsProps {
  eventId: string
}

export function Standings({ eventId }: StandingsProps) {
  const { data: matches } = useSWR<Match[]>(`/api/matches?eventId=${eventId}`, fetcher, {
    refreshInterval: 5000,
  })

  if (!matches) {
    return <p className="text-sm text-muted-foreground">Cargando scores...</p>
  }

  const groups = buildStandings(matches)

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay partidos finalizados con grupo para calcular puntajes.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={`${group.category}-${group.groupId}`} className="rounded-lg border border-border bg-card p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">{group.category}</h2>
            <span className="text-xs font-semibold text-muted-foreground">Grupo {group.groupId}</span>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Equipo</th>
                  <th className="px-2 py-2 text-center">Partidos (pts)</th>
                  <th className="px-2 py-2 text-center">PJ</th>
                  <th className="px-2 py-2 text-center">PG</th>
                  <th className="px-2 py-2 text-center">PE</th>
                  <th className="px-2 py-2 text-center">PP</th>
                  <th className="px-2 py-2 text-center">PF</th>
                  <th className="px-2 py-2 text-center">PC</th>
                  <th className="px-2 py-2 text-center">Dif</th>
                  <th className="px-2 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {group.teams.map((team, idx) => (
                  <tr key={team.teamId} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-2 font-semibold text-foreground">{team.teamName}</td>
                    <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
                      {team.matchPoints.join(" • ") || "-"}
                    </td>
                    <td className="px-2 py-2 text-center font-mono">{team.played}</td>
                    <td className="px-2 py-2 text-center font-mono">{team.won}</td>
                    <td className="px-2 py-2 text-center font-mono">{team.drawn}</td>
                    <td className="px-2 py-2 text-center font-mono">{team.lost}</td>
                    <td className="px-2 py-2 text-center font-mono">{team.goalsFor}</td>
                    <td className="px-2 py-2 text-center font-mono">{team.goalsAgainst}</td>
                    <td className={`px-2 py-2 text-center font-mono ${team.goalDiff >= 0 ? "text-primary" : "text-destructive"}`}>
                      {team.goalDiff > 0 ? `+${team.goalDiff}` : team.goalDiff}
                    </td>
                    <td className="px-2 py-2 text-center font-mono text-base font-bold text-foreground">{team.totalPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
