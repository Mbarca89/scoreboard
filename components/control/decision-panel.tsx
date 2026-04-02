"use client"

import { Button } from "@/components/ui/button"
import { RotateCcw, Check, X, Play } from "lucide-react"

interface DecisionPanelProps {
  side: "left" | "right"
  teamName: string
  isFromStop?: boolean
  onApprove: () => void
  onReverse: () => void
  onNoPoint: () => void
  onResumeFromStop?: () => void
}

export function DecisionPanel({ side, teamName, isFromStop, onApprove, onReverse, onNoPoint, onResumeFromStop }: DecisionPanelProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-accent bg-accent/10 p-5">
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent">
          {isFromStop ? "Juego detenido" : "Punto reclamado"}
        </span>
        {!isFromStop && (
          <span className="text-lg font-bold text-foreground">
            {teamName} ({side === "left" ? "Izquierda" : "Derecha"})
          </span>
        )}
      </div>

      <div className="flex flex-col w-full gap-3">
        {!isFromStop && (
          <>
            <Button
              variant="outline"
              className="flex-1 gap-2 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onReverse}
            >
              <RotateCcw className="h-4 w-4" />
              Reverse
            </Button>

            <Button
              className="flex-1 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onApprove}
            >
              <Check className="h-4 w-4" />
              Approve
            </Button>
          </>
        )}

        <Button variant="secondary" className="flex-1 gap-2" onClick={onNoPoint}>
          <X className="h-4 w-4" />
          No Point
        </Button>

        {isFromStop && onResumeFromStop && (
          <Button
            className="flex-1 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onResumeFromStop}
          >
            <Play className="h-4 w-4" />
            Reanudar Juego
          </Button>
        )}
      </div>
    </div>
  )
}
