"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { FixtureBlock, AXLSlot } from "@/lib/types"

interface BlockSelectorProps {
  eventId: string
  currentBlockId: string
  activeSlot: AXLSlot
  matchA: { name: string; finished: boolean } | null
  matchB: { name: string; finished: boolean } | null
  onSelectBlock: (blockId: string) => void
  onSwitchSlot: (slot: AXLSlot) => void
}

export function BlockSelector({ eventId, currentBlockId, activeSlot, matchA, matchB, onSelectBlock, onSwitchSlot }: BlockSelectorProps) {
  const [blocks, setBlocks] = useState<FixtureBlock[]>([])

  const loadBlocks = useCallback(() => {
    fetch(`/api/blocks?eventId=${eventId}`)
      .then((r) => r.json())
      .then(setBlocks)
      .catch(() => {})
  }, [eventId])

  useEffect(() => {
    loadBlocks()
    const interval = window.setInterval(loadBlocks, 5000)
    return () => window.clearInterval(interval)
  }, [loadBlocks])

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {/* Slot tabs */}
      <div className="flex items-center gap-1 rounded-md bg-secondary p-0.5">
        <button
          type="button"
          onClick={() => onSwitchSlot("A")}
          disabled={!matchA}
          className={`rounded-sm px-3 py-1 text-xs font-semibold transition-colors ${
            activeSlot === "A" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          } ${!matchA ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
        >
          Partido A
        </button>
        <button
          type="button"
          onClick={() => onSwitchSlot("B")}
          disabled={!matchB}
          className={`rounded-sm px-3 py-1 text-xs font-semibold transition-colors ${
            activeSlot === "B" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          } ${!matchB ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
        >
          Partido B
        </button>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      {/* Block selector */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-muted-foreground">Bloque:</span>
        {blocks.map((block) => {
          const isCurrent = block.block_id === currentBlockId
          const isDone = block.status === "DONE"
          return (
            <Button
              key={block.block_id}
              variant={isCurrent ? "default" : "secondary"}
              size="sm"
              className={`text-xs ${
                isDone
                  ? isCurrent
                    ? "!bg-emerald-600 !text-white hover:!bg-emerald-600"
                    : "!bg-emerald-100 !text-emerald-800 hover:!bg-emerald-200"
                  : ""
              }`}
              onClick={() => onSelectBlock(block.block_id)}
            >
              {block.block_order} - {block.category}
            </Button>
          )
        })}
        {blocks.length === 0 && (
          <span className="text-xs text-muted-foreground">No hay bloques</span>
        )}
      </div>
    </div>
  )
}
