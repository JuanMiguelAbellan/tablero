import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Link, useRouter } from '../router'

export function JoinPage({ token }: { token: string }) {
  const { user } = useAuth()
  const { navigate } = useRouter()
  const [invite, setInvite] = useState<{ boardName: string; role: string } | null | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => { api<{ boardName: string; role: string }>('GET', `/api/invites/${encodeURIComponent(token)}`).then(setInvite, () => setInvite(null)) }, [token])

  if (invite === undefined) return <main className="wrap narrow"><p className="muted" role="status">Comprobando invitación…</p></main>
  if (invite === null) return <main className="wrap narrow"><h1>Invitación no válida</h1><p className="muted">El enlace ha caducado o no existe. Pide uno nuevo. <Link to="/">Inicio</Link></p></main>

  const rolText = invite.role === 'editor' ? 'poder editarlo' : 'verlo en modo lectura'
  async function accept() {
    try {
      const r = await api<{ boardId: string }>('POST', `/api/invites/${encodeURIComponent(token)}/accept`)
      navigate(`/b/${r.boardId}`, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    }
  }
  const back = encodeURIComponent(`/join/${token}`)
  return (
    <main className="wrap narrow">
      <h1>Te han invitado</h1>
      <div className="card-panel">
        <p>Te invitan al tablero <strong>{invite.boardName}</strong> con permiso para {rolText}.</p>
        {user ? <p><button type="button" onClick={accept}>Unirme al tablero</button></p> : (
          <p><Link to={`/login?next=${back}`} className="btn">Entrar para unirme</Link>{' '}<Link to={`/register?next=${back}`}>Crear cuenta</Link></p>
        )}
        {error && <p className="notice err" role="alert">{error}</p>}
      </div>
    </main>
  )
}
