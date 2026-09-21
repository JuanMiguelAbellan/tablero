import pg from 'pg'

const DEFAULT_URL = 'postgres://tablero:tablero@localhost:54330/tablero'

const globalForPool = globalThis as unknown as { __pool?: pg.Pool }

export function pool(): pg.Pool {
  globalForPool.__pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL, max: 10 })
  return globalForPool.__pool
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_URL
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool().query<T>(text, params)
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>, isolation = ''): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query(`BEGIN ${isolation}`)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export const UNIQUE_VIOLATION = '23505'
export const FOREIGN_KEY_VIOLATION = '23503'

export function isPgError(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === code
}
