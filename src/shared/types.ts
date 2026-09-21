export type Role = 'owner' | 'editor' | 'viewer'

export interface Column {
  id: string
  name: string
  position: string
}

export interface Card {
  id: string
  columnId: string
  title: string
  description: string
  position: string
  version: number
}

export interface Member {
  userId: string
  name: string
  role: Role
}

export interface Snapshot {
  board: { id: string; name: string }
  role: Role
  columns: Column[]
  cards: Card[]
  members: Member[]
  /** Highest event seq included in this snapshot: the event stream continues after it. */
  seq: number
}

/** What a client asks the server to do. `id`s of new things are chosen by the client so an optimistic copy and the
 *  authoritative one are the same object. `afterId` is "place right after this sibling" (null = first). */
export type Op =
  | { type: 'column.add'; id: string; name: string; afterId: string | null }
  | { type: 'column.rename'; id: string; name: string }
  | { type: 'column.delete'; id: string }
  | { type: 'column.move'; id: string; afterId: string | null }
  | { type: 'card.add'; id: string; columnId: string; title: string; afterId: string | null }
  | { type: 'card.update'; id: string; title?: string; description?: string }
  | { type: 'card.delete'; id: string }
  | { type: 'card.move'; id: string; columnId: string; afterId: string | null }

/** What the server tells everyone after a change (already resolved: real positions, new versions). */
export type BoardEvent =
  | { type: 'column.added'; column: Column }
  | { type: 'column.renamed'; id: string; name: string }
  | { type: 'column.deleted'; id: string }
  | { type: 'column.moved'; id: string; position: string }
  | { type: 'card.added'; card: Card }
  | { type: 'card.updated'; id: string; title: string; description: string; version: number }
  | { type: 'card.deleted'; id: string }
  | { type: 'card.moved'; id: string; columnId: string; position: string; version: number }
  | { type: 'member.joined'; member: Member }

/** An event as stored and streamed: with its sequence number and the operation (if any) that caused it. */
export interface StreamedEvent {
  seq: number
  opId: string | null
  actorId: string | null
  event: BoardEvent
}
