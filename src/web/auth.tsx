import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

export interface User {
  id: string
  email: string
  name: string
}
interface AuthCtx {
  user: User | null | undefined // undefined = still checking
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}
const Ctx = createContext<AuthCtx>(null as never)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => {
    api<{ user: User }>('GET', '/api/me').then((r) => setUser(r.user), () => setUser(null))
  }, [])
  const login = useCallback(async (email: string, password: string) => setUser((await api<{ user: User }>('POST', '/api/auth/login', { email, password })).user), [])
  const register = useCallback(async (name: string, email: string, password: string) => setUser((await api<{ user: User }>('POST', '/api/auth/register', { name, email, password })).user), [])
  const logout = useCallback(async () => { await api('POST', '/api/auth/logout'); setUser(null) }, [])
  return <Ctx.Provider value={{ user, login, register, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
