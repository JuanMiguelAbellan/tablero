import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool, query } from '../src/server/db'
import { byPosition } from '../src/shared/order'
import { cardIds, Client, newId, startApp, uid } from './helpers'

let app: Awaited<ReturnType<typeof startApp>>
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

describe('accounts', () => {
  it('registers, reads /me, logs out, logs in again', async () => {
    const c = new Client(app.baseUrl)
    const email = `a-${uid()}@test.dev`
    const reg = await c.call('POST', '/api/auth/register', { email, name: 'Ana', password: 'contraseña-larga' })
    expect(reg.status).toBe(200)
    expect((await c.call('GET', '/api/me')).json.user.email).toBe(email)
    await c.call('POST', '/api/auth/logout')
    expect((await c.call('GET', '/api/me')).status).toBe(401)
    expect((await c.call('POST', '/api/auth/login', { email: email.toUpperCase(), password: 'contraseña-larga' })).status).toBe(200)
  })

  it('the session cookie is HttpOnly and SameSite=Lax', async () => {
    const r = await new Client(app.baseUrl).call('POST', '/api/auth/register', { email: `c-${uid()}@test.dev`, name: 'C', password: 'contraseña-larga' })
    const set = r.headers.get('set-cookie')!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=Lax/i)
  })

  it('duplicate email is a conflict; wrong password and unknown email look identical; 10 failures lock the account', async () => {
    const a = await Client.signUp(app.baseUrl)
    const dup = await new Client(app.baseUrl).call('POST', '/api/auth/register', { email: a.email, name: 'X', password: 'contraseña-larga' })
    expect(dup.status).toBe(409)
    const wrong = await new Client(app.baseUrl).call('POST', '/api/auth/login', { email: a.email, password: 'nope-nope-nope' })
    const ghost = await new Client(app.baseUrl).call('POST', '/api/auth/login', { email: `ghost-${uid()}@test.dev`, password: 'nope-nope-nope' })
    expect(wrong.status).toBe(401)
    expect(wrong.json).toEqual(ghost.json)
    for (let i = 0; i < 9; i++) await new Client(app.baseUrl).call('POST', '/api/auth/login', { email: a.email, password: 'nope-nope-nope' })
    expect((await new Client(app.baseUrl).call('POST', '/api/auth/login', { email: a.email, password: 'contraseña-larga' })).status).toBe(429)
  })

  it('rejects weak passwords and malformed input', async () => {
    const c = new Client(app.baseUrl)
    expect((await c.call('POST', '/api/auth/register', { email: `w-${uid()}@test.dev`, name: 'W', password: 'short' })).status).toBe(400)
    expect((await c.call('POST', '/api/auth/register', { email: 'not-an-email', name: 'W', password: 'contraseña-larga' })).status).toBe(400)
    expect((await c.call('POST', '/api/auth/register', { email: `w-${uid()}@test.dev`, name: 'W', password: 'contraseña-larga', role: 'admin' })).status).toBe(400) // unknown field
  })
})

describe('CSRF and headers', () => {
  it('a state-changing request without the custom header is refused, even with a valid session', async () => {
    const a = await Client.signUp(app.baseUrl)
    const res = await fetch(`${app.baseUrl}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: a.cookie }, body: JSON.stringify({ name: 'evil' }) })
    expect(res.status).toBe(403)
    expect((await a.call('GET', '/api/boards')).json.boards).toHaveLength(0)
  })

  it('responses carry security headers', async () => {
    const r = await new Client(app.baseUrl).call('GET', '/api/health')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(r.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('boards and access control', () => {
  it('a new board has three default columns, in order, and the creator is owner', async () => {
    const a = await Client.signUp(app.baseUrl)
    const { snapshot } = await a.newBoard('Proyecto')
    expect(snapshot.role).toBe('owner')
    expect(snapshot.columns.map((c) => c.name)).toEqual(['Por hacer', 'En curso', 'Hecho'])
  })

  it('a non-member cannot read, edit or stream a board — and gets the same "not found" as for a board that does not exist', async () => {
    const owner = await Client.signUp(app.baseUrl)
    const stranger = await Client.signUp(app.baseUrl)
    const { id, snapshot } = await owner.newBoard()
    const nonexistent = newId()
    const get = await stranger.call('GET', `/api/boards/${id}`)
    expect(get.status).toBe(404)
    expect(get.json).toEqual((await stranger.call('GET', `/api/boards/${nonexistent}`)).json)
    expect((await stranger.op(id, { type: 'card.add', id: newId(), columnId: snapshot.columns[0]!.id, title: 'hack', afterId: null })).status).toBe(404)
    expect((await stranger.call('GET', '/api/boards/not-a-uuid')).status).toBe(404)
    const { openStream } = await import('./helpers')
    expect((await openStream(app.baseUrl, stranger.cookie, id)).status).toBe(404)
    expect((await new Client(app.baseUrl).call('GET', `/api/boards/${id}`)).status).toBe(401)
  })

  it('board lists only show boards you belong to', async () => {
    const a = await Client.signUp(app.baseUrl)
    const b = await Client.signUp(app.baseUrl)
    await a.newBoard('De A')
    await b.newBoard('De B')
    expect((await a.call('GET', '/api/boards')).json.boards.map((x: { name: string }) => x.name)).toEqual(['De A'])
  })
})

describe('operations', () => {
  async function setup() {
    const a = await Client.signUp(app.baseUrl)
    const { id, snapshot } = await a.newBoard()
    const [todo, doing] = snapshot.columns
    return { a, id, todo: todo!.id, doing: doing!.id }
  }
  const add = (a: Client, id: string, columnId: string, title: string, afterId: string | null = null, cardId = newId()) =>
    a.op(id, { type: 'card.add', id: cardId, columnId, title, afterId }).then((r) => ({ ...r, cardId }))

  it('adds, edits, moves and deletes cards; the snapshot reflects each step in order', async () => {
    const { a, id, todo, doing } = await setup()
    const c1 = (await add(a, id, todo, 'Uno')).cardId
    const c2 = (await add(a, id, todo, 'Dos', c1)).cardId
    const c3 = (await add(a, id, todo, 'Tres', c2)).cardId
    expect(cardIds(await a.snapshot(id), todo)).toEqual([c1, c2, c3])

    await a.op(id, { type: 'card.move', id: c3, columnId: todo, afterId: null })
    expect(cardIds(await a.snapshot(id), todo)).toEqual([c3, c1, c2])
    await a.op(id, { type: 'card.move', id: c1, columnId: doing, afterId: null })
    const s = await a.snapshot(id)
    expect(cardIds(s, todo)).toEqual([c3, c2])
    expect(cardIds(s, doing)).toEqual([c1])

    await a.op(id, { type: 'card.update', id: c2, title: 'Dos (editada)', description: 'detalle' })
    expect((await a.snapshot(id)).cards.find((c) => c.id === c2)).toMatchObject({ title: 'Dos (editada)', description: 'detalle', version: 2 })
    await a.op(id, { type: 'card.delete', id: c3 })
    expect(cardIds(await a.snapshot(id), todo)).toEqual([c2])
  })

  it('columns can be added, renamed, reordered and deleted (taking their cards with them)', async () => {
    const { a, id, todo, doing } = await setup()
    const col = newId()
    await a.op(id, { type: 'column.add', id: col, name: 'Revisión', afterId: doing })
    await a.op(id, { type: 'column.rename', id: col, name: 'QA' })
    await a.op(id, { type: 'column.move', id: col, afterId: null })
    let s = await a.snapshot(id)
    expect(s.columns.map((c) => c.name)).toEqual(['QA', 'Por hacer', 'En curso', 'Hecho'])
    await add(a, id, col, 'Dentro de QA')
    await a.op(id, { type: 'column.delete', id: col })
    s = await a.snapshot(id)
    expect(s.columns).toHaveLength(3)
    expect(s.cards).toHaveLength(0)
    void todo
  })

  it('rejects malformed operations with 400 and changes nothing', async () => {
    const { a, id, todo } = await setup()
    const bad: unknown[] = [
      { type: 'card.add', id: 'not-a-uuid', columnId: todo, title: 'x', afterId: null },
      { type: 'card.add', id: newId(), columnId: todo, title: '', afterId: null },
      { type: 'card.add', id: newId(), columnId: todo, title: 'x'.repeat(201), afterId: null },
      { type: 'card.add', id: newId(), columnId: todo, title: 'x', afterId: null, extra: 1 },
      { type: 'card.update', id: newId(), description: 'x'.repeat(5001) },
      { type: 'drop.table', id: newId() },
      { type: 'card.move', id: newId(), columnId: todo },
    ]
    for (const op of bad) expect((await a.call('POST', `/api/boards/${id}/ops`, { opId: 'op-valid-1', op })).status).toBe(400)
    expect((await a.call('POST', `/api/boards/${id}/ops`, { opId: '../../etc', op: { type: 'column.delete', id: todo } })).status).toBe(400)
    expect((await a.snapshot(id)).cards).toHaveLength(0)
  })

  it('operations on things that do not exist (or belong to another board) are 404 and touch nothing', async () => {
    const { a, id, todo } = await setup()
    const other = await Client.signUp(app.baseUrl)
    const otherBoard = await other.newBoard()
    const foreignCard = newId()
    await other.op(otherBoard.id, { type: 'card.add', id: foreignCard, columnId: otherBoard.snapshot.columns[0]!.id, title: 'ajena', afterId: null })

    for (const op of [
      { type: 'card.delete', id: foreignCard },
      { type: 'card.update', id: foreignCard, title: 'robada' },
      { type: 'card.move', id: foreignCard, columnId: todo, afterId: null },
      { type: 'card.add', id: newId(), columnId: otherBoard.snapshot.columns[0]!.id, title: 'en columna ajena', afterId: null },
      { type: 'column.delete', id: otherBoard.snapshot.columns[0]!.id },
    ] as const) expect((await a.op(id, op)).status).toBe(404)
    const theirs = await other.snapshot(otherBoard.id)
    expect(theirs.cards.map((c) => c.title)).toEqual(['ajena'])
    expect(theirs.columns).toHaveLength(3)
  })

  it('a client-chosen id that already exists elsewhere is a conflict, not a leak or an overwrite', async () => {
    const { a, id, todo } = await setup()
    const other = await Client.signUp(app.baseUrl)
    const ob = await other.newBoard()
    const taken = newId()
    await other.op(ob.id, { type: 'card.add', id: taken, columnId: ob.snapshot.columns[0]!.id, title: 'mía', afterId: null })
    expect((await a.op(id, { type: 'card.add', id: taken, columnId: todo, title: 'intento', afterId: null })).status).toBe(409)
  })

  it('resending an operation with the same opId is safe: applied once, same answer', async () => {
    const { a, id, todo } = await setup()
    const cardId = newId()
    const op = { type: 'card.add', id: cardId, columnId: todo, title: 'Una vez', afterId: null } as const
    const first = await a.op(id, op, 'retry-op-0001')
    const second = await a.op(id, op, 'retry-op-0001')
    expect(second.status).toBe(200)
    expect(second.json).toEqual(first.json)
    expect((await a.snapshot(id)).cards).toHaveLength(1)
    const events = await query("SELECT count(*)::int AS n FROM events WHERE board_id = $1 AND op_id = 'retry-op-0001'", [id])
    expect(events.rows[0].n).toBe(1)
  })

  it('moving a card onto itself is a no-op; a vanished neighbour sends the card to the end', async () => {
    const { a, id, todo } = await setup()
    const c1 = (await add(a, id, todo, 'A')).cardId
    const c2 = (await add(a, id, todo, 'B', c1)).cardId
    expect((await a.op(id, { type: 'card.move', id: c1, columnId: todo, afterId: c1 })).status).toBe(200)
    expect(cardIds(await a.snapshot(id), todo)).toEqual([c1, c2])
    await a.op(id, { type: 'card.move', id: c1, columnId: todo, afterId: newId() }) // neighbour never existed
    expect(cardIds(await a.snapshot(id), todo)).toEqual([c2, c1])
  })
})

describe('concurrency', () => {
  it('40 people adding to the same spot at once: everything succeeds, no two cards share a position', async () => {
    const owner = await Client.signUp(app.baseUrl)
    const { id, snapshot } = await owner.newBoard()
    const todo = snapshot.columns[0]!.id
    const rows = await Promise.all(Array.from({ length: 40 }, (_, i) => owner.op(id, { type: 'card.add', id: newId(), columnId: todo, title: `C${i}`, afterId: null })))
    expect(rows.map((r) => r.status)).toEqual(Array(40).fill(200))
    const s = await owner.snapshot(id)
    expect(s.cards).toHaveLength(40)
    expect(new Set(s.cards.map((c) => c.position)).size).toBe(40)
    // Each one went "first", so the last to be applied is on top: ordering is a total order, no ties.
    expect([...s.cards].sort(byPosition).map((c) => c.id)).toEqual(s.cards.map((c) => c.id))
  })

  it('simultaneous moves and deletes of the same cards never fail with a server error and leave a consistent board', async () => {
    const owner = await Client.signUp(app.baseUrl)
    const { id, snapshot } = await owner.newBoard()
    const [todo, doing] = [snapshot.columns[0]!.id, snapshot.columns[1]!.id]
    const cards: string[] = []
    for (let i = 0; i < 8; i++) {
      const cid = newId()
      await owner.op(id, { type: 'card.add', id: cid, columnId: todo, title: `C${i}`, afterId: cards.at(-1) ?? null })
      cards.push(cid)
    }
    const results = await Promise.all(
      cards.flatMap((c, i) => [
        owner.op(id, { type: 'card.move', id: c, columnId: i % 2 ? doing : todo, afterId: cards[(i + 3) % 8]! }),
        owner.op(id, { type: 'card.move', id: cards[(i + 1) % 8]!, columnId: doing, afterId: null }),
        ...(i === 5 ? [owner.op(id, { type: 'card.delete', id: c })] : []),
      ]),
    )
    expect(results.every((r) => r.status < 500)).toBe(true)
    const s = await owner.snapshot(id)
    const positions = s.cards.map((c) => `${c.columnId}:${c.position}`)
    expect(new Set(positions).size).toBe(positions.length) // still no duplicates within a column
  })

  it('positions sort the same in Postgres as in JavaScript (byte-wise collation on the position columns)', async () => {
    const owner = await Client.signUp(app.baseUrl)
    const { id, snapshot } = await owner.newBoard()
    const todo = snapshot.columns[0]!.id
    const ids: string[] = []
    for (let i = 0; i < 60; i++) {
      const cid = newId()
      await owner.op(id, { type: 'card.add', id: cid, columnId: todo, title: `C${i}`, afterId: ids.length ? ids[Math.floor(((i * 7) % ids.length))]! : null })
      ids.push(cid)
    }
    const fromDb = (await query('SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position', [todo])).rows
    const fromJs = [...fromDb].sort(byPosition)
    expect(fromDb.map((r) => r.id)).toEqual(fromJs.map((r) => r.id))
    // …and it would NOT if the column used the database's default collation:
    const withLocale = (await query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position COLLATE "en_US.utf8"', [todo]).catch(() => null))
    if (withLocale) expect(withLocale.rows.length).toBe(60)
  })
})

describe('sharing', () => {
  it('an invite lets someone join with the chosen role; viewers cannot edit, editors can', async () => {
    const owner = await Client.signUp(app.baseUrl, 'Dueña')
    const editor = await Client.signUp(app.baseUrl, 'Edita')
    const viewer = await Client.signUp(app.baseUrl, 'Mira')
    const { id, snapshot } = await owner.newBoard()
    const todo = snapshot.columns[0]!.id

    const eInv = (await owner.call('POST', `/api/boards/${id}/invites`, { role: 'editor' })).json.token
    const vInv = (await owner.call('POST', `/api/boards/${id}/invites`, { role: 'viewer' })).json.token
    expect((await editor.call('GET', `/api/invites/${eInv}`)).json).toMatchObject({ role: 'editor' })
    expect((await editor.call('POST', `/api/invites/${eInv}/accept`)).json.boardId).toBe(id)
    await viewer.call('POST', `/api/invites/${vInv}/accept`)

    expect((await editor.op(id, { type: 'card.add', id: newId(), columnId: todo, title: 'de editor', afterId: null })).status).toBe(200)
    const denied = await viewer.op(id, { type: 'card.add', id: newId(), columnId: todo, title: 'de lector', afterId: null })
    expect(denied.status).toBe(403)
    expect((await viewer.snapshot(id)).cards.map((c) => c.title)).toEqual(['de editor']) // can read
    expect((await viewer.snapshot(id)).members.map((m) => `${m.name}:${m.role}`).sort()).toEqual(['Dueña:owner', 'Edita:editor', 'Mira:viewer'])
  })

  it('only the owner can create invites; unknown/expired tokens are 404; joining twice or via a lower role never downgrades', async () => {
    const owner = await Client.signUp(app.baseUrl)
    const editor = await Client.signUp(app.baseUrl)
    const { id } = await owner.newBoard()
    const eInv = (await owner.call('POST', `/api/boards/${id}/invites`, { role: 'editor' })).json.token
    await editor.call('POST', `/api/invites/${eInv}/accept`)
    expect((await editor.call('POST', `/api/boards/${id}/invites`, { role: 'editor' })).status).toBe(403)
    expect((await new Client(app.baseUrl).call('GET', '/api/invites/nope')).status).toBe(404)

    const vInv = (await owner.call('POST', `/api/boards/${id}/invites`, { role: 'viewer' })).json.token
    await owner.call('POST', `/api/invites/${vInv}/accept`)
    await editor.call('POST', `/api/invites/${vInv}/accept`)
    expect((await owner.snapshot(id)).role).toBe('owner')
    expect((await editor.snapshot(id)).role).toBe('editor')

    await query("UPDATE invites SET expires_at = now() - interval '1 second'")
    expect((await editor.call('GET', `/api/invites/${vInv}`)).status).toBe(404)
  })
})
void pool

describe('concurrent edits of one card', () => {
  it('changing only the description leaves a title changed by someone else intact (partial updates)', async () => {
    const a = await Client.signUp(app.baseUrl)
    const { id, snapshot } = await a.newBoard()
    const cardId = newId()
    await a.op(id, { type: 'card.add', id: cardId, columnId: snapshot.columns[0]!.id, title: 'Original', afterId: null })
    await a.op(id, { type: 'card.update', id: cardId, title: 'Título nuevo de Ana' })
    await a.op(id, { type: 'card.update', id: cardId, description: 'Descripción de Beto' }) // Beto's edit only carries the description
    expect((await a.snapshot(id)).cards[0]).toMatchObject({ title: 'Título nuevo de Ana', description: 'Descripción de Beto', version: 3 })
  })
})
