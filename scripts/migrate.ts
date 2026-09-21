import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export async function migrate(url: string): Promise<string[]> {
  const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  const applied: string[] = []
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const file of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file])
      if (done.rowCount) continue
      await client.query('BEGIN')
      try {
        await client.query(await readFile(dir + file, 'utf8'))
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        applied.push(file)
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${file} failed: ${e instanceof Error ? e.message : e}`)
      }
    }
  } finally {
    await client.end()
  }
  return applied
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const url = process.env.DATABASE_URL ?? 'postgres://tablero:tablero@localhost:54330/tablero'
  migrate(url).then(
    (a) => console.log(a.length ? `applied: ${a.join(', ')}` : 'nothing to apply'),
    (e) => { console.error(e.message); process.exit(1) },
  )
}
