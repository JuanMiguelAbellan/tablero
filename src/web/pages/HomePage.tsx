import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Link, useRouter } from '../router'

interface BoardSummary { id: string; name: string; role: string }

export function HomePage() {
  const { user, logout } = useAuth()
  const { navigate } = useRouter()
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { api<{ boards: BoardSummary[] }>('GET', '/api/boards').then((r) => setBoards(r.boards), (e) => setError(e.message)) }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      const r = await api<{ id: string }>('POST', '/api/boards', { name })
      navigate(`/b/${r.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  return (
    <main className="wrap">
      <header className="topbar">
        <span className="brand">Tablero</span>
        <span className="row-inline">
          <span className="muted">{user?.name}</span>
          <button type="button" className="secondary" onClick={() => logout()}>Salir</button>
        </span>
      </header>
      <h1>Mis tableros</h1>
      {error && <p className="notice err" role="alert">{error}</p>}
      <form onSubmit={create} className="row create-board">
        <label className="sr-only" htmlFor="board-name">Nombre del tablero</label>
        <input id="board-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nombre del nuevo tablero" required />
        <button type="submit">Crear tablero</button>
      </form>
      {boards === null ? <p className="muted" role="status">Cargando…</p> : boards.length === 0 ? <p className="muted">Aún no tienes tableros: crea el primero.</p> : (
        <ul className="board-list">
          {boards.map((b) => (
            <li key={b.id}><Link to={`/b/${b.id}`} className="board-tile"><strong>{b.name}</strong><span className="pill">{b.role === 'owner' ? 'propietario' : b.role === 'editor' ? 'edita' : 'solo lectura'}</span></Link></li>
          ))}
        </ul>
      )}
    </main>
  )
}
