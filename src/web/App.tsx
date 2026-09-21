import { useEffect } from 'react'
import { useAuth } from './auth'
import { BoardPage } from './pages/BoardPage'
import { AuthPage } from './pages/AuthPages'
import { HomePage } from './pages/HomePage'
import { JoinPage } from './pages/JoinPage'
import { useRouter } from './router'

export function App() {
  const { user } = useAuth()
  const { path, navigate } = useRouter()
  const pathname = path.split('?')[0]!
  const isAuthPage = pathname === '/login' || pathname === '/register'
  const isJoin = pathname.startsWith('/join/')

  useEffect(() => {
    if (user === null && !isAuthPage && !isJoin) navigate(`/login${pathname === '/' ? '' : `?next=${encodeURIComponent(path)}`}`, true)
    if (user && isAuthPage) navigate('/', true)
  }, [user, isAuthPage, isJoin, path, pathname, navigate])

  useEffect(() => {
    document.title = 'Tablero'
  }, [])

  if (user === undefined) return <main className="wrap"><p className="muted" role="status">Cargando…</p></main>
  if (pathname === '/login') return <AuthPage mode="login" />
  if (pathname === '/register') return <AuthPage mode="register" />
  if (isJoin) return <JoinPage token={pathname.slice('/join/'.length)} />
  if (!user) return null
  const board = /^\/b\/([0-9a-f-]{36})$/.exec(pathname)
  if (board) return <BoardPage boardId={board[1]!} />
  return <HomePage />
}
