import { describe, expect, it } from 'vitest'
import { applyEvent, cardsOf, emptyState, predict, type BoardState } from '../src/shared/state'
import type { Op } from '../src/shared/types'

const run = (state: BoardState, ...ops: Op[]) => ops.reduce(predict, state)
const titles = (s: BoardState, col: string) => cardsOf(s, col).map((c) => c.title)

function base(): BoardState {
  return run(
    emptyState,
    { type: 'column.add', id: 'todo', name: 'Todo', afterId: null },
    { type: 'column.add', id: 'doing', name: 'Doing', afterId: 'todo' },
    { type: 'card.add', id: 'a', columnId: 'todo', title: 'A', afterId: null },
    { type: 'card.add', id: 'b', columnId: 'todo', title: 'B', afterId: 'a' },
    { type: 'card.add', id: 'c', columnId: 'todo', title: 'C', afterId: 'b' },
  )
}

describe('optimistic prediction', () => {
  it('builds columns and cards in order', () => {
    const s = base()
    expect(s.columns.map((c) => c.name)).toEqual(['Todo', 'Doing'])
    expect(titles(s, 'todo')).toEqual(['A', 'B', 'C'])
  })

  it('moves a card within a column and across columns', () => {
    let s = run(base(), { type: 'card.move', id: 'a', columnId: 'todo', afterId: 'c' })
    expect(titles(s, 'todo')).toEqual(['B', 'C', 'A'])
    s = run(s, { type: 'card.move', id: 'b', columnId: 'doing', afterId: null })
    expect(titles(s, 'todo')).toEqual(['C', 'A'])
    expect(titles(s, 'doing')).toEqual(['B'])
  })

  it('reorders columns; deleting a column removes its cards', () => {
    let s = run(base(), { type: 'column.move', id: 'doing', afterId: null })
    expect(s.columns.map((c) => c.id)).toEqual(['doing', 'todo'])
    s = run(s, { type: 'column.delete', id: 'todo' })
    expect(s.cards).toEqual([])
  })

  it('ignores operations that cannot apply (unknown card / column)', () => {
    const s = base()
    expect(run(s, { type: 'card.move', id: 'ghost', columnId: 'todo', afterId: null })).toBe(s)
    expect(run(s, { type: 'card.add', id: 'z', columnId: 'nope', title: 'Z', afterId: null })).toBe(s)
    expect(run(s, { type: 'card.update', id: 'ghost', title: 'x' })).toBe(s)
  })

  it('does not mutate the previous state (React relies on that)', () => {
    const s = base()
    const snapshot = JSON.stringify(s)
    run(s, { type: 'card.move', id: 'a', columnId: 'doing', afterId: null }, { type: 'card.delete', id: 'b' })
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})

describe('applying server events', () => {
  it('is idempotent: the same event twice changes nothing more', () => {
    const s = base()
    const ev = { type: 'card.added', card: { id: 'n', columnId: 'todo', title: 'N', description: '', position: 'a5', version: 1 } } as const
    const once = applyEvent(s, ev)
    expect(applyEvent(once, ev)).toBe(once)
  })

  it('events about things that are already gone are harmless', () => {
    const s = base()
    expect(applyEvent(s, { type: 'card.deleted', id: 'ghost' }).cards).toHaveLength(3)
    expect(applyEvent(s, { type: 'card.moved', id: 'ghost', columnId: 'todo', position: 'a0', version: 2 }).cards).toHaveLength(3)
  })

  it('the server\'s resolved position wins over the optimistic one', () => {
    const s = run(base(), { type: 'card.move', id: 'a', columnId: 'todo', afterId: 'c' }) // predicted: B C A
    const real = applyEvent(s, { type: 'card.moved', id: 'a', columnId: 'todo', position: 'a0V', version: 2 }) // server put it first
    expect(titles(real, 'todo')[0]).toBe('A')
  })
})
