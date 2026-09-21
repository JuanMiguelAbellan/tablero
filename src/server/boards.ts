import { createHash, randomBytes } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { keyAfter } from '../shared/order.js'
import type { BoardEvent, Card, Column, Member, Op, Role, Snapshot } from '../shared/types.js'
import { isPgError, query, UNIQUE_VIOLATION, withTransaction, FOREIGN_KEY_VIOLATION } from './db.js'
import { HttpError, notFound } from './errors.js'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ------------------------------------------------------------------ validation of client operations

const id = z.uuid()
const after = z.uuid().nullable()
const name = z.string().trim().min(1).max(80)
const title = z.string().trim().min(1).max(200)

export const opSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('column.add'), id, name, afterId: after }),
  z.strictObject({ type: z.literal('column.rename'), id, name }),
  z.strictObject({ type: z.literal('column.delete'), id }),
  z.strictObject({ type: z.literal('column.move'), id, afterId: after }),
  z.strictObject({ type: z.literal('card.add'), id, columnId: id, title, afterId: after }),
  z.strictObject({ type: z.literal('card.update'), id, title: title.optional(), description: z.string().max(5000).optional() }),
  z.strictObject({ type: z.literal('card.delete'), id }),
  z.strictObject({ type: z.literal('card.move'), id, columnId: id, afterId: after }),
])
export const opIdSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/)

// ------------------------------------------------------------------ boards

export async function listBoards(userId: string) {
  const r = await query(
    `SELECT b.id, b.name, m.role FROM boards b JOIN board_members m ON m.board_id = b.id WHERE m.user_id = $1 ORDER BY b.created_at DESC`,
    [userId],
  )
  return r.rows as { id: string; name: string; role: Role }[]
}

export async function createBoard(userId: string, boardName: string): Promise<string> {
  return withTransaction(async (db) => {
    const b = await db.query('INSERT INTO boards (owner_id, name) VALUES ($1,$2) RETURNING id', [userId, boardName])
    const boardId: string = b.rows[0].id
    await db.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,'owner')", [boardId, userId])
    let previous: string | null = null
    for (const n of ['Por hacer', 'En curso', 'Hecho']) {
      const position = keyAfter(previous === null ? [] : [{ id: 'p', position: previous }], previous === null ? null : 'p')
      await db.query('INSERT INTO columns (id, board_id, name, position) VALUES (gen_random_uuid(), $1, $2, $3)', [boardId, n, position])
      previous = position
    }
    return boardId
  })
}

/** The caller's role on a board, or null if they are not a member. Non-members get "not found" everywhere: the
 *  existence of a board is not revealed to people who cannot see it. */
export async function roleOf(db: Pick<pg.Pool, 'query'>, boardId: string, userId: string): Promise<Role | null> {
  const r = await db.query('SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2', [boardId, userId])
  return r.rows[0]?.role ?? null
}

/** Board state and the sequence number it corresponds to, read from ONE consistent snapshot: the event stream can then
 *  continue exactly after `seq`, with nothing missing and nothing repeated. */
export async function getSnapshot(userId: string, boardId: string): Promise<Snapshot> {
  if (!z.uuid().safeParse(boardId).success) throw notFound()
  return withTransaction(async (db) => {
    const role = await roleOf(db, boardId, userId)
    if (!role) throw notFound()
    const [board, cols, cards, members, seq] = await Promise.all([
      db.query('SELECT id, name FROM boards WHERE id = $1', [boardId]),
      db.query('SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position', [boardId]),
      db.query('SELECT id, column_id, title, description, position, version FROM cards WHERE board_id = $1 ORDER BY position', [boardId]),
      db.query('SELECT m.user_id, u.name, m.role FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1 ORDER BY u.name', [boardId]),
      db.query('SELECT COALESCE(max(seq), 0)::bigint AS seq FROM events WHERE board_id = $1', [boardId]),
    ])
    return {
      board: board.rows[0],
      role,
      columns: cols.rows as Column[],
      cards: cards.rows.map((c): Card => ({ id: c.id, columnId: c.column_id, title: c.title, description: c.description, position: c.position, version: c.version })),
      members: members.rows.map((m): Member => ({ userId: m.user_id, name: m.name, role: m.role })),
      seq: Number(seq.rows[0].seq),
    }
  }, 'ISOLATION LEVEL REPEATABLE READ READ ONLY')
}

// ------------------------------------------------------------------ operations

export interface OpResult {
  seq: number
}

/**
 * Apply one operation. Everything happens in one transaction, serialised per board by a row lock, so:
 *  - two people editing the same board never interleave halfway (positions cannot collide);
 *  - events get sequence numbers in the same order they were committed;
 *  - the data change, its events and the idempotency record succeed or fail together.
 */
export async function applyOp(userId: string, boardId: string, opId: string, op: Op): Promise<OpResult> {
  if (!z.uuid().safeParse(boardId).success) throw notFound()
  return withTransaction(async (db) => {
    const locked = await db.query('SELECT id FROM boards WHERE id = $1 FOR UPDATE', [boardId])
    if (!locked.rowCount) throw notFound()
    const role = await roleOf(db, boardId, userId)
    if (!role) throw notFound()
    if (role === 'viewer') throw new HttpError(403, 'Solo lectura: no puedes modificar este tablero')

    const done = await db.query('SELECT response FROM ops WHERE board_id = $1 AND op_id = $2', [boardId, opId])
    if (done.rows[0]) return done.rows[0].response as OpResult // a retry of something already applied

    const events: BoardEvent[] = []
    try {
      await execute(db, boardId, op, events)
    } catch (e) {
      // Ids are chosen by the client. If one already exists (anywhere), refuse without saying where.
      if (isPgError(e, UNIQUE_VIOLATION) && (e as { constraint?: string }).constraint?.endsWith('_pkey')) throw new HttpError(409, 'Conflicto')
      if (isPgError(e, FOREIGN_KEY_VIOLATION)) throw notFound()
      throw e
    }

    let seq = 0
    for (const ev of events) {
      const r = await db.query('INSERT INTO events (board_id, type, payload, actor_id, op_id) VALUES ($1,$2,$3,$4,$5) RETURNING seq', [boardId, ev.type, JSON.stringify(ev), userId, opId])
      seq = Number(r.rows[0].seq)
    }
    if (!seq) seq = Number((await db.query('SELECT COALESCE(max(seq), 0) AS seq FROM events WHERE board_id = $1', [boardId])).rows[0].seq)
    const response: OpResult = { seq }
    await db.query('INSERT INTO ops (board_id, op_id, response) VALUES ($1,$2,$3)', [boardId, opId, JSON.stringify(response)])
    if (events.length) await db.query("SELECT pg_notify('board_events', $1)", [JSON.stringify({ b: boardId, s: seq })]) // delivered on COMMIT
    return response
  })
}

async function execute(db: pg.PoolClient, boardId: string, op: Op, out: BoardEvent[]): Promise<void> {
  switch (op.type) {
    case 'column.add': {
      const siblings = (await db.query('SELECT id, position FROM columns WHERE board_id = $1 ORDER BY position', [boardId])).rows
      const position = keyAfter(siblings, op.afterId)
      await db.query('INSERT INTO columns (id, board_id, name, position) VALUES ($1,$2,$3,$4)', [op.id, boardId, op.name, position])
      out.push({ type: 'column.added', column: { id: op.id, name: op.name, position } })
      return
    }
    case 'column.rename': {
      const r = await db.query('UPDATE columns SET name = $3 WHERE id = $1 AND board_id = $2', [op.id, boardId, op.name])
      if (!r.rowCount) throw notFound()
      out.push({ type: 'column.renamed', id: op.id, name: op.name })
      return
    }
    case 'column.delete': {
      const r = await db.query('DELETE FROM columns WHERE id = $1 AND board_id = $2', [op.id, boardId]) // its cards go with it
      if (!r.rowCount) throw notFound()
      out.push({ type: 'column.deleted', id: op.id })
      return
    }
    case 'column.move': {
      const exists = await db.query('SELECT 1 FROM columns WHERE id = $1 AND board_id = $2', [op.id, boardId])
      if (!exists.rowCount) throw notFound()
      if (op.afterId === op.id) return // dropped on itself: nothing to do
      const siblings = (await db.query('SELECT id, position FROM columns WHERE board_id = $1 ORDER BY position', [boardId])).rows
      const position = keyAfter(siblings, op.afterId, op.id)
      await db.query('UPDATE columns SET position = $2 WHERE id = $1', [op.id, position])
      out.push({ type: 'column.moved', id: op.id, position })
      return
    }
    case 'card.add': {
      const col = await db.query('SELECT 1 FROM columns WHERE id = $1 AND board_id = $2', [op.columnId, boardId])
      if (!col.rowCount) throw notFound()
      const siblings = (await db.query('SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position', [op.columnId])).rows
      const position = keyAfter(siblings, op.afterId)
      await db.query('INSERT INTO cards (id, board_id, column_id, title, position) VALUES ($1,$2,$3,$4,$5)', [op.id, boardId, op.columnId, op.title, position])
      out.push({ type: 'card.added', card: { id: op.id, columnId: op.columnId, title: op.title, description: '', position, version: 1 } })
      return
    }
    case 'card.update': {
      const r = await db.query(
        `UPDATE cards SET title = COALESCE($3, title), description = COALESCE($4, description), version = version + 1, updated_at = now()
          WHERE id = $1 AND board_id = $2 RETURNING title, description, version`,
        [op.id, boardId, op.title ?? null, op.description ?? null],
      )
      if (!r.rowCount) throw notFound()
      out.push({ type: 'card.updated', id: op.id, title: r.rows[0].title, description: r.rows[0].description, version: r.rows[0].version })
      return
    }
    case 'card.delete': {
      const r = await db.query('DELETE FROM cards WHERE id = $1 AND board_id = $2', [op.id, boardId])
      if (!r.rowCount) throw notFound()
      out.push({ type: 'card.deleted', id: op.id })
      return
    }
    case 'card.move': {
      const card = await db.query('SELECT 1 FROM cards WHERE id = $1 AND board_id = $2', [op.id, boardId])
      const col = await db.query('SELECT 1 FROM columns WHERE id = $1 AND board_id = $2', [op.columnId, boardId])
      if (!card.rowCount || !col.rowCount) throw notFound()
      if (op.afterId === op.id) return
      const siblings = (await db.query('SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position', [op.columnId])).rows
      const position = keyAfter(siblings, op.afterId, op.id)
      const r = await db.query('UPDATE cards SET column_id = $2, position = $3, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version', [op.id, op.columnId, position])
      out.push({ type: 'card.moved', id: op.id, columnId: op.columnId, position, version: r.rows[0].version })
      return
    }
  }
}

// ------------------------------------------------------------------ sharing

const INVITE_HOURS = 72

export async function createInvite(userId: string, boardId: string, role: 'editor' | 'viewer'): Promise<{ token: string; expiresAt: Date }> {
  if (!z.uuid().safeParse(boardId).success) throw notFound()
  const mine = await roleOf({ query } as never, boardId, userId)
  if (!mine) throw notFound()
  if (mine !== 'owner') throw new HttpError(403, 'Solo el propietario puede invitar')
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + INVITE_HOURS * 3_600_000)
  await query('INSERT INTO invites (token_hash, board_id, role, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)', [sha256(token), boardId, role, userId, expiresAt])
  return { token, expiresAt }
}

export async function previewInvite(token: string): Promise<{ boardName: string; role: string } | null> {
  const r = await query('SELECT b.name, i.role FROM invites i JOIN boards b ON b.id = i.board_id WHERE i.token_hash = $1 AND i.expires_at > now()', [sha256(token)])
  return r.rows[0] ? { boardName: r.rows[0].name, role: r.rows[0].role } : null
}

/** Join a board through an invite link. Never downgrades an existing member (an owner clicking a viewer link stays owner). */
export async function acceptInvite(userId: string, token: string): Promise<string> {
  return withTransaction(async (db) => {
    const inv = await db.query('SELECT board_id, role FROM invites WHERE token_hash = $1 AND expires_at > now()', [sha256(token)])
    if (!inv.rows[0]) throw notFound()
    const { board_id: boardId, role } = inv.rows[0]
    const ins = await db.query('INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id', [boardId, userId, role])
    if (ins.rowCount) {
      const u = await db.query('SELECT name FROM users WHERE id = $1', [userId])
      const member: Member = { userId, name: u.rows[0].name, role }
      const ev = await db.query('INSERT INTO events (board_id, type, payload, actor_id) VALUES ($1,$2,$3,$4) RETURNING seq', [boardId, 'member.joined', JSON.stringify({ type: 'member.joined', member }), userId])
      await db.query("SELECT pg_notify('board_events', $1)", [JSON.stringify({ b: boardId, s: Number(ev.rows[0].seq) })])
    }
    return boardId as string
  })
}
