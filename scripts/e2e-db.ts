// A fresh database for every end-to-end run, so tests never depend on what an earlier run left behind.
import pg from 'pg'
import { migrate } from './migrate'

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://tablero:tablero@localhost:54330/postgres'
const NAME = 'tablero_e2e'

const admin = new pg.Client({ connectionString: ADMIN_URL })
await admin.connect()
await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`)
await admin.query(`CREATE DATABASE ${NAME}`)
await admin.end()
const url = new URL(ADMIN_URL)
url.pathname = `/${NAME}`
await migrate(url.toString())
console.log('e2e database ready')
