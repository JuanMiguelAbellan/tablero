import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'

interface Router {
  path: string
  navigate: (to: string, replace?: boolean) => void
}
const Ctx = createContext<Router>({ path: '/', navigate: () => {} })

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => location.pathname + location.search)
  useEffect(() => {
    const onPop = () => setPath(location.pathname + location.search)
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string, replace = false) => {
    history[replace ? 'replaceState' : 'pushState'](null, '', to)
    setPath(to)
    scrollTo(0, 0)
  }, [])
  const value = useMemo(() => ({ path, navigate }), [path, navigate])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useRouter = () => useContext(Ctx)

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { navigate } = useRouter()
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={onClick} className={className}>{children}</a>
}
