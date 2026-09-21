import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { initialSync, syncReducer, view } from '../shared/sync'
import type { Member, Op, Role, Snapshot, StreamedEvent } from '../shared/types'
import { api, ApiError, newId } from './api'

export type Connection = 'connecting' | 'live' | 'reconnecting'
export type Status = 'loading' | 'ready' | 'notfound' | 'error'

const RETRY_MS = [500, 1000, 2000, 4000, 8000]

/**
 * The client half of the sync protocol.
 *
 *  - Load a snapshot, then follow the event stream from the snapshot's seq (EventSource re-sends Last-Event-ID itself when it
 *    reconnects, so a dropped connection resumes exactly where it stopped).
 *  - `send(op)` shows the change instantly (a prediction stored as a pending op) and delivers it in order. A network failure
 *    is retried with the SAME operation id, which the server treats idempotently — so a retry can never apply a change twice.
 *  - A rejected operation (permission, validation, conflict) is simply removed: the screen falls back to the server's truth.
 */
export function useBoard(boardId: string, onMessage: (text: string) => void) {
  const [sync, dispatch] = useReducer(syncReducer, initialSync)
  const [meta, setMeta] = useState<{ name: string; role: Role; members: Member[] } | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [connection, setConnection] = useState<Connection>('connecting')
  const [unsent, setUnsent] = useState(0)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(true)
  const message = useRef(onMessage)
  message.current = onMessage

  useEffect(() => {
    alive.current = true
    let source: EventSource | null = null
    let cancelled = false
    setStatus('loading')
    setMeta(null)
    api<Snapshot>('GET', `/api/boards/${boardId}`).then(
      (snap) => {
        if (cancelled) return
        dispatch({ type: 'load', snapshot: snap })
        setMeta({ name: snap.board.name, role: snap.role, members: snap.members })
        setStatus('ready')
        source = new EventSource(`/api/boards/${boardId}/events?since=${snap.seq}`)
        source.onopen = () => setConnection('live')
        source.onerror = () => {
          setConnection('reconnecting')
          // The browser retries by itself. If the server has closed the stream for good (e.g. access revoked), stop pretending.
          if (source?.readyState === EventSource.CLOSED) setStatus('error')
        }
        source.onmessage = (m) => {
          const e = JSON.parse(m.data) as StreamedEvent
          dispatch({ type: 'event', event: e })
          if (e.event.type === 'member.joined') {
            const joined = e.event.member
            setMeta((cur) => (cur && !cur.members.some((x) => x.userId === joined.userId) ? { ...cur, members: [...cur.members, joined] } : cur))
          }
        }
      },
      (err) => { if (!cancelled) setStatus(err instanceof ApiError && err.status === 404 ? 'notfound' : 'error') },
    )
    return () => { cancelled = true; alive.current = false; source?.close() }
  }, [boardId])

  const deliver = useCallback(async (opId: string, op: Op) => {
    for (let attempt = 0; alive.current; attempt++) {
      try {
        const r = await api<{ seq: number }>('POST', `/api/boards/${boardId}/ops`, { opId, op })
        dispatch({ type: 'ack', opId, seq: r.seq })
        return
      } catch (e) {
        if (e instanceof ApiError && e.status < 500 && e.status !== 429) {
          dispatch({ type: 'reject', opId })
          // Deleting something that is already gone is what the user wanted anyway.
          if (!(e.status === 404 && (op.type === 'card.delete' || op.type === 'column.delete'))) message.current(e.status === 404 ? 'Ese elemento ya no existe; se ha actualizado el tablero.' : e.message)
          return
        }
        await new Promise((r) => setTimeout(r, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]))
      }
    }
  }, [boardId])

  const send = useCallback((op: Op) => {
    const opId = `op-${newId()}`
    dispatch({ type: 'queue', opId, op })
    setUnsent((n) => n + 1)
    // One at a time, in the order the user did them: "add card" must reach the server before "move that card".
    chain.current = chain.current.then(() => deliver(opId, op)).finally(() => setUnsent((n) => n - 1))
  }, [deliver])

  const state = useMemo(() => view(sync), [sync])
  return { state, meta, status, connection, unsent, send }
}
