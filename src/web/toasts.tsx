import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface Toast { id: number; text: string }
const Ctx = createContext<(text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
