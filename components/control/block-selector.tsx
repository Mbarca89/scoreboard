"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { FixtureBlock, AXLSlot } from "@/lib/types"

interface BlockSelectorProps {
  eventId: string
  currentBlockId: string
  activeSlot: AXLSlot
  onSelectBlock: (blockId: string) => void
}

export function BlockSelector({ eventId, currentBlockId, activeSlot, onSelectBlock }: BlockSelectorProps) {
  const [blocks, setBlocks] = useState<FixtureBlock[]>([])

  useEffect(() => {
    fetch(`/api/blocks?eventId=${eventId}`)
      .then((r) => r.json())
      .then(setBlocks)
      .catch(() => {})
  }, [eventId])

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {/* Slot tabs */}
      <div className="flex items-center gap-1 rounded-md bg-secondary p-0.5">
        <div
          className={`rounded-sm px-3 py-1 text-xs font-semibold transition-colors ${
            activeSlot === "A" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          Partido A
        </div>
        <div
          className={`rounded-sm px-3 py-1 text-xs font-semibold transition-colors ${
            activeSlot === "B" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          Partido B
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      {/* Block selector */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-muted-foreground">Bloque:</span>
        {blocks.map((block) => (
          <Button
            key={block.block_id}
            variant={block.block_id === currentBlockId ? "default" : "secondary"}
            size="sm"
            className="text-xs"
            onClick={() => onSelectBlock(block.block_id)}
          >
            {block.block_order} - {block.category}
            {block.status === "DONE" && " (fin)"}
          </Button>
        ))}
        {blocks.length === 0 && (
          <span className="text-xs text-muted-foreground">No hay bloques</span>
        )}
      </div>
    </div>
  )
}
