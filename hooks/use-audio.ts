"use client"

import { useCallback, useEffect, useRef } from "react"

export type SoundName =
  | "1-minute"
  | "2-minutes"
  | "10-seconds"
  | "20-seconds"
  | "30-seconds"
  | "60-seconds"
  | "base"
  | "concede"
  | "game-finished"
  | "game-start"
  | "game-stop"
  | "game-time-finished"
  | "no-points"
  | "overtime"
  | "point-approved"
  | "reverse-point"
  | "timeout"
  | "time-over"
  | "towel"

export type BeepSpec = {
  freq: number
  duration: number // seconds
  count: number
  silence?: number // seconds between beeps
  type?: OscillatorType
  gain?: number
}

const SOUND_FILES: Record<SoundName, string> = {
  "1-minute": "/sounds/1-minute.wav",
  "2-minutes": "/sounds/2-minutes.wav",
  "10-seconds": "/sounds/10-seconds.wav",
  "20-seconds": "/sounds/20-seconds.wav",
  "30-seconds": "/sounds/30-seconds.wav",
  "60-seconds": "/sounds/60-seconds.wav",
  base: "/sounds/base.wav",
  concede: "/sounds/concede.wav",
  "game-finished": "/sounds/game-finished.wav",
  "game-start": "/sounds/game-start.wav",
  "game-stop": "/sounds/game-stop.wav",
  "game-time-finished": "/sounds/game-time-finished.wav",
  "no-points": "/sounds/no-points.wav",
  overtime: "/sounds/overtime.wav",
  "point-approved": "/sounds/point-approved.wav",
  "reverse-point": "/sounds/reverse-point.wav",
  timeout: "/sounds/timeout.wav",
  "time-over": "/sounds/time-over.wav",
  towel: "/sounds/towel.wav",
}

function beepDurationSeconds(spec: BeepSpec) {
  const silence = spec.silence ?? 0.08
  return spec.count * spec.duration + (spec.count - 1) * silence
}

function playBeepAsync(ctx: AudioContext, spec: BeepSpec): Promise<void> {
  const silence = spec.silence ?? 0.08
  const type = spec.type ?? "sine"
  const gainValue = spec.gain ?? 0.25
  const now = ctx.currentTime

  for (let i = 0; i < spec.count; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = type
    osc.frequency.value = spec.freq
    gain.gain.value = gainValue

    osc.connect(gain)
    gain.connect(ctx.destination)

    const start = now + i * (spec.duration + silence)
    osc.start(start)
    osc.stop(start + spec.duration)
  }

  const total = beepDurationSeconds(spec)
  return new Promise((res) => setTimeout(res, Math.ceil(total * 1000)))
}

function playWavAsync(a: HTMLAudioElement): Promise<void> {
  a.pause()
  a.currentTime = 0

  return new Promise<void>((resolve) => {
    const onEnded = () => {
      a.removeEventListener("ended", onEnded)
      resolve()
    }
    a.addEventListener("ended", onEnded)
    a.play().catch(() => {
      a.removeEventListener("ended", onEnded)
      resolve()
    })
  })
}

export function useAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioCacheRef = useRef<Map<SoundName, HTMLAudioElement>>(new Map())

  // cola: encadenamos promesas (sin solape)
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    ;(Object.keys(SOUND_FILES) as SoundName[]).forEach((name) => {
      const a = new Audio(SOUND_FILES[name])
      a.preload = "auto"
      audioCacheRef.current.set(name, a)
    })
  }, [])

  const prime = useCallback(async () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume()
    }
  }, [])

  const enqueue = useCallback((task: () => Promise<void>) => {
    queueRef.current = queueRef.current.catch(() => {}).then(task)
    return queueRef.current
  }, [])

  const playWav = useCallback(
    (name: SoundName) => {
      return enqueue(async () => {
        await prime()
        const a = audioCacheRef.current.get(name)
        if (!a) return
        await playWavAsync(a)
      })
    },
    [enqueue, prime]
  )

  const playBeeps = useCallback(
    (spec: BeepSpec) => {
      return enqueue(async () => {
        await prime()
        if (!audioCtxRef.current) return
        await playBeepAsync(audioCtxRef.current, spec)
      })
    },
    [enqueue, prime]
  )

  const playSequence = useCallback(
    (opts: { preBeeps?: BeepSpec | BeepSpec[]; wav?: SoundName }) => {
      return enqueue(async () => {
        await prime()
        const ctx = audioCtxRef.current
        if (!ctx) return

        const beeps = Array.isArray(opts.preBeeps)
          ? opts.preBeeps
          : opts.preBeeps
            ? [opts.preBeeps]
            : []

        for (const b of beeps) {
          await playBeepAsync(ctx, b)
        }

        if (opts.wav) {
          const a = audioCacheRef.current.get(opts.wav)
          if (!a) return
          await playWavAsync(a)
        }
      })
    },
    [enqueue, prime]
  )

  return { prime, playWav, playBeeps, playSequence }
}