import type { Match } from "@/lib/types"

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

interface MatchCardProps {
  match: Match
  compact?: boolean
}

export function MatchCard({ match, compact = false }: MatchCardProps) {
  const isFinished = match.is_finished
  const leftWon = match.winner_team_id === match.left_team_id
  const rightWon = match.winner_team_id === match.right_team_id

  return (
    <div
      className={`rounded-md border ${compact ? "p-2" : "p-3"} print:border-slate-300 print:bg-white ${
        isFinished ? "border-border/50 bg-secondary/30" : "border-border bg-secondary/50"
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground print:text-slate-600">
          Slot {match.slot}
        </span>
        {isFinished && (
          <span className="text-[10px] font-semibold text-muted-foreground print:text-slate-600">FIN</span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className={`truncate text-xs ${leftWon ? "font-bold text-primary print:text-slate-900" : "text-foreground print:text-slate-900"}`}>
          {match.left_team_name}
        </span>
        <div className="flex items-center gap-1">
          <span className={`font-mono text-sm font-bold ${leftWon ? "text-primary print:text-slate-900" : "text-foreground print:text-slate-900"}`}>
            {match.left_score}
          </span>
          <span className="text-[10px] text-muted-foreground print:text-slate-500">-</span>
          <span className={`font-mono text-sm font-bold ${rightWon ? "text-primary print:text-slate-900" : "text-foreground print:text-slate-900"}`}>
            {match.right_score}
          </span>
        </div>
        <span className={`truncate text-right text-xs ${rightWon ? "font-bold text-primary print:text-slate-900" : "text-foreground print:text-slate-900"}`}>
          {match.right_team_name}
        </span>
      </div>

      {!isFinished && (
        <div className="mt-1 text-center">
          <span className="font-mono text-[10px] text-muted-foreground print:text-slate-600">
            {formatTime(match.time_remaining_sec)}
          </span>
        </div>
      )}
    </div>
  )
}
