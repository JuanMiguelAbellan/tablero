import { applyEvent, emptyState, predict, type BoardState } from './state'
import type { Op, Snapshot, StreamedEvent } from './types'

/** An operation the user performed that the server has not yet confirmed (and whose effect we therefore predict). */
export interface Pending {
  opId: string
  op: Op
  /** Set once the server accepted it: the seq of the last event it produced. The prediction is dropped when the real
   *  events up to that seq have been applied — never earlier (it would flicker) and never later (it would linger). */
  ackSeq?: number
}

export interface SyncState {
  server: BoardState
  /** Highest event seq applied to `server`. Events at or below it are duplicates and are ignored. */
  applied: number
  pending: Pending[]
}

export type SyncAction =
  | { type: 'load'; snapshot: Snapshot }
  | { type: 'event'; event: StreamedEvent }
  | { type: 'queue'; opId: string; op: Op }
  | { type: 'ack'; opId: string; seq: number }
  | { type: 'reject'; opId: string }

export const initialSync: SyncState = { server: emptyState, applied: 0, pending: [] }

const settle = (s: SyncState): SyncState => {
  const pending = s.pending.filter((p) => p.ackSeq === undefined || p.ackSeq > s.applied)
  return pending.length === s.pending.length ? s : { ...s, pending }
}

export function syncReducer(state: SyncState, action: SyncAction): SyncState {
  switch (action.type) {
    case 'load':
      // A fresh snapshot replaces the server state; operations still in flight stay on top of it.
      return settle({ server: { columns: action.snapshot.columns, cards: action.snapshot.cards }, applied: action.snapshot.seq, pending: state.pending })
    case 'event': {
      if (action.event.seq <= state.applied) return state // already have it (reconnects replay from the last seq we saw)
      return settle({ ...state, server: applyEvent(state.server, action.event.event), applied: action.event.seq })
    }
    case 'queue':
      return { ...state, pending: [...state.pending, { opId: action.opId, op: action.op }] }
    case 'ack':
      return settle({ ...state, pending: state.pending.map((p) => (p.opId === action.opId ? { ...p, ackSeq: action.seq } : p)) })
    case 'reject':
      return { ...state, pending: state.pending.filter((p) => p.opId !== action.opId) } // the prediction disappears: the UI rolls back
  }
}

/** What the user sees: the server's state with every unconfirmed operation replayed on top. */
export const view = (s: SyncState): BoardState => s.pending.reduce((st, p) => predict(st, p.op), s.server)
