import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '../src/server/db'
import { Client, newId, openStream, startApp } from './helpers'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

async function board() {
  const a = await Client.signUp(app.baseUrl, 'Ana')
  const { id, snapshot } = await a.newBoard()
  return { a, id, todo: snapshot.columns[0]!.id, doing: snapshot.columns[1]!.id, seq: snapshot.seq }
}
const addCard = (a: Client, id: string, columnId: string, title: string, afterId: string | null = null) => {
  const cardId = newId()
  return a.op(id, { type: 'card.add', id: cardId, columnId, title, afterId }).then((r) => ({ ...r, cardId }))
}

describe('live updates', () => {
  it('a second person sees changes as they happen, tagged with who and which operation caused them', async () => {
    const { a, id, todo, seq } = await board()
    const b = await Client.signUp(app.baseUrl, 'Beto')
    await b.call('POST', `/api/invites/${(await a.call('POST', `/api/boards/${id}/invites`, { role: 'viewer' })).json.token}/accept`)
    const stream = await openStream(app.baseUrl, b.cookie, id, { since: (await b.snapshot(id)).seq })
    expect(stream.status).toBe(200)

    const { cardId } = await addCard(a, id, todo, 'En vivo')
    await a.op(id, { type: 'card.update', id: cardId, title: 'En vivo (editada)' }, 'edit-op-0001')
    const got = await stream.waitFor(2)
    expect(got.map((e) => e.event.type)).toEqual(['card.added', 'card.updated'])
    expect(got[1]).toMatchObject({ opId: 'edit-op-0001', actorId: a.userId })
    expect(got[0]!.seq).toBeLessThan(got[1]!.seq)
    stream.close()
    void seq
  })

  it('a burst of 60 changes arrives complete and strictly in order', async () => {
    const { a, id, todo, seq } = await board()
    const stream = await openStream(app.baseUrl, a.cookie, id, { since: seq })
    let prev: string | null = null
    for (let i = 0; i < 60; i++) prev = (await addCard(a, id, todo, `n${i}`, prev)).cardId
    const got = await stream.waitFor(60, 10_000)
    expect(got).toHaveLength(60)
    const seqs = got.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))
    expect(new Set(seqs).size).toBe(60)
    stream.close()
  })

  it('events of one board never reach a stream on another board', async () => {
    const one = await board()
    const two = await board()
    const streamOne = await openStream(app.baseUrl, one.a.cookie, one.id, { since: one.seq })
    const streamTwo = await openStream(app.baseUrl, two.a.cookie, two.id, { since: two.seq })
    await addCard(two.a, two.id, two.todo, 'solo en el dos')
    await streamTwo.waitFor(1)
    await new Promise((r) => setTimeout(r, 300))
    expect(streamOne.events).toHaveLength(0)
    expect(streamTwo.events).toHaveLength(1)
    streamOne.close(); streamTwo.close()
  })
})

describe('reconnecting without losing anything', () => {
  it('Last-Event-ID resumes exactly after the last event received: no gaps, no repeats', async () => {
    const { a, id, todo, seq } = await board()
    const first = await openStream(app.baseUrl, a.cookie, id, { since: seq })
    const c1 = (await addCard(a, id, todo, 'uno')).cardId
    const c2 = (await addCard(a, id, todo, 'dos', c1)).cardId
    await first.waitFor(2)
    const lastSeen = first.events.at(-1)!.seq
    first.close() // connection drops…

    const c3 = (await addCard(a, id, todo, 'tres (mientras estaba desconectado)', c2)).cardId // …changes happen meanwhile
    await a.op(id, { type: 'card.delete', id: c1 })

    const second = await openStream(app.baseUrl, a.cookie, id, { lastEventId: lastSeen }) // browser reconnects with Last-Event-ID
    const got = await second.waitFor(2)
    expect(got.map((e) => e.event.type)).toEqual(['card.added', 'card.deleted'])
    expect((got[0]!.event as { card: { id: string } }).card.id).toBe(c3)
    expect(got.every((e) => e.seq > lastSeen)).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    expect(second.events).toHaveLength(2) // nothing repeated
    second.close()
  })

  it('a snapshot plus the stream from its seq reproduces the live state exactly', async () => {
    const { a, id, todo } = await board()
    const c1 = (await addCard(a, id, todo, 'previa')).cardId
    const snap = await a.snapshot(id) // taken here…
    await addCard(a, id, todo, 'posterior', c1) // …changes after it
    await a.op(id, { type: 'card.update', id: c1, title: 'previa editada' })
    const stream = await openStream(app.baseUrl, a.cookie, id, { since: snap.seq })
    const got = await stream.waitFor(2)
    expect(got.map((e) => e.event.type)).toEqual(['card.added', 'card.updated']) // nothing from before the snapshot, nothing missing after it
    stream.close()
  })

  it('the hub survives losing its Postgres LISTEN connection: it reconnects and catches up', async () => {
    const { a, id, todo, seq } = await board()
    const stream = await openStream(app.baseUrl, a.cookie, id, { since: seq })
    await addCard(a, id, todo, 'antes del corte')
    await stream.waitFor(1)

    await pool().query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = 'LISTEN board_events' AND pid <> pg_backend_pid()")
    await addCard(a, id, todo, 'durante el corte')
    const got = await stream.waitFor(2, 8000) // delivered after the hub reconnects and flushes what it missed
    expect(got.map((e) => (e.event as { card: { title: string } }).card.title)).toEqual(['antes del corte', 'durante el corte'])

    await addCard(a, id, todo, 'después del corte')
    expect(await stream.waitFor(3, 5000)).toHaveLength(3)
    stream.close()
  })

  it('joining a board is announced to people already watching', async () => {
    const { a, id, seq } = await board()
    const stream = await openStream(app.baseUrl, a.cookie, id, { since: seq })
    const b = await Client.signUp(app.baseUrl, 'Nuevo')
    await b.call('POST', `/api/invites/${(await a.call('POST', `/api/boards/${id}/invites`, { role: 'editor' })).json.token}/accept`)
    const got = await stream.waitFor(1)
    expect(got[0]!.event).toMatchObject({ type: 'member.joined', member: { name: 'Nuevo', role: 'editor' } })
    stream.close()
  })

  it('closing a stream releases it on the server', async () => {
    const { a, id } = await board()
    const before = app.hub.connections
    const s = await openStream(app.baseUrl, a.cookie, id, { since: 0 })
    expect(app.hub.connections).toBe(before + 1)
    s.close()
    for (let i = 0; i < 50 && app.hub.connections > before; i++) await new Promise((r) => setTimeout(r, 50))
    expect(app.hub.connections).toBe(before)
  })
})
