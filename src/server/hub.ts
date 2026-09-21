import pg from 'pg'
import type { BoardEvent, StreamedEvent } from '../shared/types.js'
import { databaseUrl, query } from './db.js'

interface Subscription {
  boardId: string
  lastSeq: number
  write: (e: StreamedEvent) => void
  busy: boolean
  dirty: boolean
  closed: boolean
}

const BATCH = 500
const SAFETY_FLUSH_MS = 15_000

/**
 * Fan-out of board events to open SSE connections.
 *
 * Postgres is the source of truth and the message bus: a committed change fires NOTIFY, every server instance is
 * LISTENing, and each then reads "events after the last one this connection got" from the events table. Because
 * delivery is driven by the table (not by the notification's payload), a lost, duplicated or late notification can
 * only delay an update, never lose one — and a reconnecting client simply asks for everything after its last seq.
 */
export class EventHub {
  private subs = new Set<Subscription>()
  private listener: pg.Client | null = null
  private stopped = false
  private timer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
    await this.connect()
    this.timer = setInterval(() => this.flushAll(), SAFETY_FLUSH_MS)
    this.timer.unref()
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: databaseUrl() })
    client.on('notification', (m) => {
      try {
        const { b } = JSON.parse(m.payload ?? '{}') as { b?: string }
        for (const s of this.subs) if (s.boardId === b) void this.flush(s)
      } catch {
        this.flushAll() // unreadable payload: fall back to checking everyone
      }
    })
    client.on('error', () => this.reconnect(client))
    client.on('end', () => this.reconnect(client))
    await client.connect()
    await client.query('LISTEN board_events')
    this.listener = client
  }

  private reconnect(dead: pg.Client) {
    if (this.stopped || this.listener !== dead) return
    this.listener = null
    dead.removeAllListeners()
    dead.end().catch(() => {})
    const retry = () => {
      if (this.stopped) return
      this.connect().then(() => this.flushAll()).catch(() => setTimeout(retry, 1000)) // catch up on anything missed meanwhile
    }
    setTimeout(retry, 500)
  }

  /** Start streaming events with seq > sinceSeq. Missed events are delivered immediately. */
  subscribe(boardId: string, sinceSeq: number, write: (e: StreamedEvent) => void): { close: () => void } {
    const sub: Subscription = { boardId, lastSeq: sinceSeq, write, busy: false, dirty: false, closed: false }
    this.subs.add(sub)
    void this.flush(sub)
    return { close: () => { sub.closed = true; this.subs.delete(sub) } }
  }

  get connections(): number {
    return this.subs.size
  }

  private flushAll() {
    for (const s of this.subs) void this.flush(s)
  }

  private async flush(sub: Subscription): Promise<void> {
    if (sub.busy) {
      sub.dirty = true // another flush is running: make it go around once more
      return
    }
    sub.busy = true
    try {
      do {
        sub.dirty = false
        const r = await query('SELECT seq, payload, actor_id, op_id FROM events WHERE board_id = $1 AND seq > $2 ORDER BY seq LIMIT $3', [sub.boardId, sub.lastSeq, BATCH])
        for (const row of r.rows) {
          if (sub.closed) return
          sub.write({ seq: Number(row.seq), opId: row.op_id, actorId: row.actor_id, event: row.payload as BoardEvent })
          sub.lastSeq = Number(row.seq)
        }
        if (r.rows.length === BATCH) sub.dirty = true
      } while (sub.dirty && !sub.closed)
    } catch {
      // A transient DB error: the safety flush (or the next notification) retries from the same lastSeq.
    } finally {
      sub.busy = false
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.subs.clear()
    const l = this.listener
    this.listener = null
    if (l) {
      l.removeAllListeners()
      await l.end().catch(() => {})
    }
  }
}
