export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Every request carries the custom header the server requires for anything that changes data (CSRF defence), and every
 *  non-GET sends a JSON body (the server rejects an empty body under a JSON content type). */
export async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'tablero' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Error ${res.status}`)
  return json as T
}

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16))
