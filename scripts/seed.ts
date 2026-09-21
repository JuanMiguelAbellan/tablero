// Demo data: two accounts that share one populated board, so a visitor can open two windows (or a private one) and watch
// live sync. Idempotent: does nothing if the demo owner already exists. Password for both: demo-password
import { createBoard, createInvite, acceptInvite, applyOp } from '../src/server/boards'
import { pool, query } from '../src/server/db'
import { registerUser } from '../src/server/users'
import { randomUUID } from 'node:crypto'

const exists = await query("SELECT 1 FROM users WHERE lower(email) = 'demo@demo.dev'")
if (exists.rowCount) {
  console.log('demo data already present')
  await pool().end()
  process.exit(0)
}

const ana = await registerUser('demo@demo.dev', 'Ana (demo)', 'demo-password')
const beto = await registerUser('demo2@demo.dev', 'Beto (demo)', 'demo-password')
const boardId = await createBoard(ana, 'Lanzamiento web')
const cols = (await query('SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position', [boardId])).rows as { id: string; name: string }[]

const content: Record<string, { title: string; description?: string }[]> = {
  'Por hacer': [
    { title: 'Diseñar la portada', description: 'Boceto en papel primero; luego Figma.' },
    { title: 'Redactar los textos' },
    { title: 'Configurar el dominio' },
  ],
  'En curso': [{ title: 'Maquetar la home' }, { title: 'Formulario de contacto', description: 'Con validación en servidor.' }],
  Hecho: [{ title: 'Elegir hosting' }, { title: 'Logo aprobado' }],
}
for (const col of cols) {
  let after: string | null = null
  for (const c of content[col.name] ?? []) {
    const id = randomUUID()
    await applyOp(ana, boardId, `seed-${id}`, { type: 'card.add', id, columnId: col.id, title: c.title, afterId: after })
    if (c.description) await applyOp(ana, boardId, `seed-d-${id}`, { type: 'card.update', id, description: c.description })
    after = id
  }
}
const { token } = await createInvite(ana, boardId, 'editor')
await acceptInvite(beto, token)
console.log('demo data created')
await pool().end()
