import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { query } from './db.js'

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>

const SCRYPT = { N: 16384, r: 8, p: 1 }
export const SESSION_DAYS = 14

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return timingSafeEqual(actual, expected)
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Create a session; returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, expires])
  return { token, expires }
}

export interface SessionUser {
  id: string
  email: string
}

export async function userForSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const r = await query('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()', [sha256(token)])
  return r.rows[0] ?? null
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
}

/** A fixed hash to compare against when the email is unknown, so login takes the same time either way. */
let dummyHash: Promise<string> | undefined
export function dummyPasswordHash(): Promise<string> {
  return (dummyHash ??= hashPassword('not-a-real-password'))
}
