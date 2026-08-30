"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type Team = {
  teamId: string
  teamName: string
  category: string | null
  finalRank: number | null
}

type ApiResponse = {
  eventId: string
  teams: Team[]
  nonScoringCategories: string[]
  message?: string
}

const CATEGORY_ORDER = ["5v5 D3/D4", "3v3 D4/D5", "3v3 D6", "3v3 Open"]

export function FinalRanksManager({ eventId }: { eventId: string }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [nonScoringCategories, setNonScoringCategories] = useState<string[]>([])
  const [ranks, setRanks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/final-ranks?eventId=${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as ApiResponse
      if (!response.ok) throw new Error(data.message || "No se pudieron cargar los equipos")

      setTeams(data.teams)
      setNonScoringCategories(data.nonScoringCategories || [])
      setRanks(
        Object.fromEntries(
          data.teams.map((team) => [team.teamId, team.finalRank?.toString() || ""])
        )
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los equipos")
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  const teamsByCategory = useMemo(() => {
    const groups = new Map<string, Team[]>()
    for (const team of teams) {
      const category = team.category || "Sin categoría"
      if (!groups.has(category)) groups.set(category, [])
      groups.get(category)!.push(team)
    }
    return [...groups.entries()].sort(([a], [b]) => {
      const aIndex = CATEGORY_ORDER.indexOf(a)
      const bIndex = CATEGORY_ORDER.indexOf(b)
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
  }, [teams])

  function validate() {
    const nonScoring = new Set(nonScoringCategories)
    for (const [category, categoryTeams] of teamsByCategory) {
      if (nonScoring.has(category)) continue
      const values = categoryTeams.map((team) => Number(ranks[team.teamId]))
      if (values.some((rank) => !Number.isInteger(rank) || rank < 1)) {
        return `Completá todas las posiciones de ${category} con números enteros`
      }
      const sorted = [...values].sort((a, b) => a - b)
      if (sorted.some((rank, index) => rank !== index + 1)) {
        return `Las posiciones de ${category} deben ir del 1 al ${categoryTeams.length}, sin repetir`
      }
    }
    return null
  }

  async function save() {
    const validationError = validate()
    setMessage(null)
    setError(validationError)
    if (validationError) return

    setSaving(true)
    try {
      const nonScoring = new Set(nonScoringCategories)
      const rankings = teams
        .filter((team) => !nonScoring.has(team.category || ""))
        .map((team) => ({
          teamId: team.teamId,
          category: team.category,
          finalRank: Number(ranks[team.teamId]),
        }))

      const response = await fetch("/api/final-ranks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, rankings }),
      })
      const data = (await response.json()) as { message?: string; updated?: number }
      if (!response.ok) throw new Error(data.message || "No se pudieron guardar las posiciones")

      setMessage(`Posiciones guardadas correctamente (${data.updated} equipos)`)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudieron guardar las posiciones")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando equipos...</p>

  return (
    <div className="space-y-5">
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {message && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}

      {teamsByCategory.map(([category, categoryTeams]) => {
        const nonScoring = nonScoringCategories.includes(category)
        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle>{category}</CardTitle>
              <CardDescription>
                {nonScoring
                  ? `${categoryTeams.length} equipos · no suma puntos de temporada`
                  : `${categoryTeams.length} equipos · usá una vez cada posición del 1 al ${categoryTeams.length}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {categoryTeams.map((team) => (
                <div key={team.teamId} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-4 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{team.teamName}</p>
                    <p className="truncate text-xs text-muted-foreground">{team.teamId}</p>
                  </div>
                  {nonScoring ? (
                    <span className="text-right text-xs text-muted-foreground">Sin posición</span>
                  ) : (
                    <Input
                      type="number"
                      min={1}
                      max={categoryTeams.length}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Posición final de ${team.teamName}`}
                      placeholder="Posición"
                      value={ranks[team.teamId] || ""}
                      onChange={(event) => {
                        setRanks((current) => ({ ...current, [team.teamId]: event.target.value }))
                        setError(null)
                        setMessage(null)
                      }}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}

      {!teams.length && !error && <p className="text-sm text-muted-foreground">No hay equipos inscriptos en este evento.</p>}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving || !teams.length}>
          {saving ? "Guardando..." : "Guardar posiciones finales"}
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={saving}>
          Recargar
        </Button>
      </div>
    </div>
  )
}
