import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createSession, destroySession, SESSION_DAYS, userForSession, type SessionUser } from './auth.js'
import { acceptInvite, applyOp, createBoard, createInvite, getSnapshot, listBoards, opIdSchema, opSchema, previewInvite, roleOf } from './boards.js'
import { pool, query } from './db.js'
import { HttpError, notFound } from './errors.js'
import type { EventHub } from './hub.js'
import { authenticate, registerUser } from './users.js'

const COOKIE = 'sid'

const credentials = z.strictObject({ email: z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), password: z.string().min(1).max(200) })
const registration = credentials.extend({ name: z.string().trim().min(1).max(60), password: z.string().min(8).max(200) })

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  // The app loads only its own scripts and styles. Inline styles are allowed because the drag-and-drop library positions
  // dragged cards with style attributes.
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}

export interface AppOptions {
  hub: EventHub
  /** Built front-end (vite build output). Omit in tests / API-only use. */
  staticDir?: string
  secureCookie?: boolean
}

export async function buildApp({ hub, staticDir, secureCookie = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 })
  await app.register(cookie)

  app.addHook('onRequest', async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v)
    // CSRF: every state-changing request must carry a custom header. A browser cannot add one to a cross-site request
    // without a CORS preflight, and this server answers no preflights — so another site cannot make your browser act.
    // (SameSite=Lax on the session cookie is a second, independent layer.)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'tablero') {
      throw new HttpError(403, 'Petición no permitida')
    }
  })

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message })
    if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Datos no válidos' })
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: 'Petición no válida' })
    process.stderr.write(`[tablero] ${err.stack ?? err}\n`)
    return reply.status(500).send({ error: 'Error interno' })
  })

  const requireUser = async (req: FastifyRequest): Promise<SessionUser> => {
    const user = await userForSession(req.cookies[COOKIE])
    if (!user) throw new HttpError(401, 'Necesitas iniciar sesión')
    return user
  }
  const startSession = async (reply: import('fastify').FastifyReply, userId: string) => {
    const { token, expires } = await createSession(userId)
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/', expires, maxAge: SESSION_DAYS * 86_400 })
  }

  // ---------------------------------------------------------------- accounts
  app.post('/api/auth/register', async (req, reply) => {
    const body = registration.parse(req.body)
    const id = await registerUser(body.email, body.name, body.password)
    await startSession(reply, id)
    return { user: { id, email: body.email, name: body.name } }
  })

  app.post('/api/auth/login', async (req, reply) => {
    const body = credentials.parse(req.body)
    const id = await authenticate(body.email, body.password)
    await startSession(reply, id)
    const u = (await query('SELECT id, email, name FROM users WHERE id = $1', [id])).rows[0]
    return { user: u }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req.cookies[COOKIE])
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', async (req) => {
    const user = await requireUser(req)
    const u = (await query('SELECT id, email, name FROM users WHERE id = $1', [user.id])).rows[0]
    return { user: u }
  })

  // ---------------------------------------------------------------- boards
  app.get('/api/boards', async (req) => ({ boards: await listBoards((await requireUser(req)).id) }))

  app.post('/api/boards', async (req) => {
    const user = await requireUser(req)
    const { name } = z.strictObject({ name: z.string().trim().min(1).max(80) }).parse(req.body)
    return { id: await createBoard(user.id, name) }
  })

  app.get('/api/boards/:id', async (req) => {
    const user = await requireUser(req)
    return getSnapshot(user.id, (req.params as { id: string }).id)
  })

  app.post('/api/boards/:id/ops', async (req) => {
    const user = await requireUser(req)
    const { opId, op } = z.strictObject({ opId: opIdSchema, op: opSchema }).parse(req.body)
    return applyOp(user.id, (req.params as { id: string }).id, opId, op)
  })

  app.get('/api/boards/:id/events', async (req, reply) => {
    const user = await requireUser(req)
    const boardId = (req.params as { id: string }).id
    if (!z.uuid().safeParse(boardId).success || !(await roleOf(pool(), boardId, user.id))) throw notFound()
    const since = z.coerce.number().int().min(0).catch(0).parse(req.headers['last-event-id'] ?? (req.query as { since?: string }).since ?? 0)

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // tell nginx-style proxies not to buffer the stream
    })
    res.write('retry: 2000\n\n')
    const sub = hub.subscribe(boardId, since, (e) => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`))
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000) // keeps idle connections open through proxies
    req.raw.on('close', () => {
      clearInterval(ping)
      sub.close()
    })
  })

  // ---------------------------------------------------------------- sharing
  app.post('/api/boards/:id/invites', async (req) => {
    const user = await requireUser(req)
    const { role } = z.strictObject({ role: z.enum(['editor', 'viewer']) }).parse(req.body)
    const { token, expiresAt } = await createInvite(user.id, (req.params as { id: string }).id, role)
    return { token, expiresAt }
  })

  app.get('/api/invites/:token', async (req) => {
    const invite = await previewInvite((req.params as { token: string }).token)
    if (!invite) throw notFound()
    return invite
  })

  app.post('/api/invites/:token/accept', async (req) => {
    const user = await requireUser(req)
    return { boardId: await acceptInvite(user.id, (req.params as { token: string }).token) }
  })

  app.get('/api/health', async () => ({ ok: true, streams: hub.connections }))

  // ---------------------------------------------------------------- front-end
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: resolve(staticDir), wildcard: false })
    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api/')) throw notFound()
      return reply.sendFile('index.html') // single-page app: any other path is a client-side route
    })
  }

  return app
}
