"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import type { AXLCategory, Match } from "@/lib/types"

const CATEGORIES: AXLCategory[] = ["5v5 D3/D4", "3v3 D4/D5", "3v3 D6"]
const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Stage = "SEMI" | "FINAL"

interface TeamOption {
  id: string
  name: string
  logoKey: string | null
}

function TeamSelect({ value, onChange, teams, disabled }: { value: string; onChange: (val: string) => void; teams: TeamOption[]; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
    >
      <option value="">Seleccionar equipo</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  )
}

export function BracketManager({ eventId }: { eventId: string }) {
  const { data: matches, mutate } = useSWR<Match[]>(`/api/matches?eventId=${eventId}`, fetcher)

  const [category, setCategory] = useState<AXLCategory>("5v5 D3/D4")
  const [stage, setStage] = useState<Stage>("SEMI")
  const [syncToken, setSyncToken] = useState("")
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    aLeft: "",
    aRight: "",
    aBye: false,
    bLeft: "",
    bRight: "",
    bBye: false,
  })

  const teams = useMemo(() => {
    if (!matches) return []
    const map = new Map<string, TeamOption>()
    for (const m of matches) {
      if (m.category !== category) continue
      map.set(m.left_team_id, { id: m.left_team_id, name: m.left_team_name, logoKey: m.left_team_logo_path })
      if (m.right_team_id !== "BYE") {
        map.set(m.right_team_id, { id: m.right_team_id, name: m.right_team_name, logoKey: m.right_team_logo_path })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [matches, category])

  const byId = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams])

  const saveBracket = async () => {
    setLoading(true)
    try {
      const payload = {
        eventId,
        category,
        stage,
        matches: [
          {
            leftTeamId: form.aLeft,
            leftTeamName: byId[form.aLeft]?.name,
            leftTeamLogoKey: byId[form.aLeft]?.logoKey,
            rightTeamId: form.aBye ? undefined : form.aRight,
            rightTeamName: form.aBye ? undefined : byId[form.aRight]?.name,
            rightTeamLogoKey: form.aBye ? undefined : byId[form.aRight]?.logoKey,
            isBye: form.aBye,
          },
          {
            leftTeamId: form.bLeft,
            leftTeamName: byId[form.bLeft]?.name,
            leftTeamLogoKey: byId[form.bLeft]?.logoKey,
            rightTeamId: form.bBye ? undefined : form.bRight,
            rightTeamName: form.bBye ? undefined : byId[form.bRight]?.name,
            rightTeamLogoKey: form.bBye ? undefined : byId[form.bRight]?.logoKey,
            isBye: form.bBye,
          },
        ],
      }

      const res = await fetch("/api/bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Error guardando bloque")
      alert(`Bloque ${stage} creado: ${data.blockId}`)
      await mutate()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error")
    } finally {
      setLoading(false)
    }
  }

  const syncToDynamo = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/sync/dynamo/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, syncToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Error de sincronización")
      alert(`Sync OK. Matches: ${data.matches}, FixtureBlocks: ${data.fixtureBlocks}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-bold">Administrador de cruces (SEMI / FINAL)</h2>

      <div className="grid gap-2 md:grid-cols-3">
        <select value={category} onChange={(e) => setCategory(e.target.value as AXLCategory)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
          {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
          <option value="SEMI">SEMI</option>
          <option value="FINAL">FINAL</option>
        </select>
        <button disabled={loading} onClick={saveBracket} className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          Guardar bloque {stage}
        </button>
      </div>

      {["A", "B"].map((slot) => {
        const isA = slot === "A"
        const bye = isA ? form.aBye : form.bBye
        const left = isA ? form.aLeft : form.bLeft
        const right = isA ? form.aRight : form.bRight
        return (
          <div key={slot} className="rounded-md border border-border/70 p-2 space-y-2">
            <p className="text-xs font-semibold">Partido {slot}</p>
            <TeamSelect value={left} onChange={(val) => setForm((f) => ({ ...f, [isA ? "aLeft" : "bLeft"]: val }))} teams={teams} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={bye} onChange={(e) => setForm((f) => ({ ...f, [isA ? "aBye" : "bBye"]: e.target.checked }))} />
              BYE (partido terminado automáticamente)
            </label>
            <TeamSelect value={right} disabled={bye} onChange={(val) => setForm((f) => ({ ...f, [isA ? "aRight" : "bRight"]: val }))} teams={teams} />
          </div>
        )
      })}

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          type="password"
          placeholder="Sync token"
          value={syncToken}
          onChange={(e) => setSyncToken(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
        <button disabled={loading || !syncToken} onClick={syncToDynamo} className="rounded-md border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50">
          Sync completo a Dynamo
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">Este botón envía toda la data local del evento (matches + fixture_blocks) a tu Lambda de sincronización.</p>
    </section>
  )
}
