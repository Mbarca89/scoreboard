"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import type { AXLCategory, Match } from "@/lib/types"
import { toast } from "@/hooks/use-toast"

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
    if (!matches) return [{ id: "BYE", name: "BYE", logoKey: null }]

    const map = new Map<string, TeamOption>()
    for (const m of matches) {
      if (m.category !== category) continue
      map.set(m.left_team_id, { id: m.left_team_id, name: m.left_team_name, logoKey: m.left_team_logo_path })
      map.set(m.right_team_id, { id: m.right_team_id, name: m.right_team_name, logoKey: m.right_team_logo_path })
    }

    map.set("BYE", { id: "BYE", name: "BYE", logoKey: null })
    return Array.from(map.values()).sort((a, b) => (a.id === "BYE" ? 1 : b.id === "BYE" ? -1 : a.name.localeCompare(b.name)))
  }, [matches, category])

  const byId = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams])

  const saveBracket = async () => {
    setLoading(true)
    try {
      const aBye = form.aBye || form.aRight === "BYE"
      const bBye = form.bBye || form.bRight === "BYE"

      const payload = {
        eventId,
        category,
        stage,
        matches: [
          {
            leftTeamId: form.aLeft,
            leftTeamName: byId[form.aLeft]?.name,
            leftTeamLogoKey: byId[form.aLeft]?.logoKey,
            rightTeamId: aBye ? "BYE" : form.aRight,
            rightTeamName: aBye ? "BYE" : byId[form.aRight]?.name,
            rightTeamLogoKey: aBye ? null : byId[form.aRight]?.logoKey,
            isBye: aBye,
          },
          {
            leftTeamId: form.bLeft,
            leftTeamName: byId[form.bLeft]?.name,
            leftTeamLogoKey: byId[form.bLeft]?.logoKey,
            rightTeamId: bBye ? "BYE" : form.bRight,
            rightTeamName: bBye ? "BYE" : byId[form.bRight]?.name,
            rightTeamLogoKey: bBye ? null : byId[form.bRight]?.logoKey,
            isBye: bBye,
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

      toast({
        title: `Bloque ${stage} creado`,
        description: `ID: ${data.blockId}`,
      })
      await mutate()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el bloque",
        description: err instanceof Error ? err.message : "Error desconocido",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 space-y-3 rounded-lg border border-border bg-card p-4">
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
          <div key={slot} className="space-y-2 rounded-md border border-border/70 p-2">
            <p className="text-xs font-semibold">Partido {slot}</p>
            <TeamSelect value={left} onChange={(val) => setForm((f) => ({ ...f, [isA ? "aLeft" : "bLeft"]: val }))} teams={teams.filter((t) => t.id !== "BYE")} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={bye} onChange={(e) => setForm((f) => ({ ...f, [isA ? "aBye" : "bBye"]: e.target.checked }))} />
              BYE (partido terminado automáticamente)
            </label>
            <TeamSelect value={right} disabled={bye} onChange={(val) => setForm((f) => ({ ...f, [isA ? "aRight" : "bRight"]: val }))} teams={teams} />
          </div>
        )
      })}
    </section>
  )
}
