import type { Match } from "@/lib/types"

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

interface MatchCardProps {
  match: Match
}

export function MatchCard({ match }: MatchCardProps) {
  const isFinished = match.is_finished
  const leftWon = match.winner_team_id === match.left_team_id
  const rightWon = match.winner_team_id === match.right_team_id

  return (
    <div className={`rounded-md border p-3 ${isFinished ? "border-border/50 bg-secondary/30" : "border-border bg-secondary/50"}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Slot {match.slot}
        </span>
        {isFinished && (
          <span className="text-[10px] font-semibold text-muted-foreground">FIN</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-sm ${leftWon ? "font-bold text-primary" : "text-foreground"}`}>
          {match.left_team_name}
        </span>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-lg font-bold ${leftWon ? "text-primary" : "text-foreground"}`}>
            {match.left_score}
          </span>
          <span className="text-xs text-muted-foreground">-</span>
          <span className={`font-mono text-lg font-bold ${rightWon ? "text-primary" : "text-foreground"}`}>
            {match.right_score}
          </span>
        </div>
        <span className={`text-sm ${rightWon ? "font-bold text-primary" : "text-foreground"}`}>
          {match.right_team_name}
        </span>
      </div>

      {!isFinished && (
        <div className="mt-1 text-center">
          <span className="font-mono text-xs text-muted-foreground">
            {formatTime(match.time_remaining_sec)}
          </span>
        </div>
      )}
    </div>
  )
}
