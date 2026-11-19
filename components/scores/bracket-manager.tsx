"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import type { AXLCategory, Match } from "@/lib/types"
import { toast } from "@/hooks/use-toast"

const CATEGORIES: AXLCategory[] = ["5v5 D3/D4", "3v3 D4/D5", "3v3 D6", "3v3 Open"]
const fetcher = (url: string) => fetch(url).then((response) => response.json())
type Stage = "SEMI" | "FINAL"
interface TeamOption { id: string; name: string; logoKey: string | null }
interface MatchForm { category: AXLCategory; left: string; right: string; bye: boolean }

function TeamSelect({ value, onChange, teams, disabled }: {
  value: string; onChange: (value: string) => void; teams: TeamOption[]; disabled?: boolean
}) {
  return (
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs">
      <option value="">Seleccionar equipo</option>
      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
    </select>
  )
}

function MatchEditor({ slot, value, teams, onChange }: {
  slot: "A" | "B"; value: MatchForm; teams: TeamOption[]; onChange: (next: MatchForm) => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <p className="text-xs font-semibold">Partido {slot}</p>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Categoría</span>
        <select
          value={value.category}
          onChange={(event) => onChange({ ...value, category: event.target.value as AXLCategory, left: "", right: "", bye: false })}
          className="w-full rounded-md border border-border bg-background px-2 py-1"
        >
          {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <TeamSelect value={value.left} onChange={(left) => onChange({ ...value, left })} teams={teams} />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value.bye}
          onChange={(event) => onChange({ ...value, bye: event.target.checked, right: event.target.checked ? "BYE" : "" })}
        />
        BYE (partido terminado automáticamente)
      </label>
      <TeamSelect value={value.right} disabled={value.bye} onChange={(right) => onChange({ ...value, right })} teams={teams} />
      {value.bye && <p className="text-[11px] text-muted-foreground">Avanza automáticamente el equipo seleccionado.</p>}
    </div>
  )
}

export function BracketManager({ eventId }: { eventId: string }) {
  const { data: matches, mutate } = useSWR<Match[]>(`/api/matches?eventId=${eventId}`, fetcher)
  const [stage, setStage] = useState<Stage>("SEMI")
  const [includeMatchB, setIncludeMatchB] = useState(true)
  const [loading, setLoading] = useState(false)
  const [matchA, setMatchA] = useState<MatchForm>({ category: "5v5 D3/D4", left: "", right: "", bye: false })
  const [matchB, setMatchB] = useState<MatchForm>({ category: "5v5 D3/D4", left: "", right: "", bye: false })

  const teamsByCategory = useMemo(() => {
    const maps = new Map<AXLCategory, Map<string, TeamOption>>(CATEGORIES.map((category) => [category, new Map()]))
    for (const match of matches || []) {
      const categoryTeams = maps.get(match.category)
      if (!categoryTeams) continue
      categoryTeams.set(match.left_team_id, { id: match.left_team_id, name: match.left_team_name, logoKey: match.left_team_logo_path })
      if (match.right_team_id !== "BYE") {
        categoryTeams.set(match.right_team_id, { id: match.right_team_id, name: match.right_team_name, logoKey: match.right_team_logo_path })
      }
    }
    return new Map(CATEGORIES.map((category) => [
      category,
      [...(maps.get(category)?.values() || [])].sort((a, b) => a.name.localeCompare(b.name)),
    ]))
  }, [matches])

  function toPayload(form: MatchForm) {
    const byId = new Map((teamsByCategory.get(form.category) || []).map((team) => [team.id, team]))
    const left = byId.get(form.left)
    const right = byId.get(form.right)
    return {
      category: form.category,
      leftTeamId: form.left,
      leftTeamName: left?.name,
      leftTeamLogoKey: left?.logoKey,
      rightTeamId: form.bye ? "BYE" : form.right,
      rightTeamName: form.bye ? "BYE" : right?.name,
      rightTeamLogoKey: form.bye ? null : right?.logoKey,
      isBye: form.bye,
    }
  }

  async function saveBracket() {
    setLoading(true)
    try {
      const payloadMatches = [toPayload(matchA)]
      if (includeMatchB) payloadMatches.push(toPayload(matchB))
      const response = await fetch("/api/bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, stage, matches: payloadMatches }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Error guardando bloque")
      toast({ title: `Bloque ${stage} creado`, description: `${includeMatchB ? "2 partidos" : "1 partido"} · ID: ${data.blockId}` })
      await mutate()
    } catch (error) {
      toast({ variant: "destructive", title: "No se pudo crear el bloque", description: error instanceof Error ? error.message : "Error desconocido" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-bold">Administrador de cruces (SEMI / FINAL)</h2>
        <p className="text-xs text-muted-foreground">Cada partido puede pertenecer a una categoría diferente.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <select value={stage} onChange={(event) => setStage(event.target.value as Stage)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
          <option value="SEMI">SEMI</option>
          <option value="FINAL">FINAL</option>
        </select>
        <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1 text-xs">
          <input type="checkbox" checked={includeMatchB} onChange={(event) => setIncludeMatchB(event.target.checked)} />
          Incluir partido B
        </label>
        <button disabled={loading} onClick={saveBracket} className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {loading ? "Guardando..." : `Guardar bloque ${stage}`}
        </button>
      </div>
      <div className={includeMatchB ? "grid gap-3 lg:grid-cols-2" : "grid gap-3"}>
        <MatchEditor slot="A" value={matchA} teams={teamsByCategory.get(matchA.category) || []} onChange={setMatchA} />
        {includeMatchB && <MatchEditor slot="B" value={matchB} teams={teamsByCategory.get(matchB.category) || []} onChange={setMatchB} />}
      </div>
    </section>
  )
}
