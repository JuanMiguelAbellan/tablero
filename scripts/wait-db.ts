import pg from 'pg'

const url = process.env.DATABASE_URL ?? 'postgres://tablero:tablero@localhost:54330/tablero'
for (let i = 0; i < 60; i++) {
  const c = new pg.Client({ connectionString: url })
  try {
    await c.connect()
    await c.query('select 1')
    await c.end()
    console.log('database ready')
    process.exit(0)
  } catch {
    await c.end().catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
  }
}
console.error('database did not become ready')
process.exit(1)
