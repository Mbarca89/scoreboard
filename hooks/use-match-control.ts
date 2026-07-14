"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import type { AXLSlot, ControlState, Match, MatchState, TimerMode } from "@/lib/types"
import { getRulesForCategory } from "@/lib/category-rules"
import { useAudio } from "./use-audio"

function buildMatchState(m: Match): MatchState {
  const rules = getRulesForCategory(m.category)
  return {
    matchId: m.match_id,
    slot: m.slot,
    stage: m.stage,
    leftTeam: {
      id: m.left_team_id,
      name: m.left_team_name,
      logoPath: m.left_team_logo_path ?? null,
      score: m.left_score,
      timeoutUsed: false,
    },
    rightTeam: {
      id: m.right_team_id,
      name: m.right_team_name,
      logoPath: m.right_team_logo_path ?? null,
      score: m.right_score,
      timeoutUsed: false,
    },
    sidesSwapped: false,
    gameTimerSec: m.time_remaining_sec > 0 ? m.time_remaining_sec : rules.gameTimeSec,
    breakTimerSec: rules.breakTimeSec,
    timerMode: "IDLE" as TimerMode,
    isFinished: m.is_finished,
    category: m.category,
    maxPoints: rules.maxPoints,
    maxGameTimeSec: rules.gameTimeSec,
    isOvertime: m.is_overtime,
    nextOvertimeSec: null,
  }
}

// Helper: after a point decision, resolve the next state (switch matches or stay)
function resolvePostPoint(
  prev: ControlState,
  matchKey: "matchA" | "matchB",
  updatedMatch: MatchState,
  isFinished: boolean
): ControlState {
  const slot = prev.activeSlot
  const otherSlot: AXLSlot = slot === "A" ? "B" : "A"
  const otherMatchKey = otherSlot === "A" ? "matchA" : "matchB"
  const otherMatch = prev[otherMatchKey]
  const otherFinished = !otherMatch || otherMatch.isFinished

  if (isFinished && otherFinished) {
    return {
      ...prev,
      [matchKey]: updatedMatch,
      pendingDecision: null,
      singleMatchMode: true,
    }
  }

  if (isFinished) {
    const rules = getRulesForCategory(otherMatch!.category)
    return {
      ...prev,
      [matchKey]: updatedMatch,
      activeSlot: otherSlot,
      pendingDecision: null,
      singleMatchMode: true,
      [otherMatchKey]: {
        ...otherMatch!,
        breakTimerSec: getSingleMatchBreakStartSec(rules.singleMatchBreakTimeSec),
        timerMode: "BREAK" as TimerMode,
      },
    }
  }

  if (otherFinished) {
    const rules = getRulesForCategory(updatedMatch.category)
    return {
      ...prev,
      [matchKey]: {
        ...updatedMatch,
        breakTimerSec: getSingleMatchBreakStartSec(rules.singleMatchBreakTimeSec),
        timerMode: "BREAK" as TimerMode,
      },
      pendingDecision: null,
      singleMatchMode: true,
    }
  }

  const rules = getRulesForCategory(otherMatch!.category)
  return {
    ...prev,
    [matchKey]: updatedMatch,
    activeSlot: otherSlot,
    pendingDecision: null,
    [otherMatchKey]: {
      ...otherMatch!,
      breakTimerSec: rules.breakTimeSec,
      timerMode: "BREAK" as TimerMode,
    },
  }
}


function getSingleMatchBreakStartSec(seconds: number): number {
  return seconds === 120 ? 121 : seconds
}

export function useMatchControl(eventId: string) {
  const [state, setState] = useState<ControlState>({
    eventId,
    blockId: "",
    matchA: null,
    matchB: null,
    activeSlot: "A",
    pendingDecision: null,
    singleMatchMode: false,
  })

  const { prime, playWav, playBeeps, playSequence } = useAudio()

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const breakSoundsPlayedRef = useRef<Set<number>>(new Set())
  const gameSoundsPlayedRef = useRef<Set<number>>(new Set())

  // ✅ anti-duplicado (StrictMode / double-invoke safety)
  const audioOnceRef = useRef<Set<string>>(new Set())
  const emitOnce = useCallback((key: string, fn: () => void) => {
    if (audioOnceRef.current.has(key)) return
    audioOnceRef.current.add(key)
    fn()
    setTimeout(() => audioOnceRef.current.delete(key), 2000)
  }, [])

  const activeMatch = state.activeSlot === "A" ? state.matchA : state.matchB
  const waitingMatch = state.activeSlot === "A" ? state.matchB : state.matchA

  // === BEEP SPECS (según tu regla) ===
  const BEEP_2_QUICK = { freq: 1800, duration: 0.08, count: 2, silence: 0.05, type: "square" as const, gain: 0.22 }
  const BEEP_3_LONG = { freq: 800, duration: 0.18, count: 3, silence: 0.06, type: "square" as const, gain: 0.25 }

  // break countdown: 9..1 beep corto cada segundo
  const BEEP_BREAK_EACH_SEC = { freq: 1800, duration: 0.08, count: 1, silence: 0, type: "square" as const, gain: 0.22 }

  // break 0: beep largo distinto + luego game-start.wav
  const BEEP_BREAK_ZERO = { freq: 800, duration: 1, count: 1, silence: 0, type: "square" as const, gain: 0.28 }

  const scheduleSwitchAnnouncement = useCallback((fromSlot: AXLSlot, toSlot: AXLSlot, blockId: string, matchId: string, delayMs = 1400) => {
    window.setTimeout(() => {
      emitOnce(`switch:${fromSlot}->${toSlot}:${blockId}:${matchId}`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "1-minute" })
      )
    }, delayMs)
  }, [emitOnce, playSequence])

  const scheduleGameFinished = useCallback((matchId: string) => {
    setTimeout(() => {
      emitOnce(`ui:game-finished:${matchId}`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "game-finished" })
      )
    }, 1500)
  }, [emitOnce, playSequence])

  const canUseOvertime = useCallback((match: MatchState): boolean => {
    return match.stage === "SEMI" || match.stage === "FINAL"
  }, [])

  // Sync live state to DB for polling
  const syncLiveState = useCallback(async (s: ControlState) => {
    const active = s.activeSlot === "A" ? s.matchA : s.matchB
    const waiting = s.activeSlot === "A" ? s.matchB : s.matchA

    // Scores/teams stay anchored to their pit for scoreboard views.
    // Entry-side badges reflect the current field side after approved points.
    const aSwapped = active?.sidesSwapped ?? false

    try {
      await fetch("/api/live-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: s.eventId,
          active_match_id: active?.matchId ?? null,
          active_slot: s.activeSlot,
          break_timer_sec: active?.breakTimerSec ?? 0,
          game_timer_sec: active?.gameTimerSec ?? 0,
          timer_mode: active?.timerMode ?? "IDLE",
          timer_running: active?.timerMode === "BREAK" || active?.timerMode === "GAME",
          left_score: active?.leftTeam.score ?? 0,
          right_score: active?.rightTeam.score ?? 0,
          left_team_name: active?.leftTeam.name ?? "",
          right_team_name: active?.rightTeam.name ?? "",
          left_team_logo_path: active?.leftTeam.logoPath ?? null,
          right_team_logo_path: active?.rightTeam.logoPath ?? null,
          left_entry_side: aSwapped ? "blue" : "red",
          right_entry_side: aSwapped ? "red" : "blue",
          waiting_match_id: waiting?.matchId ?? null,
          waiting_left_score: waiting?.leftTeam.score ?? 0,
          waiting_right_score: waiting?.rightTeam.score ?? 0,
          waiting_left_team_name: waiting?.leftTeam.name ?? "",
          waiting_right_team_name: waiting?.rightTeam.name ?? "",
          waiting_left_team_logo_path: waiting?.leftTeam.logoPath ?? null,
          waiting_right_team_logo_path: waiting?.rightTeam.logoPath ?? null,
          category: active?.category ?? "",
        }),
      })
    } catch {
      // silent
    }
  }, [])

  // Save score to DB
  const saveScore = useCallback(
    async (matchId: string, leftScore: number, rightScore: number, timeRemaining: number, isFinished: boolean, resultType?: string, winnerTeamId?: string) => {
      try {
        await fetch(`/api/match/${matchId}/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: state.eventId,
            leftScore,
            rightScore,
            timeRemainingSec: timeRemaining,
            isFinished,
            resultType,
            winnerTeamId,
          }),
        })
      } catch {
        // silent
      }
    },
    [state.eventId]
  )

  // Load matches for a block
  const loadBlock = useCallback(
    async (blockId: string) => {

      const url =
        `/api/matches?eventId=${encodeURIComponent(eventId)}` +
        `&blockId=${encodeURIComponent(blockId)}`

      const res = await fetch(url)
      const matches: Match[] = await res.json()

      const matchA = matches.find((m) => m.slot === "A")
      const matchB = matches.find((m) => m.slot === "B")

      setState((prev) => ({
        ...prev,
        blockId,
        matchA: matchA ? buildMatchState(matchA) : null,
        matchB: matchB ? buildMatchState(matchB) : null,
        activeSlot: "A",
        pendingDecision: null,
        singleMatchMode: false,
      }))

      breakSoundsPlayedRef.current.clear()
      gameSoundsPlayedRef.current.clear()
    },
    [eventId]
  )

  // Timer tick
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    timerRef.current = setInterval(() => {
      setState((prev) => {
        const slot = prev.activeSlot
        const matchKey = slot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev

        // === BREAK MODE ===
        if (match.timerMode === "BREAK" && match.breakTimerSec > 0) {
          const newBreak = match.breakTimerSec - 1

          // anuncios con 2 beeps rápidos + WAV
          const announcements = [120, 60, 30, 20] as const
          for (const t of announcements) {
            if (newBreak === t && !breakSoundsPlayedRef.current.has(t)) {
              breakSoundsPlayedRef.current.add(t)

              const key = `break:${match.matchId}:ann:${t}`
              if (t === 120) emitOnce(key, () => playSequence({ preBeeps: BEEP_2_QUICK, wav: "2-minutes" }))
              if (t === 60) emitOnce(key, () => playSequence({ preBeeps: BEEP_2_QUICK, wav: "1-minute" }))
              if (t === 30) emitOnce(key, () => playSequence({ preBeeps: BEEP_2_QUICK, wav: "30-seconds" }))
              if (t === 20) emitOnce(key, () => playSequence({ preBeeps: BEEP_2_QUICK, wav: "20-seconds" }))
            }
          }

          // 10 seconds: SOLO WAV, sin beeps
          if (newBreak === 10 && !breakSoundsPlayedRef.current.has(10)) {
            breakSoundsPlayedRef.current.add(10)
            emitOnce(`break:${match.matchId}:10`, () => playWav("10-seconds"))
          }

          // 9..1: beep corto cada segundo (sin WAV)
          if (newBreak <= 9 && newBreak >= 1) {
            emitOnce(`break:${match.matchId}:sec:${newBreak}`, () => playBeeps(BEEP_BREAK_EACH_SEC))
          }

          // 0: beep largo distinto + game-start.wav, y transición a GAME
          if (newBreak === 0) {
            emitOnce(`break:${match.matchId}:0`, () => playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" }))
            breakSoundsPlayedRef.current.clear()

            const updated = {
              ...prev,
              [matchKey]: {
                ...match,
                breakTimerSec: 0,
                timerMode: "GAME" as TimerMode,
              },
            }
            syncLiveState(updated)
            return updated
          }

          const updated = {
            ...prev,
            [matchKey]: { ...match, breakTimerSec: newBreak },
          }
          syncLiveState(updated)
          return updated
        }

        // === GAME MODE ===
        if (match.timerMode === "GAME" && match.gameTimerSec > 0) {
          const newGame = match.gameTimerSec - 1

          // Game timer reached zero -> finish match, except tied SEMI/FINAL (automatic overtime).
          if (newGame === 0) {
            const isTie = match.leftTeam.score === match.rightTeam.score
            if (canUseOvertime(match) && isTie && !match.isOvertime) {
              emitOnce(`game:${match.matchId}:overtime:stop`, () =>
                playSequence({ preBeeps: BEEP_3_LONG, wav: "game-stop" })
              )
              emitOnce(`game:${match.matchId}:overtime:start`, () =>
                playWav("overtime")
              )
              const updated = {
                ...prev,
                [matchKey]: {
                  ...match,
                  breakTimerSec: getSingleMatchBreakStartSec(120),
                  gameTimerSec: 5 * 60,
                  timerMode: "BREAK" as TimerMode,
                  isOvertime: true,
                  nextOvertimeSec: null,
                },
                pendingDecision: null,
              }
              breakSoundsPlayedRef.current.clear()
              syncLiveState(updated)
              return updated
            }

            emitOnce(`game:${match.matchId}:finished`, () =>
              playSequence({ preBeeps: BEEP_3_LONG, wav: "game-finished" })
            )

            const leftScore = match.leftTeam.score
            const rightScore = match.rightTeam.score
            const resultType =
              leftScore > rightScore
                ? "LEFT_WIN"
                : rightScore > leftScore
                  ? "RIGHT_WIN"
                  : "DRAW"
            const winnerTeamId =
              leftScore > rightScore
                ? match.leftTeam.id
                : rightScore > leftScore
                  ? match.rightTeam.id
                  : undefined

            const updatedMatch: MatchState = {
              ...match,
              gameTimerSec: 0,
              timerMode: "IDLE" as TimerMode,
              isFinished: true,
            }

            saveScore(
              match.matchId,
              leftScore,
              rightScore,
              0,
              true,
              resultType,
              winnerTeamId
            )

            breakSoundsPlayedRef.current.clear()
            const result = resolvePostPoint(prev, matchKey, updatedMatch, true)

            if (result.activeSlot !== prev.activeSlot) {
              scheduleSwitchAnnouncement(prev.activeSlot, result.activeSlot, prev.blockId, updatedMatch.matchId, 2600)
            }
            syncLiveState(result)
            return result
          }

          const updated = {
            ...prev,
            [matchKey]: { ...match, gameTimerSec: newGame },
          }
          syncLiveState(updated)
          return updated
        }

        return prev
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [canUseOvertime, emitOnce, playBeeps, playSequence, playWav, syncLiveState])

  // Start break timer (2 beeps rápidos) — emitOnce para evitar doble click / strict
  const startBreak = useCallback(() => {
    prime()
    emitOnce(`ui:break:start:${state.activeSlot}:${state.blockId}`, () => playBeeps(BEEP_2_QUICK))

    setState((prev) => {
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      breakSoundsPlayedRef.current.clear()
      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "BREAK" as TimerMode },
      }
    })
  }, [prime, emitOnce, playBeeps, state.activeSlot, state.blockId])

  // Stop / pause
  const stopTimer = useCallback(() => {
    prime()

    setState((prev) => {
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      const wasGame = match.timerMode === "GAME"
      if (wasGame) {
        emitOnce(`ui:game:stop:${match.matchId}:${match.gameTimerSec}`, () =>
          playSequence({ preBeeps: BEEP_3_LONG, wav: "game-stop" })
        )
      } else if (match.timerMode === "BREAK") {
        emitOnce(`ui:break:stop:${match.matchId}:${match.breakTimerSec}`, () => playBeeps(BEEP_2_QUICK))
      }

      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "PAUSED" as TimerMode },
        pendingDecision: wasGame
          ? { side: "left" as const, matchId: match.matchId, fromStop: true }
          : prev.pendingDecision,
      }
    })
  }, [prime, emitOnce, playBeeps, playSequence])

  // Resume timer (BREAK => 2 beeps, GAME => beep largo + game-start)
  const resumeTimer = useCallback(() => {
    prime()

    const m = activeMatch
    if (m) {
      if (m.breakTimerSec > 0) {
        emitOnce(`ui:break:resume:${m.matchId}:${m.breakTimerSec}`, () => playBeeps(BEEP_2_QUICK))
      } else {
        emitOnce(`ui:game:resume:${m.matchId}:${m.gameTimerSec}`, () =>
          playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" })
        )
      }
    }

    setState((prev) => {
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      const mode = match.breakTimerSec > 0 ? ("BREAK" as TimerMode) : ("GAME" as TimerMode)
      return {
        ...prev,
        [matchKey]: { ...match, timerMode: mode },
        pendingDecision: null,
      }
    })
  }, [prime, activeMatch, emitOnce, playBeeps, playSequence])

  // Set break timer preset
  const setBreakTimer = useCallback((seconds: number) => {
    setState((prev) => {
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      breakSoundsPlayedRef.current.clear()
      return {
        ...prev,
        [matchKey]: { ...match, breakTimerSec: seconds },
      }
    })
  }, [])

  // Set game timer manually
  const setGameTimer = useCallback((seconds: number) => {
    setState((prev) => {
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      return {
        ...prev,
        [matchKey]: { ...match, gameTimerSec: Math.max(0, seconds) },
      }
    })
  }, [])

  // Switch active slot manually
  const switchSlot = useCallback((targetSlot: AXLSlot) => {
    setState((prev) => {
      if (prev.activeSlot === targetSlot) return prev
      const targetMatchKey = targetSlot === "A" ? "matchA" : "matchB"
      const targetMatch = prev[targetMatchKey]
      if (!targetMatch) return prev
      return {
        ...prev,
        activeSlot: targetSlot,
        pendingDecision: null,
      }
    })
  }, [])

  // BASE (3 beeps + base.wav)
  // The side received is the panel where the button was pressed (the opponent's base).
  // The scoring team is the OPPOSITE side (they reached the rival's base).
  const handleBase = useCallback(
    (side: "left" | "right") => {
      if (activeMatch?.timerMode !== "GAME") return

      prime()
      emitOnce(`ui:base:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
        playSequence({ preBeeps: BEEP_3_LONG, wav: "base" })
      )

      const scoringSide: "left" | "right" = side === "left" ? "right" : "left"

      setState((prev) => {
        const slot = prev.activeSlot
        const matchKey = slot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match || match.timerMode !== "GAME") return prev
        return {
          ...prev,
          [matchKey]: { ...match, timerMode: "PAUSED" as TimerMode },
          pendingDecision: { side: scoringSide, matchId: match.matchId },
        }
      })
    },
    [activeMatch?.timerMode, prime, emitOnce, playSequence, state.activeSlot, state.blockId]
  )

  // Concede (3 beeps + concede.wav)
  const handleConcede = useCallback(
    (side: "left" | "right") => {
      prime()
      const concedeAudioKey = `ui:concede:${state.activeSlot}:${state.blockId}:${side}:${Date.now()}`
      emitOnce(`${concedeAudioKey}:start`, () =>
        playSequence({ preBeeps: BEEP_3_LONG, wav: "concede" })
      )

      setTimeout(() => {
        emitOnce(`${concedeAudioKey}:approved`, () =>
          playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
        )
      }, 1000)

      setState((prev) => {
        const slot = prev.activeSlot
        const matchKey = slot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev

        const scoringKey = side === "left" ? "rightTeam" : "leftTeam"
        const newScore = match[scoringKey].score + 1
        const updatedMatch: MatchState = {
          ...match,
          [scoringKey]: { ...match[scoringKey], score: newScore },
          sidesSwapped: !match.sidesSwapped,
          timerMode: "IDLE" as TimerMode,
        }

        const isFinished = match.isOvertime ? updatedMatch.leftTeam.score !== updatedMatch.rightTeam.score : newScore >= match.maxPoints
        if (isFinished) {
          updatedMatch.isFinished = true
          const winnerTeamId = match[scoringKey].id
          const resultType = scoringKey === "leftTeam" ? "LEFT_WIN" : "RIGHT_WIN"
          saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, true, resultType, winnerTeamId)
        } else {
          saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, false)
        }

        breakSoundsPlayedRef.current.clear()
        const result = resolvePostPoint(prev, matchKey, updatedMatch, isFinished)

        if (isFinished) {
          scheduleGameFinished(match.matchId)
        } else if (result.activeSlot !== prev.activeSlot) {
          scheduleSwitchAnnouncement(prev.activeSlot, result.activeSlot, prev.blockId, updatedMatch.matchId, 2600)
        }

        return result
      })
    },
    [prime, emitOnce, playSequence, saveScore, scheduleSwitchAnnouncement, state.activeSlot, state.blockId]
  )

  const approveStoppedPoint = useCallback(
    (side: "left" | "right") => {
      prime()
      emitOnce(`ui:approve:fromStop:${state.activeSlot}:${state.blockId}:${side}:${Date.now()}`, () =>
        playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
      )

      setState((prev) => {
        if (!prev.pendingDecision?.fromStop) return prev
        const slot = prev.activeSlot
        const matchKey = slot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match || match.timerMode !== "PAUSED") return prev

        const teamKey = side === "left" ? "leftTeam" : "rightTeam"
        const newScore = match[teamKey].score + 1
        const updatedMatch: MatchState = {
          ...match,
          [teamKey]: { ...match[teamKey], score: newScore },
          sidesSwapped: !match.sidesSwapped,
          timerMode: "IDLE" as TimerMode,
        }

        const isFinished = match.isOvertime ? updatedMatch.leftTeam.score !== updatedMatch.rightTeam.score : newScore >= match.maxPoints
        if (isFinished) {
          updatedMatch.isFinished = true
          const winnerTeamId = match[teamKey].id
          const resultType = side === "left" ? "LEFT_WIN" : "RIGHT_WIN"
          saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, true, resultType, winnerTeamId)
        } else {
          saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, false)
        }

        breakSoundsPlayedRef.current.clear()
        const result = resolvePostPoint(prev, matchKey, updatedMatch, isFinished)

        if (isFinished) {
          scheduleGameFinished(match.matchId)
        } else if (result.activeSlot !== prev.activeSlot) {
          scheduleSwitchAnnouncement(prev.activeSlot, result.activeSlot, prev.blockId, updatedMatch.matchId)
        }

        return result
      })
    },
    [prime, emitOnce, playSequence, saveScore, scheduleGameFinished, scheduleSwitchAnnouncement, state.activeSlot, state.blockId]
  )

  // Approve point (2 beeps + point-approved.wav)
  const approvePoint = useCallback(() => {
    prime()
    emitOnce(`ui:approve:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "point-approved" })
    )

    setState((prev) => {
      if (!prev.pendingDecision) return prev
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      const { side } = prev.pendingDecision
      const teamKey = side === "left" ? "leftTeam" : "rightTeam"
      const newScore = match[teamKey].score + 1
      const updatedMatch: MatchState = {
        ...match,
        [teamKey]: { ...match[teamKey], score: newScore },
        sidesSwapped: !match.sidesSwapped,
        timerMode: "IDLE" as TimerMode,
      }

      const isFinished = match.isOvertime ? updatedMatch.leftTeam.score !== updatedMatch.rightTeam.score : newScore >= match.maxPoints
      if (isFinished) {
        updatedMatch.isFinished = true
        const winnerTeamId = match[teamKey].id
        const resultType = side === "left" ? "LEFT_WIN" : "RIGHT_WIN"
        saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, true, resultType, winnerTeamId)
      } else {
        saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, false)
      }

      breakSoundsPlayedRef.current.clear()
      const result = resolvePostPoint(prev, matchKey, updatedMatch, isFinished)

      if (isFinished) {
        scheduleGameFinished(match.matchId)
      } else if (result.activeSlot !== prev.activeSlot) {
        scheduleSwitchAnnouncement(prev.activeSlot, result.activeSlot, prev.blockId, updatedMatch.matchId)
      }

      return result
    })
  }, [prime, emitOnce, playSequence, saveScore, scheduleSwitchAnnouncement, state.activeSlot, state.blockId])

  // Reverse point (2 beeps + reverse-point.wav)
  const reversePoint = useCallback(() => {
    prime()
    emitOnce(`ui:reverse:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "reverse-point" })
    )

    setState((prev) => {
      if (!prev.pendingDecision) return prev
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      const { side } = prev.pendingDecision
      const oppositeKey = side === "left" ? "rightTeam" : "leftTeam"
      const newScore = match[oppositeKey].score + 1
      const updatedMatch: MatchState = {
        ...match,
        [oppositeKey]: { ...match[oppositeKey], score: newScore },
        sidesSwapped: !match.sidesSwapped,
        timerMode: "IDLE" as TimerMode,
      }

      const isFinished = match.isOvertime ? updatedMatch.leftTeam.score !== updatedMatch.rightTeam.score : newScore >= match.maxPoints
      if (isFinished) {
        updatedMatch.isFinished = true
        const winnerTeamId = match[oppositeKey].id
        const resultType = oppositeKey === "leftTeam" ? "LEFT_WIN" : "RIGHT_WIN"
        saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, true, resultType, winnerTeamId)
      } else {
        saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, false)
      }

      breakSoundsPlayedRef.current.clear()
      const result = resolvePostPoint(prev, matchKey, updatedMatch, isFinished)

      if (isFinished) {
        scheduleGameFinished(match.matchId)
      } else if (result.activeSlot !== prev.activeSlot) {
        scheduleSwitchAnnouncement(prev.activeSlot, result.activeSlot, prev.blockId, updatedMatch.matchId)
      }

      return result
    })
  }, [prime, emitOnce, playSequence, saveScore, scheduleSwitchAnnouncement, state.activeSlot, state.blockId])

  // No point -> termina la jugada sin sumar y sigue el flujo normal.
  const noPoint = useCallback(() => {
    prime()
    emitOnce(`ui:nopoint:real:${state.activeSlot}:${state.blockId}:${Date.now()}`, () =>
      playSequence({ preBeeps: BEEP_2_QUICK, wav: "no-points" })
    )

    setState((prev) => {
      if (!prev.pendingDecision) return prev
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev

      const otherSlot: AXLSlot = slot === "A" ? "B" : "A"
      const otherMatchKey = otherSlot === "A" ? "matchA" : "matchB"
      const otherMatch = prev[otherMatchKey]
      const otherFinished = !otherMatch || otherMatch.isFinished

      breakSoundsPlayedRef.current.clear()

      if (otherFinished) {
        const rules = getRulesForCategory(match.category)
        return {
          ...prev,
          [matchKey]: { ...match, breakTimerSec: getSingleMatchBreakStartSec(rules.singleMatchBreakTimeSec), timerMode: "BREAK" as TimerMode },
          pendingDecision: null,
          singleMatchMode: true,
        }
      }

      const rules = getRulesForCategory(otherMatch!.category)
      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "IDLE" as TimerMode },
        activeSlot: otherSlot,
        pendingDecision: null,
        [otherMatchKey]: { ...otherMatch!, breakTimerSec: rules.breakTimeSec, timerMode: "BREAK" as TimerMode },
      }
    })
  }, [prime, emitOnce, playSequence, state.activeSlot, state.blockId])

  // Reanudar desde una detención manual (sin cerrar la jugada).
  const resumeStoppedGame = useCallback(() => {
    prime()
    emitOnce(`ui:resume:fromStop:${state.activeSlot}:${state.blockId}`, () =>
      playSequence({ preBeeps: BEEP_BREAK_ZERO, wav: "game-start" })
    )

    setState((prev) => {
      if (!prev.pendingDecision?.fromStop) return prev
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match) return prev
      return {
        ...prev,
        [matchKey]: { ...match, timerMode: "GAME" as TimerMode },
        pendingDecision: null,
      }
    })
  }, [prime, emitOnce, playSequence, state.activeSlot, state.blockId])

  const startOvertime = useCallback(() => {
    prime()
    emitOnce(`ui:overtime:start:${state.activeSlot}:${state.blockId}`, () =>
      playSequence({ preBeeps: BEEP_3_LONG, wav: "overtime" })
    )

    setState((prev) => {
      const slot = prev.activeSlot
      const matchKey = slot === "A" ? "matchA" : "matchB"
      const match = prev[matchKey]
      if (!match || !canUseOvertime(match)) return prev
      const isTie = match.leftTeam.score === match.rightTeam.score
      if (!isTie || match.nextOvertimeSec === null) return prev
      return {
        ...prev,
        [matchKey]: {
          ...match,
          timerMode: "GAME" as TimerMode,
          gameTimerSec: match.nextOvertimeSec,
          isOvertime: true,
          nextOvertimeSec: 120,
        },
      }
    })
  }, [prime, emitOnce, playSequence, canUseOvertime, state.activeSlot, state.blockId])

  // Timeout (2 beeps + timeout.wav) y suma 60s al break
  const useTimeout = useCallback(
    (slot: AXLSlot, side: "left" | "right") => {
      prime()

      setState((prev) => {
        const matchKey = slot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev

        const teamKey = side === "left" ? "leftTeam" : "rightTeam"
        if (match[teamKey].timeoutUsed) return prev

        emitOnce(`ui:timeout:${match.matchId}:${teamKey}`, () =>
          playSequence({ preBeeps: BEEP_2_QUICK, wav: "timeout" })
        )

        return {
          ...prev,
          [matchKey]: {
            ...match,
            breakTimerSec: match.breakTimerSec + 60,
            [teamKey]: { ...match[teamKey], timeoutUsed: true },
          },
        }
      })
    },
    [prime, emitOnce, playSequence]
  )

  // Keep live state always synced with control table actions (start/stop/pause/resume/switch)
  useEffect(() => {
    syncLiveState(state)
  }, [state, syncLiveState])

  // Manual score edit
  const setScore = useCallback(
    (side: "left" | "right", newScore: number) => {
      setState((prev) => {
        const slot = prev.activeSlot
        const matchKey = slot === "A" ? "matchA" : "matchB"
        const match = prev[matchKey]
        if (!match) return prev
        const teamKey = side === "left" ? "leftTeam" : "rightTeam"
        const clamped = Math.max(0, Math.min(match.maxPoints, newScore))
        const updated = {
          ...prev,
          [matchKey]: {
            ...match,
            [teamKey]: { ...match[teamKey], score: clamped },
          },
        }
        const updatedMatch = updated[matchKey] as MatchState
        saveScore(match.matchId, updatedMatch.leftTeam.score, updatedMatch.rightTeam.score, match.gameTimerSec, false)
        syncLiveState(updated)
        return updated
      })
    },
    [saveScore, syncLiveState]
  )

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
    startOvertime,
    useTimeout,
  }
}
