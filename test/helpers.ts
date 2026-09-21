import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../src/server/app'
import { pool } from '../src/server/db'
import { EventHub } from '../src/server/hub'
import type { Op, Snapshot, StreamedEvent } from '../src/shared/types'

export const uid = () => randomBytes(4).toString('hex')

export async function startApp() {
  const hub = new EventHub()
  await hub.start()
  const app = await buildApp({ hub })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  return {
    baseUrl,
    hub,
    app,
    async close() {
      await hub.stop()
      await app.close()
      await pool().end()
    },
  }
}

/** A tiny HTTP client with a cookie jar that always sends the CSRF header, like the real front-end does. */
export class Client {
  cookie = ''
  constructor(readonly baseUrl: string) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tablero', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      // Fastify refuses an empty body under content-type: application/json, so body-less POSTs send {} (as the front-end does).
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]!.includes('=') && !/^sid=;/.test(set) ? set.split(';')[0]! : ''
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers }
  }

  static async signUp(baseUrl: string, name = 'Persona') {
    const c = new Client(baseUrl)
    const email = `u-${uid()}@test.dev`
    const r = await c.call('POST', '/api/auth/register', { email, name, password: 'contraseña-larga' })
    if (r.status !== 200) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.json)}`)
    return Object.assign(c, { email, userId: r.json.user.id as string, name })
  }

  async newBoard(name = 'Tablero'): Promise<{ id: string; snapshot: Snapshot }> {
    const { json } = await this.call('POST', '/api/boards', { name })
    return { id: json.id, snapshot: await this.snapshot(json.id) }
  }

  async snapshot(boardId: string): Promise<Snapshot> {
    return (await this.call('GET', `/api/boards/${boardId}`)).json
  }

  op(boardId: string, op: Op, opId = `op-${randomUUID()}`) {
    return this.call('POST', `/api/boards/${boardId}/ops`, { opId, op })
  }
}

/** Reads an SSE stream into `events`. */
export async function openStream(baseUrl: string, cookie: string, boardId: string, opts: { since?: number; lastEventId?: number } = {}) {
  const ctrl = new AbortController()
  const headers: Record<string, string> = { cookie }
  if (opts.lastEventId !== undefined) headers['last-event-id'] = String(opts.lastEventId)
  const res = await fetch(`${baseUrl}/api/boards/${boardId}/events${opts.since !== undefined ? `?since=${opts.since}` : ''}`, { headers, signal: ctrl.signal })
  const events: StreamedEvent[] = []
  if (res.status !== 200 || !res.body) {
    return { status: res.status, events, waitFor: async () => events, close: () => ctrl.abort() }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let i: number
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          const data = block.split('\n').find((l) => l.startsWith('data: '))
          if (data) events.push(JSON.parse(data.slice(6)))
        }
      }
    } catch { /* aborted */ }
  })()
  return {
    status: res.status,
    events,
    async waitFor(n: number, ms = 5000) {
      const start = Date.now()
      while (events.length < n && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 20))
      return events
    },
    close: () => ctrl.abort(),
  }
}

export const cardIds = (s: Snapshot, columnId: string) => s.cards.filter((c) => c.columnId === columnId).map((c) => c.id)
export const newId = () => randomUUID()
