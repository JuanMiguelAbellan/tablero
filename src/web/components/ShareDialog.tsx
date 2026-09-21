import { useEffect, useRef, useState } from 'react'
import type { Member } from '../../shared/types'
import { api } from '../api'

export function ShareDialog({ boardId, members, isOwner, onClose }: { boardId: string; members: Member[]; isOwner: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { ref.current?.showModal() }, [])

  async function create() {
    setError('')
    setCopied(false)
    try {
      const r = await api<{ token: string }>('POST', `/api/boards/${boardId}/invites`, { role })
      setLink(`${location.origin}/join/${r.token}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el enlace')
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="share-title">
      <h2 id="share-title">Compartir tablero</h2>
      <h3>Personas con acceso</h3>
      <ul className="members">
        {members.map((m) => <li key={m.userId}>{m.name} <span className="pill">{m.role === 'owner' ? 'propietario' : m.role === 'editor' ? 'edita' : 'solo lectura'}</span></li>)}
      </ul>
      {isOwner ? (
        <>
          <h3>Invitar con un enlace</h3>
          <div className="row">
            <label className="sr-only" htmlFor="invite-role">Permiso</label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
              <option value="editor">Puede editar</option>
              <option value="viewer">Solo lectura</option>
            </select>
            <button type="button" onClick={create}>Crear enlace</button>
          </div>
          {error && <p className="notice err" role="alert">{error}</p>}
          {link && (
            <div className="invite-link">
              <input readOnly value={link} aria-label="Enlace de invitación" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="secondary" onClick={async () => { await navigator.clipboard?.writeText(link).catch(() => {}); setCopied(true) }}>{copied ? 'Copiado' : 'Copiar'}</button>
              <p className="muted small">Cualquiera con este enlace y una cuenta puede unirse. Caduca en 72 horas.</p>
            </div>
          )}
        </>
      ) : <p className="muted">Solo el propietario puede invitar a más personas.</p>}
      <div className="dialog-actions"><span className="spacer" /><button type="button" className="secondary" onClick={() => ref.current?.close()}>Cerrar</button></div>
    </dialog>
  )
}
