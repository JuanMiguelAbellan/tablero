import { describe, expect, it } from 'vitest'
import { cardsOf } from '../src/shared/state'
import { initialSync, syncReducer, view, type SyncAction, type SyncState } from '../src/shared/sync'
import type { Op, Snapshot, StreamedEvent } from '../src/shared/types'

const snapshot: Snapshot = {
  board: { id: 'b', name: 'B' }, role: 'owner', members: [], seq: 10,
  columns: [{ id: 'todo', name: 'Todo', position: 'a0' }, { id: 'done', name: 'Done', position: 'a1' }],
  cards: [{ id: 'c1', columnId: 'todo', title: 'C1', description: '', position: 'a0', version: 1 }],
}
const run = (...actions: SyncAction[]): SyncState => actions.reduce(syncReducer, initialSync)
const load: SyncAction = { type: 'load', snapshot }
const ev = (seq: number, event: StreamedEvent['event'], opId: string | null = null): SyncAction => ({ type: 'event', event: { seq, opId, actorId: null, event } })
const titles = (s: SyncState, col: string) => cardsOf(view(s), col).map((c) => c.title)
const addOp: Op = { type: 'card.add', id: 'c2', columnId: 'todo', title: 'C2', afterId: 'c1' }
const added = { type: 'card.added', card: { id: 'c2', columnId: 'todo', title: 'C2', description: '', position: 'a1', version: 1 } } as const

describe('optimistic sync', () => {
  it('a queued operation shows immediately', () => {
    expect(titles(run(load, { type: 'queue', opId: 'o1', op: addOp }), 'todo')).toEqual(['C1', 'C2'])
  })

  it('ack first, then the event: no flicker, and the prediction is dropped only when the real event is applied', () => {
    let s = run(load, { type: 'queue', opId: 'o1', op: addOp }, { type: 'ack', opId: 'o1', seq: 11 })
    expect(s.pending).toHaveLength(1) // accepted but the event has not arrived: keep predicting
    expect(titles(s, 'todo')).toEqual(['C1', 'C2'])
    s = syncReducer(s, ev(11, added, 'o1'))
    expect(s.pending).toHaveLength(0)
    expect(titles(s, 'todo')).toEqual(['C1', 'C2'])
  })

  it('event first, then the ack: the card is never duplicated', () => {
    let s = run(load, { type: 'queue', opId: 'o1', op: addOp }, ev(11, added, 'o1'))
    expect(titles(s, 'todo')).toEqual(['C1', 'C2'])
    s = syncReducer(s, { type: 'ack', opId: 'o1', seq: 11 })
    expect(s.pending).toHaveLength(0)
    expect(cardsOf(view(s), 'todo')).toHaveLength(2)
  })

  it('a rejected operation rolls back cleanly', () => {
    const s = run(load, { type: 'queue', opId: 'o1', op: addOp }, { type: 'reject', opId: 'o1' })
    expect(titles(s, 'todo')).toEqual(['C1'])
  })

  it('other people\'s changes merge with my pending ones', () => {
    const theirs = ev(11, { type: 'card.added', card: { id: 'x', columnId: 'todo', title: 'Ajena', description: '', position: 'a2', version: 1 } })
    const s = run(load, { type: 'queue', opId: 'o1', op: addOp }, theirs)
    expect(titles(s, 'todo')).toEqual(['C1', 'C2', 'Ajena'])
  })

  it('duplicate or old events (a replay after reconnecting) are ignored', () => {
    const s = run(load, ev(11, added), ev(11, added), ev(10, { type: 'card.deleted', id: 'c1' }), ev(9, { type: 'card.deleted', id: 'c1' }))
    expect(s.applied).toBe(11)
    expect(cardsOf(view(s), 'todo')).toHaveLength(2) // the stale "delete c1" events did nothing
  })

  it('a fresh snapshot keeps operations that are still in flight', () => {
    const s = run(load, { type: 'queue', opId: 'o1', op: addOp }, load)
    expect(titles(s, 'todo')).toEqual(['C1', 'C2'])
  })

  it('a move I made while someone else deleted the card ends as a harmless no-op', () => {
    const move: Op = { type: 'card.move', id: 'c1', columnId: 'done', afterId: null }
    const s = run(load, { type: 'queue', opId: 'o1', op: move }, ev(11, { type: 'card.deleted', id: 'c1' }))
    expect(view(s).cards).toHaveLength(0)
    expect(syncReducer(s, { type: 'reject', opId: 'o1' }).pending).toHaveLength(0)
  })
})
