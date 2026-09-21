import { byPosition, keyAfter } from './order'
import type { BoardEvent, Card, Column, Op } from './types'

export interface BoardState {
  columns: Column[] // sorted by position
  cards: Card[] // sorted by position (within a column, by filtering)
}

export const emptyState: BoardState = { columns: [], cards: [] }

const sortedColumns = (cs: Column[]) => [...cs].sort(byPosition)
const sortedCards = (cs: Card[]) => [...cs].sort(byPosition)

/** Apply an event that the server has already resolved. Pure: returns a new state. Unknown ids are ignored, so applying
 *  the same event twice, or an event about something already gone, is harmless. */
export function applyEvent(state: BoardState, ev: BoardEvent): BoardState {
  switch (ev.type) {
    case 'column.added':
      return state.columns.some((c) => c.id === ev.column.id) ? state : { ...state, columns: sortedColumns([...state.columns, ev.column]) }
    case 'column.renamed':
      return { ...state, columns: state.columns.map((c) => (c.id === ev.id ? { ...c, name: ev.name } : c)) }
    case 'column.deleted':
      return { columns: state.columns.filter((c) => c.id !== ev.id), cards: state.cards.filter((c) => c.columnId !== ev.id) }
    case 'column.moved':
      return { ...state, columns: sortedColumns(state.columns.map((c) => (c.id === ev.id ? { ...c, position: ev.position } : c))) }
    case 'card.added':
      return state.cards.some((c) => c.id === ev.card.id) ? state : { ...state, cards: sortedCards([...state.cards, ev.card]) }
    case 'card.updated':
      return { ...state, cards: state.cards.map((c) => (c.id === ev.id ? { ...c, title: ev.title, description: ev.description, version: ev.version } : c)) }
    case 'card.deleted':
      return { ...state, cards: state.cards.filter((c) => c.id !== ev.id) }
    case 'card.moved':
      return { ...state, cards: sortedCards(state.cards.map((c) => (c.id === ev.id ? { ...c, columnId: ev.columnId, position: ev.position, version: ev.version } : c))) }
    case 'member.joined':
      return state
  }
}

/**
 * The client's prediction of what an operation will do, used to show the change instantly. It mirrors what the server
 * does (same `keyAfter`), so in the normal case the server's answer matches and nothing visibly changes when it arrives.
 * Returns the state unchanged when the operation makes no sense here (the server would reject it too).
 */
export function predict(state: BoardState, op: Op): BoardState {
  switch (op.type) {
    case 'column.add':
      return applyEvent(state, { type: 'column.added', column: { id: op.id, name: op.name, position: keyAfter(state.columns, op.afterId) } })
    case 'column.rename':
      return applyEvent(state, { type: 'column.renamed', id: op.id, name: op.name })
    case 'column.delete':
      return applyEvent(state, { type: 'column.deleted', id: op.id })
    case 'column.move':
      return applyEvent(state, { type: 'column.moved', id: op.id, position: keyAfter(state.columns, op.afterId, op.id) })
    case 'card.add': {
      if (!state.columns.some((c) => c.id === op.columnId)) return state
      const siblings = state.cards.filter((c) => c.columnId === op.columnId)
      return applyEvent(state, { type: 'card.added', card: { id: op.id, columnId: op.columnId, title: op.title, description: '', position: keyAfter(siblings, op.afterId), version: 1 } })
    }
    case 'card.update': {
      const card = state.cards.find((c) => c.id === op.id)
      return card ? applyEvent(state, { type: 'card.updated', id: op.id, title: op.title ?? card.title, description: op.description ?? card.description, version: card.version }) : state
    }
    case 'card.delete':
      return applyEvent(state, { type: 'card.deleted', id: op.id })
    case 'card.move': {
      const card = state.cards.find((c) => c.id === op.id)
      if (!card || !state.columns.some((c) => c.id === op.columnId)) return state
      const siblings = state.cards.filter((c) => c.columnId === op.columnId)
      return applyEvent(state, { type: 'card.moved', id: op.id, columnId: op.columnId, position: keyAfter(siblings, op.afterId, op.id), version: card.version })
    }
  }
}

export const cardsOf = (state: BoardState, columnId: string): Card[] => state.cards.filter((c) => c.columnId === columnId)
