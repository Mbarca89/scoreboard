"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DecisionPanel } from "@/components/control/decision-panel"
import { TeamPanel } from "@/components/control/team-panel"
import { TimerControl } from "@/components/control/timer-control"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAudio } from "@/hooks/use-audio"
import type { AXLSlot, ControlState, MatchState, TeamState, TimerMode } from "@/lib/types"
import { Brackets, Plus, RotateCcw, Trash2, Trophy } from "lucide-react"

const STORAGE_KEY = "axl-torneito-1v1"
const BREAK_TIME_SEC = 31
const GAME_TIME_SEC = 60
const MAX_POINTS = 4
const GROUP_MATCHES_PER_PLAYER = 4
const POINTS = {
  WIN: 5,
  DRAW: 1,
  LOSS: 0,
}

type LocalStage = "GROUP" | "SEMI" | "FINAL"

type LocalPlayer = {
  id: string
  name: string
}

type LocalMatch = {
  id: string
  blockId: string
  slot: AXLSlot
  stage: LocalStage
  leftPlayerId: string
  rightPlayerId: string
  leftScore: number
  rightScore: number
  isFinished: boolean
}

type LocalBlock = {
  id: string
  order: number
  stage: LocalStage
}

type LocalTournament = {
  players: LocalPlayer[]
  blocks: LocalBlock[]
  matches: LocalMatch[]
  activeBlockId: string
  updatedAt: string
}

type LocalStanding = {
  playerId: string
  playerName: string
  played: number
  won: number
  drawn: number
  lost: number
  pointsFor: number
  pointsAgainst: number
  pointDiff: number
  totalPoints: number
  results: string[]
}

function createId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function pairKey(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join("::")
}

function createGroupPairs(players: LocalPlayer[]): Array<[LocalPlayer, LocalPlayer]> {
  const seededPlayers = shuffle(players)
  const pairs: Array<[LocalPlayer, LocalPlayer]> = []
  const usedPairs = new Set<string>()

  for (let index = 0; index < seededPlayers.length; index += 1) {
    for (const offset of [1, 2]) {
      const left = seededPlayers[index]
      const right = seededPlayers[(index + offset) % seededPlayers.length]
      const key = pairKey(left.id, right.id)
      if (left.id !== right.id && !usedPairs.has(key)) {
        usedPairs.add(key)
        pairs.push([left, right])
      }
    }
  }

  if (seededPlayers.length === 4) {
    pairs.push([seededPlayers[0], seededPlayers[1]])
    pairs.push([seededPlayers[2], seededPlayers[3]])
  }

  return shuffle(pairs)
}

function packMatchesIntoBlocks(matches: Omit<LocalMatch, "blockId" | "slot">[], startOrder: number) {
  const blocks: LocalBlock[] = []
  const packed: LocalMatch[] = []
  const blockMatches = new Map<string, LocalMatch[]>()

  for (const match of matches) {
    let targetBlock = blocks.find((block) => {
      if (block.stage !== match.stage) return false
      const existing = blockMatches.get(block.id) ?? []
      if (existing.length >= 2) return false
      return existing.every(
        (candidate) =>
          candidate.leftPlayerId !== match.leftPlayerId &&
          candidate.leftPlayerId !== match.rightPlayerId &&
          candidate.rightPlayerId !== match.leftPlayerId &&
          candidate.rightPlayerId !== match.rightPlayerId
      )
    })

    if (!targetBlock) {
      targetBlock = {
        id: createId("bloque", startOrder + blocks.length - 1),
        order: startOrder + blocks.length,
        stage: match.stage,
      }
      blocks.push(targetBlock)
      blockMatches.set(targetBlock.id, [])
    }

    const existing = blockMatches.get(targetBlock.id) ?? []
    const packedMatch: LocalMatch = {
      ...match,
      blockId: targetBlock.id,
      slot: existing.length === 0 ? "A" : "B",
    }
    existing.push(packedMatch)
    blockMatches.set(targetBlock.id, existing)
    packed.push(packedMatch)
  }

  return { blocks, matches: packed }
}

function createTournament(names: string[]): LocalTournament {
  const players = names.map((name, index) => ({
    id: createId("player", index),
    name,
  }))

  const groupPairs = createGroupPairs(players)
  const draftMatches = groupPairs.map(([left, right], index) => ({
    id: createId("grupo", index),
    stage: "GROUP" as LocalStage,
    leftPlayerId: left.id,
    rightPlayerId: right.id,
    leftScore: 0,
    rightScore: 0,
    isFinished: false,
  }))
  const packed = packMatchesIntoBlocks(draftMatches, 1)

  return {
    players,
    blocks: packed.blocks,
    matches: packed.matches,
    activeBlockId: packed.blocks[0]?.id ?? "",
    updatedAt: new Date().toISOString(),
  }
}

function normalizeTournament(raw: LocalTournament): LocalTournament {
  const blocks = raw.blocks.map((block) => ({
    ...block,
    stage: block.stage ?? "GROUP",
  }))
  const matches = raw.matches.map((match) => ({
    ...match,
    stage: match.stage ?? "GROUP",
  }))

  return {
    ...raw,
    blocks,
    matches,
    activeBlockId: raw.activeBlockId || blocks[0]?.id || "",
  }
}

function readTournament(): LocalTournament | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeTournament(JSON.parse(raw) as LocalTournament) : null
  } catch {
    return null
  }
}

function saveTournament(tournament: LocalTournament) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...tournament, updatedAt: new Date().toISOString() })
  )
}

function playerName(tournament: LocalTournament | null, playerId: string) {
  return tournament?.players.find((player) => player.id === playerId)?.name ?? "Jugador"
}

function buildStandings(tournament: LocalTournament | null): LocalStanding[] {
  if (!tournament) return []

  const table = new Map<string, LocalStanding>()
  for (const player of tournament.players) {
    table.set(player.id, {
      playerId: player.id,
      playerName: player.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      totalPoints: 0,
      results: [],
    })
  }

  for (const match of tournament.matches.filter((candidate) => candidate.stage === "GROUP")) {
    const left = table.get(match.leftPlayerId)
    const right = table.get(match.rightPlayerId)
    if (!left || !right) continue

    if (!match.isFinished) {
      left.results.push("P")
      right.results.push("P")
      continue
    }

    left.played += 1
    right.played += 1
    left.pointsFor += match.leftScore
    left.pointsAgainst += match.rightScore
    right.pointsFor += match.rightScore
    right.pointsAgainst += match.leftScore
    left.results.push(`${match.leftScore}-${match.rightScore}`)
    right.results.push(`${match.rightScore}-${match.leftScore}`)

    if (match.leftScore > match.rightScore) {
      left.won += 1
      right.lost += 1
      left.totalPoints += POINTS.WIN
      right.totalPoints += POINTS.LOSS
    } else if (match.rightScore > match.leftScore) {
      right.won += 1
      left.lost += 1
      right.totalPoints += POINTS.WIN
      left.totalPoints += POINTS.LOSS
    } else {
      left.drawn += 1
      right.drawn += 1
      left.totalPoints += POINTS.DRAW
      right.totalPoints += POINTS.DRAW
    }
  }

  return Array.from(table.values())
    .map((standing) => ({
      ...standing,
      pointDiff: standing.pointsFor - standing.pointsAgainst,
    }))
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
      return a.playerName.localeCompare(b.playerName)
    })
}

function buildTeam(player: LocalPlayer | undefined, score: number): TeamState {
  return {
    id: player?.id ?? "empty",
    name: player?.name ?? "Jugador",
    logoPath: null,
    score,
    timeoutUsed: false,
  }
}

function buildMatchState(tournament: LocalTournament, match: LocalMatch): MatchState {
  return {
    matchId: match.id,
    slot: match.slot,
    stage: match.stage,
    leftTeam: buildTeam(
      tournament.players.find((player) => player.id === match.leftPlayerId),
      match.leftScore
    ),
    rightTeam: buildTeam(
      tournament.players.find((player) => player.id === match.rightPlayerId),
      match.rightScore
    ),
    sidesSwapped: false,
    gameTimerSec: GAME_TIME_SEC,
    breakTimerSec: BREAK_TIME_SEC,
    timerMode: "IDLE",
    isFinished: match.isFinished,
    category: "3v3 D6",
    maxPoints: MAX_POINTS,
    winCondition: "race",
    maxGameTimeSec: GAME_TIME_SEC,
    isOvertime: false,
    nextOvertimeSec: null,
  }
}

function resolveNextState(
  prev: ControlState,
  matchKey: "matchA" | "matchB",
  updatedMatch: MatchState
): ControlState {
  const otherSlot: AXLSlot = prev.activeSlot === "A" ? "B" : "A"
  const otherMatchKey = otherSlot === "A" ? "matchA" : "matchB"
  const otherMatch = prev[otherMatchKey]

  if (updatedMatch.isFinished && otherMatch && !otherMatch.isFinished) {
    return {
      ...prev,
      [matchKey]: updatedMatch,
      activeSlot: otherSlot,
      pendingDecision: null,
      [otherMatchKey]: {
        ...otherMatch,
        breakTimerSec: BREAK_TIME_SEC,
        timerMode: "BREAK",
      },
    }
  }

  return {
    ...prev,
    [matchKey]: updatedMatch,
    pendingDecision: null,
  }
}

function useLocalTournamentControl(tournament: LocalTournament | null, onTournamentChange: (next: LocalTournament) => void) {
  const [state, setState] = useState<ControlState>({
    eventId: "torneito-1v1",
    blockId: "",
    matchA: null,
    matchB: null,
    activeSlot: "A",
    pendingDecision: null,
    singleMatchMode: false,
  })

  const activeMatch = state.activeSlot === "A" ? state.matchA : state.matchB
  const waitingMatch = state.activeSlot === "A" ? state.matchB : state.matchA
  const { prime, playWav, playBeeps, playSequence } = useAudio()
  const breakSoundsPlayedRef = useRef<Set<number>>(new Set())
  const audioOnceRef = useRef<Set<string>>(new Set())

  const emitOnce = useCallback((key: string, fn: () => void) => {
    if (audioOnceRef.current.has(key)) return
    audioOnceRef.current.add(key)
    fn()
    window.setTimeout(() => audioOnceRef.current.delete(key), 2000)
  }, [])

  const BEEP_2_QUICK = { freq: 1800, duration: 0.08, count: 2, silence: 0.05, type: "square" as const, gain: 0.22 }
  const BEEP_3_LONG = { freq: 800, duration: 0.18, count: 3, silence: 0.06, type: "square" as const, gain: 0.25 }
  const BEEP_BREAK_EACH_SEC = { freq: 1800, duration: 0.08, count: 1, silence: 0, type: "square" as const, gain: 0.22 }
  const BEEP_BREAK_ZERO = { freq: 800, duration: 1, count: 1, silence: 0, type: "square" as const, gain: 0.28 }

  const scheduleSwitchAnnouncement = useCallback((fromSlot: AXLSlot, toSlot: AXLSlot, blockId: string, matchId: string, delayMs = 1400) => {
    window.setTimeout(() => {
      emitOnce(`local:switch:${fromSlot}->${toSlot}:${blockId}:${matchId}`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "1-minute" })
      )
    }, delayMs)
  }, [emitOnce, playSequence])

  const scheduleGameFinished = useCallback((matchId: string) => {
    window.setTimeout(() => {
      emitOnce(`local:game-finished:${matchId}`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "game-finished" })
      )
    }, 1500)
  }, [emitOnce, playSequence])

  const persistMatch = useCallback(
    (match: MatchState) => {
      if (!tournament) return

      const next = {
        ...tournament,
        matches: tournament.matches.map((localMatch) =>
          localMatch.id === match.matchId
            ? {
                ...localMatch,
                leftScore: match.leftTeam.score,
                rightScore: match.rightTeam.score,
                isFinished: match.isFinished,
              }
            : localMatch
        ),
      }
      saveTournament(next)
      onTournamentChange(next)
    },
    [onTournamentChange, tournament]
  )

  const loadBlock = useCallback(
    (blockId: string) => {
      if (!tournament) return

      const matchA = tournament.matches.find((match) => match.blockId === blockId && match.slot === "A")
      const matchB = tournament.matches.find((match) => match.blockId === blockId && match.slot === "B")
      if (tournament.activeBlockId !== blockId) {
        const nextTournament = { ...tournament, activeBlockId: blockId }
        saveTournament(nextTournament)
        onTournamentChange(nextTournament)
      }

      setState({
        eventId: "torneito-1v1",
        blockId,
        matchA: matchA ? buildMatchState(tournament, matchA) : null,
        matchB: matchB ? buildMatchState(tournament, matchB) : null,
        activeSlot: "A",
        pendingDecision: null,
        singleMatchMode: !matchB,
      })
      breakSoundsPlayedRef.current.clear()
    },
    [onTournamentChange, tournament]
  )

  useEffect(() => {
    if (!tournament?.activeBlockId) return
    loadBlock(tournament.activeBlockId)
  }, [loadBlock, tournament?.activeBlockId])

  useEffect(() => {
    const id = window.setInterval(() => {
      setState((prev) => {
        const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev

        if (match.timerMode === "BREAK" && match.breakTimerSec > 0) {
          const nextBreak = match.breakTimerSec - 1

          const announcements = [20] as const
          for (const t of announcements) {
            if (nextBreak === t && !breakSoundsPlayedRef.current.has(t)) {
              breakSoundsPlayedRef.current.add(t)
              emitOnce(`local:break:${match.matchId}:ann:${t}`, () =>
                playSequence({ preBeeps: BEEP_2_QUICK, wav: "20-seconds" })
              )
            }
          }

          if (nextBreak === 10 && !breakSoundsPlayedRef.current.has(10)) {
            breakSoundsPlayedRef.current.add(10)
            emitOnce(`local:break:${match.matchId}:10`, () => playWav("10-seconds"))
          }

          if (nextBreak <= 9 && nextBreak >= 1) {
            emitOnce(`local:break:${match.matchId}:sec:${nextBreak}`, () =>
              playBeeps(BEEP_BREAK_EACH_SEC)
            )
          }

          if (nextBreak === 0) {
            emitOnce(`local:break:${match.matchId}:0`, () =>
              playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" })
            )
            breakSoundsPlayedRef.current.clear()
          }

          return {
            ...prev,
            [matchKey]: {
              ...match,
              breakTimerSec: nextBreak,
              timerMode: nextBreak === 0 ? ("GAME" as TimerMode) : match.timerMode,
            },
          }
        }

        if (match.timerMode === "GAME" && match.gameTimerSec > 0) {
          const nextGame = match.gameTimerSec - 1
          const isTied = match.leftTeam.score === match.rightTeam.score
          const isElimination = match.stage === "SEMI" || match.stage === "FINAL"
          const isFinished = nextGame === 0 && (!isElimination || !isTied)
          const updatedMatch = {
            ...match,
            gameTimerSec: nextGame,
            timerMode: nextGame === 0 ? ("IDLE" as TimerMode) : match.timerMode,
            isFinished,
          }

          if (isFinished) {
            emitOnce(`local:game:${match.matchId}:finished`, () =>
              playSequence({ preBeeps: BEEP_3_LONG, wav: "game-finished" })
            )
            persistMatch(updatedMatch)
            return resolveNextState(prev, matchKey, updatedMatch)
          }

          return {
            ...prev,
            [matchKey]: updatedMatch,
          }
        }

        return prev
      })
    }, 1000)

    return () => window.clearInterval(id)
  }, [emitOnce, persistMatch, playBeeps, playSequence, playWav])

  const startBreak = useCallback(() => {
    prime()
    emitOnce(`local:ui:break:start:${state.activeSlot}:${state.blockId}`, () =>
      playBeeps(BEEP_2_QUICK)
    )

    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match || match.isFinished) return prev
      breakSoundsPlayedRef.current.clear()

      return {
        ...prev,
        [matchKey]: {
          ...match,
          breakTimerSec: match.breakTimerSec > 0 ? match.breakTimerSec : BREAK_TIME_SEC,
          timerMode: "BREAK",
        },
      }
    })
  }, [emitOnce, playBeeps, prime, state.activeSlot, state.blockId])

  const stopTimer = useCallback(() => {
    prime()

    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      if (match.timerMode === "GAME") {
        emitOnce(`local:ui:game:stop:${match.matchId}:${match.gameTimerSec}`, () =>
          playSequence({ preBeeps: BEEP_3_LONG, wav: "game-stop" })
        )
      } else if (match.timerMode === "BREAK") {
        emitOnce(`local:ui:break:stop:${match.matchId}:${match.breakTimerSec}`, () =>
          playBeeps(BEEP_2_QUICK)
        )
      }

      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "PAUSED" },
        pendingDecision:
          match.timerMode === "GAME"
            ? { side: "left", matchId: match.matchId, fromStop: true }
            : prev.pendingDecision,
      }
    })
  }, [emitOnce, playBeeps, playSequence, prime])

  const resumeTimer = useCallback(() => {
    prime()

    if (activeMatch) {
      if (activeMatch.breakTimerSec > 0) {
        emitOnce(`local:ui:break:resume:${activeMatch.matchId}:${activeMatch.breakTimerSec}`, () =>
          playBeeps(BEEP_2_QUICK)
        )
      } else {
        emitOnce(`local:ui:game:resume:${activeMatch.matchId}:${activeMatch.gameTimerSec}`, () =>
          playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" })
        )
      }
    }

    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      return {
        ...prev,
        [matchKey]: { ...match, timerMode: match.breakTimerSec > 0 ? "BREAK" : "GAME" },
        pendingDecision: null,
      }
    })
  }, [activeMatch, emitOnce, playBeeps, playSequence, prime])

  const setBreakTimer = useCallback((seconds: number) => {
    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      return { ...prev, [matchKey]: { ...match, breakTimerSec: seconds } }
    })
  }, [])

  const setGameTimer = useCallback((seconds: number) => {
    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      return { ...prev, [matchKey]: { ...match, gameTimerSec: Math.max(0, seconds) } }
    })
  }, [])

  const switchSlot = useCallback((slot: AXLSlot) => {
    setState((prev) => {
      const target = slot === "A" ? prev.matchA : prev.matchB
      if (!target) return prev
      return { ...prev, activeSlot: slot, pendingDecision: null }
    })
  }, [])

  const setScore = useCallback(
    (side: "left" | "right", score: number) => {
      setState((prev) => {
        const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev
        const teamKey = side === "left" ? "leftTeam" : "rightTeam"
        const updatedMatch = {
          ...match,
          [teamKey]: { ...match[teamKey], score: Math.max(0, Math.min(MAX_POINTS, score)) },
        }
        persistMatch(updatedMatch)
        return { ...prev, [matchKey]: updatedMatch }
      })
    },
    [persistMatch]
  )

  const finishPoint = useCallback(
    (side: "left" | "right") => {
      setState((prev) => {
        const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev

        const teamKey = side === "left" ? "leftTeam" : "rightTeam"
        const updatedMatch: MatchState = {
          ...match,
          [teamKey]: { ...match[teamKey], score: MAX_POINTS },
          timerMode: "IDLE",
          isFinished: true,
        }

        persistMatch(updatedMatch)
        breakSoundsPlayedRef.current.clear()
        const result = resolveNextState(prev, matchKey, updatedMatch)

        scheduleGameFinished(match.matchId)
        if (result.activeSlot !== prev.activeSlot) {
          scheduleSwitchAnnouncement(prev.activeSlot, result.activeSlot, prev.blockId, updatedMatch.matchId, 2600)
        }

        return result
      })
    },
    [persistMatch, scheduleGameFinished, scheduleSwitchAnnouncement]
  )

  const handleBase = useCallback((side: "left" | "right") => {
    if (activeMatch?.timerMode !== "GAME") return
    prime()
    emitOnce(`local:ui:base:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_3_LONG, wav: "base" })
    )
    const scoringSide = side === "left" ? "right" : "left"

    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match || match.timerMode !== "GAME") return prev
      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "PAUSED" },
        pendingDecision: { side: scoringSide, matchId: match.matchId },
      }
    })
  }, [activeMatch?.timerMode, emitOnce, playSequence, prime, state.activeSlot, state.blockId])

  const handleConcede = useCallback((side: "left" | "right") => {
    prime()
    const concedeAudioKey = `local:ui:concede:${state.activeSlot}:${state.blockId}:${side}:${Date.now()}`
    emitOnce(`${concedeAudioKey}:start`, () =>
      playSequence({ preBeeps: BEEP_3_LONG, wav: "concede" })
    )
    window.setTimeout(() => {
      emitOnce(`${concedeAudioKey}:approved`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
      )
    }, 1000)
    finishPoint(side === "left" ? "right" : "left")
  }, [emitOnce, finishPoint, playSequence, prime, state.activeSlot, state.blockId])

  const approveStoppedPoint = useCallback((side: "left" | "right") => {
    prime()
    emitOnce(`local:ui:approve:fromStop:${state.activeSlot}:${state.blockId}:${side}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
    )
    finishPoint(side)
  }, [emitOnce, finishPoint, playSequence, prime, state.activeSlot, state.blockId])

  const approvePoint = useCallback(() => {
    if (!state.pendingDecision) return
    prime()
    emitOnce(`local:ui:approve:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
    )
    finishPoint(state.pendingDecision.side)
  }, [emitOnce, finishPoint, playSequence, prime, state.activeSlot, state.blockId, state.pendingDecision])

  const reversePoint = useCallback(() => {
    if (!state.pendingDecision) return
    prime()
    emitOnce(`local:ui:reverse:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "reverse-point" })
    )
    finishPoint(state.pendingDecision.side === "left" ? "right" : "left")
  }, [emitOnce, finishPoint, playSequence, prime, state.activeSlot, state.blockId, state.pendingDecision])

  const noPoint = useCallback(() => {
    prime()
    emitOnce(`local:ui:nopoint:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "no-points" })
    )

    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      const otherSlot: AXLSlot = prev.activeSlot === "A" ? "B" : "A"
      const otherMatchKey = otherSlot === "A" ? "matchA" : "matchB"
      const otherMatch = prev[otherMatchKey]

      if (otherMatch && !otherMatch.isFinished) {
        breakSoundsPlayedRef.current.clear()
        return {
          ...prev,
          [matchKey]: { ...match, timerMode: "IDLE" },
          activeSlot: otherSlot,
          pendingDecision: null,
          [otherMatchKey]: { ...otherMatch, breakTimerSec: BREAK_TIME_SEC, timerMode: "BREAK" },
        }
      }

      breakSoundsPlayedRef.current.clear()
      return {
        ...prev,
        [matchKey]: { ...match, breakTimerSec: BREAK_TIME_SEC, timerMode: "BREAK" },
        pendingDecision: null,
      }
    })
  }, [emitOnce, playSequence, prime, state.activeSlot, state.blockId])

  const resumeStoppedGame = useCallback(() => {
    prime()
    emitOnce(`local:ui:resume:fromStop:${state.activeSlot}:${state.blockId}`, () =>
      playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" })
    )

    setState((prev) => {
      const matchKey = prev.activeSlot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "GAME" },
        pendingDecision: null,
      }
    })
  }, [emitOnce, playSequence, prime, state.activeSlot, state.blockId])

  return {
    state,
    activeMatch,
    waitingMatch,
    loadBlock,
    startBreak,
    stopTimer,
    resumeTimer,
    setBreakTimer,
    setGameTimer,
    switchSlot,
    setScore,
    handleBase,
    handleConcede,
    approveStoppedPoint,
    approvePoint,
    reversePoint,
    noPoint,
    resumeStoppedGame,
  }
}

function makeEliminationMatch(
  id: string,
  stage: LocalStage,
  leftPlayerId: string,
  rightPlayerId: string
): Omit<LocalMatch, "blockId" | "slot"> {
  return {
    id,
    stage,
    leftPlayerId,
    rightPlayerId,
    leftScore: 0,
    rightScore: 0,
    isFinished: false,
  }
}

function getMatchWinner(match: LocalMatch) {
  if (!match.isFinished || match.leftScore === match.rightScore) return null
  return match.leftScore > match.rightScore ? match.leftPlayerId : match.rightPlayerId
}

function FixtureSetup({
  tournament,
  onTournamentChange,
  onOpenControl,
}: {
  tournament: LocalTournament | null
  onTournamentChange: (next: LocalTournament | null) => void
  onOpenControl: () => void
}) {
  const [names, setNames] = useState<string[]>(["", "", "", ""])

  useEffect(() => {
    if (!tournament) return
    setNames(tournament.players.map((player) => player.name))
  }, [tournament])

  const cleanNames = useMemo(
    () =>
      names
        .map((name) => name.trim())
        .filter((name, index, all) => name && all.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index),
    [names]
  )
  const standings = useMemo(() => buildStandings(tournament), [tournament])
  const groupMatches = tournament?.matches.filter((match) => match.stage === "GROUP") ?? []
  const semiMatches = tournament?.matches.filter((match) => match.stage === "SEMI") ?? []
  const finalMatches = tournament?.matches.filter((match) => match.stage === "FINAL") ?? []
  const groupDone = groupMatches.length > 0 && groupMatches.every((match) => match.isFinished)
  const semisDone = semiMatches.length === 2 && semiMatches.every((match) => match.isFinished && getMatchWinner(match))

  const saveNextTournament = (next: LocalTournament) => {
    saveTournament(next)
    onTournamentChange(next)
  }

  const generateFixture = () => {
    if (cleanNames.length < 4) return
    const next = createTournament(cleanNames)
    saveNextTournament(next)
    onOpenControl()
  }

  const generateSemis = () => {
    if (!tournament || standings.length < 4 || semiMatches.length > 0 || !groupDone) return

    const seeds = standings.slice(0, 4)
    const drafts = [
      makeEliminationMatch("semi-1", "SEMI", seeds[0].playerId, seeds[3].playerId),
      makeEliminationMatch("semi-2", "SEMI", seeds[1].playerId, seeds[2].playerId),
    ]
    const packed = packMatchesIntoBlocks(drafts, tournament.blocks.length + 1)
    const next = {
      ...tournament,
      blocks: [...tournament.blocks, ...packed.blocks],
      matches: [...tournament.matches, ...packed.matches],
      activeBlockId: packed.blocks[0]?.id ?? tournament.activeBlockId,
    }
    saveNextTournament(next)
    onOpenControl()
  }

  const generateFinal = () => {
    if (!tournament || finalMatches.length > 0 || !semisDone) return

    const winners = semiMatches.map(getMatchWinner).filter(Boolean) as string[]
    if (winners.length !== 2) return

    const packed = packMatchesIntoBlocks(
      [makeEliminationMatch("final-1", "FINAL", winners[0], winners[1])],
      tournament.blocks.length + 1
    )
    const next = {
      ...tournament,
      blocks: [...tournament.blocks, ...packed.blocks],
      matches: [...tournament.matches, ...packed.matches],
      activeBlockId: packed.blocks[0]?.id ?? tournament.activeBlockId,
    }
    saveNextTournament(next)
    onOpenControl()
  }

  const clearTournament = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    onTournamentChange(null)
    setNames(["", "", "", ""])
  }

  return (
    <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(18rem,25rem)_minmax(25rem,1fr)]">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Jugadores</h2>
            <p className="text-xs text-muted-foreground">
              Un grupo grande. Cada jugador juega 4 partidos.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={() => setNames((current) => [...current, ""])}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {names.map((name, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={name}
                placeholder={`Jugador ${index + 1}`}
                onChange={(event) =>
                  setNames((current) =>
                    current.map((value, currentIndex) => (currentIndex === index ? event.target.value : value))
                  )
                }
              />
              {names.length > 4 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setNames((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                  aria-label="Quitar jugador"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button className="flex-1 gap-2" onClick={generateFixture} disabled={cleanNames.length < 4}>
            <Trophy className="h-4 w-4" />
            Generar fixture
          </Button>
          {tournament && (
            <Button variant="outline" size="icon" onClick={clearTournament} aria-label="Borrar torneito">
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
        {cleanNames.length < 4 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Necesitas al menos 4 jugadores para sacar semifinalistas.
          </p>
        )}

        {tournament && (
          <div className="mt-4 grid gap-2">
            <Button
              variant="secondary"
              className="gap-2"
              onClick={generateSemis}
              disabled={!groupDone || semiMatches.length > 0 || standings.length < 4}
            >
              <Brackets className="h-4 w-4" />
              Generar semis top 4
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={generateFinal}
              disabled={!semisDone || finalMatches.length > 0}
            >
              <Trophy className="h-4 w-4" />
              Generar final
            </Button>
          </div>
        )}
      </section>

      <section className="grid gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 text-lg font-bold text-foreground">Posiciones</h2>
          {!tournament ? (
            <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              Carga jugadores y genera el fixture.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Jugador</th>
                    <th className="px-2 py-2 text-center">Resultados</th>
                    <th className="px-2 py-2 text-center">PJ</th>
                    <th className="px-2 py-2 text-center">PG</th>
                    <th className="px-2 py-2 text-center">PE</th>
                    <th className="px-2 py-2 text-center">PP</th>
                    <th className="px-2 py-2 text-center">PF</th>
                    <th className="px-2 py-2 text-center">PC</th>
                    <th className="px-2 py-2 text-center">Dif</th>
                    <th className="px-2 py-2 text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((standing, index) => (
                    <tr key={standing.playerId} className="border-b border-border/60 last:border-0">
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-2 font-semibold text-foreground">{standing.playerName}</td>
                      <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
                        {standing.results.join(" - ") || "-"}
                      </td>
                      <td className="px-2 py-2 text-center font-mono">{standing.played}</td>
                      <td className="px-2 py-2 text-center font-mono">{standing.won}</td>
                      <td className="px-2 py-2 text-center font-mono">{standing.drawn}</td>
                      <td className="px-2 py-2 text-center font-mono">{standing.lost}</td>
                      <td className="px-2 py-2 text-center font-mono">{standing.pointsFor}</td>
                      <td className="px-2 py-2 text-center font-mono">{standing.pointsAgainst}</td>
                      <td className={`px-2 py-2 text-center font-mono ${standing.pointDiff >= 0 ? "text-primary" : "text-destructive"}`}>
                        {standing.pointDiff > 0 ? `+${standing.pointDiff}` : standing.pointDiff}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-base font-bold text-foreground">
                        {standing.totalPoints}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 text-lg font-bold text-foreground">Fixture local</h2>
          {!tournament ? (
            <div className="flex min-h-52 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              Carga jugadores y genera el fixture.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {tournament.blocks.map((block) => (
                <div key={block.id} className="rounded-md border border-border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Bloque {block.order}
                    </span>
                    <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {block.stage}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {tournament.matches
                      .filter((match) => match.blockId === block.id)
                      .map((match) => (
                        <div key={match.id} className="rounded border border-border/70 bg-card/70 p-2 text-sm">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            Partido {match.slot}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{playerName(tournament, match.leftPlayerId)}</span>
                            <span className="font-mono font-bold">
                              {match.leftScore}-{match.rightScore}
                            </span>
                            <span className="truncate text-right">{playerName(tournament, match.rightPlayerId)}</span>
                          </div>
                          {match.isFinished && (
                            <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                              Terminado
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function LocalBlockSelector({
  tournament,
  currentBlockId,
  activeSlot,
  matchA,
  matchB,
  onSelectBlock,
  onSwitchSlot,
}: {
  tournament: LocalTournament
  currentBlockId: string
  activeSlot: AXLSlot
  matchA: { name: string; finished: boolean } | null
  matchB: { name: string; finished: boolean } | null
  onSelectBlock: (blockId: string) => void
  onSwitchSlot: (slot: AXLSlot) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1 rounded-md bg-secondary p-0.5">
        {(["A", "B"] as const).map((slot) => {
          const match = slot === "A" ? matchA : matchB
          return (
            <button
              key={slot}
              type="button"
              onClick={() => onSwitchSlot(slot)}
              disabled={!match}
              className={`rounded-sm px-3 py-1 text-xs font-semibold transition-colors ${
                activeSlot === slot ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              } ${!match ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
            >
              Partido {slot}
            </button>
          )
        })}
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-muted-foreground">Bloque:</span>
        {tournament.blocks.map((block) => (
          <Button
            key={block.id}
            variant={block.id === currentBlockId ? "default" : "secondary"}
            size="sm"
            className="gap-1 text-xs"
            onClick={() => onSelectBlock(block.id)}
          >
            {block.order}
            <span className="text-[9px] uppercase opacity-70">{block.stage}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function LocalControl({ tournament, onTournamentChange }: { tournament: LocalTournament | null; onTournamentChange: (next: LocalTournament) => void }) {
  const control = useLocalTournamentControl(tournament, onTournamentChange)
  const {
    state,
    activeMatch,
    waitingMatch,
    loadBlock,
    startBreak,
    stopTimer,
    resumeTimer,
    setBreakTimer,
    setGameTimer,
    switchSlot,
    setScore,
    handleBase,
    handleConcede,
    approveStoppedPoint,
    approvePoint,
    reversePoint,
    noPoint,
    resumeStoppedGame,
  } = control

  const hasPendingDecision = state.pendingDecision !== null
  const isFromStop = state.pendingDecision?.fromStop ?? false
  const isPaused = activeMatch?.timerMode === "PAUSED"
  const pendingTeamName =
    state.pendingDecision?.side === "left"
      ? activeMatch?.leftTeam.name ?? ""
      : activeMatch?.rightTeam.name ?? ""

  if (!tournament) {
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Genera un fixture para habilitar la mesa.
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Mesa local 1vs1</h2>
          <p className="text-xs text-muted-foreground">
            Split deck - break 30s - grupo a 4 partidos - top 4 a semis
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {tournament.players.length} jugadores - {tournament.matches.length} partidos
        </div>
      </div>

      <div className="flex flex-1 gap-3">
        <TeamPanel
          match={activeMatch ?? null}
          team={activeMatch?.leftTeam ?? null}
          pitTeam={activeMatch?.leftTeam ?? null}
          baseTeam={activeMatch?.rightTeam ?? null}
          physicalSide="left"
          isActive={!hasPendingDecision || isFromStop}
          onBase={() => (isFromStop ? approveStoppedPoint("right") : handleBase("left"))}
          onTimeout={() => {}}
          onConcede={() => handleConcede("left")}
          onScoreUp={() => setScore("left", (activeMatch?.leftTeam.score ?? 0) + 1)}
          onScoreDown={() => setScore("left", (activeMatch?.leftTeam.score ?? 0) - 1)}
          disabled={hasPendingDecision && !isFromStop}
          isPaused={Boolean(isPaused)}
          isStoppedDecision={isFromStop}
        />

        <div className="flex w-80 shrink-0 flex-col gap-3">
          <TimerControl
            match={activeMatch ?? null}
            onStart={startBreak}
            onStop={stopTimer}
            onResume={resumeTimer}
            onSetBreak={setBreakTimer}
            onSetGameTimer={setGameTimer}
            onStartOvertime={() => {}}
            onCampoActivo={() => {}}
            hasPendingDecision={hasPendingDecision}
          />

          {hasPendingDecision && (
            <DecisionPanel
              side={state.pendingDecision!.side}
              teamName={pendingTeamName}
              isFromStop={isFromStop}
              onApprove={approvePoint}
              onReverse={reversePoint}
              onNoPoint={noPoint}
              onResumeFromStop={resumeStoppedGame}
            />
          )}

          {waitingMatch && !waitingMatch.isFinished && (
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                En espera - Partido {waitingMatch.slot}
              </span>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">{waitingMatch.leftTeam.name}</span>
                <span className="font-mono text-sm font-bold text-foreground">
                  {waitingMatch.leftTeam.score} - {waitingMatch.rightTeam.score}
                </span>
                <span className="truncate text-right text-xs text-foreground">{waitingMatch.rightTeam.name}</span>
              </div>
            </div>
          )}
        </div>

        <TeamPanel
          match={activeMatch ?? null}
          team={activeMatch?.rightTeam ?? null}
          pitTeam={activeMatch?.rightTeam ?? null}
          baseTeam={activeMatch?.leftTeam ?? null}
          physicalSide="right"
          isActive={!hasPendingDecision || isFromStop}
          onBase={() => (isFromStop ? approveStoppedPoint("left") : handleBase("right"))}
          onTimeout={() => {}}
          onConcede={() => handleConcede("right")}
          onScoreUp={() => setScore("right", (activeMatch?.rightTeam.score ?? 0) + 1)}
          onScoreDown={() => setScore("right", (activeMatch?.rightTeam.score ?? 0) - 1)}
          disabled={hasPendingDecision && !isFromStop}
          isPaused={Boolean(isPaused)}
          isStoppedDecision={isFromStop}
        />
      </div>

      <LocalBlockSelector
        tournament={tournament}
        currentBlockId={state.blockId}
        activeSlot={state.activeSlot}
        matchA={state.matchA ? { name: `${state.matchA.leftTeam.name} vs ${state.matchA.rightTeam.name}`, finished: state.matchA.isFinished } : null}
        matchB={state.matchB ? { name: `${state.matchB.leftTeam.name} vs ${state.matchB.rightTeam.name}`, finished: state.matchB.isFinished } : null}
        onSelectBlock={loadBlock}
        onSwitchSlot={switchSlot}
      />
    </div>
  )
}

export default function TorneitoPage() {
  const [tab, setTab] = useState("fixture")
  const [tournament, setTournament] = useState<LocalTournament | null>(null)

  useEffect(() => {
    setTournament(readTournament())
  }, [])

  return (
    <main className="flex min-h-screen flex-col bg-background p-3 text-foreground">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Torneito 1vs1</h1>
            <p className="text-xs text-muted-foreground">Grupo unico, top 4, semis y final</p>
          </div>
          <TabsList>
            <TabsTrigger value="fixture">Jugadores</TabsTrigger>
            <TabsTrigger value="control">Mesa</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="fixture" className="min-h-0">
          <FixtureSetup
            tournament={tournament}
            onTournamentChange={setTournament}
            onOpenControl={() => setTab("control")}
          />
        </TabsContent>

        <TabsContent value="control" className="min-h-0">
          <LocalControl tournament={tournament} onTournamentChange={setTournament} />
        </TabsContent>
      </Tabs>
    </main>
  )
}
