import pg from 'pg'
import { migrate } from '../scripts/migrate'

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://tablero:tablero@localhost:54330/postgres'

/** Every test run gets its own freshly migrated database, dropped afterwards: tests never depend on leftovers. */
export default async function setup() {
  const name = `tablero_test_${process.pid}_${Date.now()}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  try {
    await admin.connect()
  } catch (e) {
    throw new Error(`Cannot reach Postgres at ${ADMIN_URL}. Start it with "npm run db:up". (${e instanceof Error ? e.message : e})`)
  }
  await admin.query(`CREATE DATABASE ${name}`)
  const url = new URL(ADMIN_URL)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  await migrate(process.env.DATABASE_URL)

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await admin.end()
  }
}
