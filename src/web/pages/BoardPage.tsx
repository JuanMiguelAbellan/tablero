import { useState } from 'react'
import { Link } from '../router'
import { BoardView } from '../components/BoardView'
import { ShareDialog } from '../components/ShareDialog'
import { useToast } from '../toasts'
import { useBoard } from '../useBoard'

export function BoardPage({ boardId }: { boardId: string }) {
  const toast = useToast()
  const { state, meta, status, connection, unsent, send } = useBoard(boardId, toast)
  const [sharing, setSharing] = useState(false)

  if (status === 'loading') return <main className="wrap"><p className="muted" role="status">Cargando tablero…</p></main>
  if (status === 'notfound' || !meta) return <main className="wrap"><h1>Tablero no encontrado</h1><p className="muted">No existe o no tienes acceso. <Link to="/">Volver a mis tableros</Link></p></main>
  const canEdit = meta.role !== 'viewer'

  return (
    <main className="board-page">
      <header className="board-bar">
        <Link to="/" className="back">← Tableros</Link>
        <h1>{meta.name}</h1>
        {!canEdit && <span className="pill">solo lectura</span>}
        <span className="spacer" />
        <span className={`conn ${connection}`} role="status" data-testid="connection">
          {status === 'error' ? '⚠ Sin acceso' : connection === 'live' ? (unsent ? '● Guardando…' : '● En vivo') : '○ Reconectando…'}
        </span>
        <span className="avatars" aria-label={`${meta.members.length} personas`}>
          {meta.members.slice(0, 5).map((m) => <span key={m.userId} className="avatar" title={`${m.name} (${m.role})`}>{m.name.slice(0, 1).toUpperCase()}</span>)}
        </span>
        <button type="button" className="secondary" onClick={() => setSharing(true)}>Compartir</button>
      </header>
      <BoardView state={state} canEdit={canEdit} send={send} />
      {sharing && <ShareDialog boardId={boardId} members={meta.members} isOwner={meta.role === 'owner'} onClose={() => setSharing(false)} />}
    </main>
  )
}
