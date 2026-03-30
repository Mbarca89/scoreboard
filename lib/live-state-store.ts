import type { MatchLiveState } from "@/lib/types"

type Listener = (state: MatchLiveState | null) => void

type LiveStateStore = {
  states: Map<string, MatchLiveState>
  listeners: Map<string, Set<Listener>>
}

const globalStore = globalThis as typeof globalThis & { __axlLiveStateStore?: LiveStateStore }

const store: LiveStateStore =
  globalStore.__axlLiveStateStore ??
  (globalStore.__axlLiveStateStore = {
    states: new Map<string, MatchLiveState>(),
    listeners: new Map<string, Set<Listener>>(),
  })

export function getLiveState(eventId: string): MatchLiveState | null {
  return store.states.get(eventId) ?? null
}

export function setLiveState(eventId: string, state: Omit<MatchLiveState, "updated_at"> & { updated_at?: string }): MatchLiveState {
  const fullState: MatchLiveState = {
    ...state,
    updated_at: state.updated_at ?? new Date().toISOString(),
  }

  store.states.set(eventId, fullState)
  const set = store.listeners.get(eventId)
  if (set) {
    for (const listener of set) listener(fullState)
  }
  return fullState
}

export function subscribeLiveState(eventId: string, listener: Listener): () => void {
  let set = store.listeners.get(eventId)
  if (!set) {
    set = new Set<Listener>()
    store.listeners.set(eventId, set)
  }
  set.add(listener)

  return () => {
    const current = store.listeners.get(eventId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      store.listeners.delete(eventId)
    }
  }
}
