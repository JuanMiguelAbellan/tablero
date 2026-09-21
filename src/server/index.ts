import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { EventHub } from './hub.js'

const hub = new EventHub()
await hub.start()
const app = await buildApp({
  hub,
  staticDir: fileURLToPath(new URL('../../dist', import.meta.url)),
  secureCookie: process.env.COOKIE_SECURE === 'true',
})
const port = Number(process.env.PORT ?? 3200)
await app.listen({ port, host: '0.0.0.0' })
process.stderr.write(`[tablero] listening on :${port}\n`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void hub.stop().then(() => app.close()).then(() => process.exit(0))
  })
}
