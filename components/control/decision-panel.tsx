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
}

export function DecisionPanel({ side, teamName, isFromStop, onApprove, onReverse, onNoPoint }: DecisionPanelProps) {
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

        <Button
          variant={isFromStop ? "default" : "secondary"}
          className={`flex-1 gap-2 ${isFromStop ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
          onClick={onNoPoint}
        >
          {isFromStop ? (
            <>
              <Play className="h-4 w-4" />
              Reanudar
            </>
          ) : (
            <>
              <X className="h-4 w-4" />
              No Point
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
