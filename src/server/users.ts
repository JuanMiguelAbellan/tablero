import { dummyPasswordHash, hashPassword, verifyPassword } from './auth.js'
import { isPgError, query, UNIQUE_VIOLATION } from './db.js'
import { HttpError } from './errors.js'

const MAX_FAILED_LOGINS = 10
const LOGIN_WINDOW_MINUTES = 15

export async function registerUser(email: string, name: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password)
  try {
    const r = await query('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [email, name, passwordHash])
    return r.rows[0].id
  } catch (e) {
    if (isPgError(e, UNIQUE_VIOLATION)) throw new HttpError(409, 'Ya existe una cuenta con ese email')
    throw e
  }
}

/** Same password-hashing work whether or not the email exists, the same message either way, and a lockout after 10
 *  failures in 15 minutes for the same email (even for the right password until the window passes). */
export async function authenticate(email: string, password: string): Promise<string> {
  const failed = await query('SELECT count(*)::int AS n FROM login_attempts WHERE lower(email) = lower($1) AND at > now() - make_interval(mins => $2)', [email, LOGIN_WINDOW_MINUTES])
  if (failed.rows[0].n >= MAX_FAILED_LOGINS) throw new HttpError(429, 'Demasiados intentos fallidos; espera unos minutos')
  const r = await query('SELECT id, password_hash FROM users WHERE lower(email) = lower($1)', [email])
  const user = r.rows[0]
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()))
  if (user && ok) return user.id
  await query('INSERT INTO login_attempts (email) VALUES ($1)', [email])
  throw new HttpError(401, 'Email o contraseña incorrectos')
}

export async function userName(userId: string): Promise<string> {
  return (await query('SELECT name FROM users WHERE id = $1', [userId])).rows[0]?.name ?? ''
}
