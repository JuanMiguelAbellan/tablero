import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Link, useRouter } from '../router'

function nextPath(): string {
  const n = new URLSearchParams(location.search).get('next')
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/' // only same-site paths: no open redirect
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth()
  const { navigate } = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await login(email, password)
      else await register(name, email, password)
      navigate(nextPath(), true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
      setBusy(false)
    }
  }
  const next = location.search

  return (
    <main className="wrap narrow">
      <h1>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</h1>
      <form onSubmit={submit} className="card-panel">
        {mode === 'register' && (<><label htmlFor="name">Nombre</label><input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" required /></>)}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <label htmlFor="password">Contraseña{mode === 'register' ? ' (mínimo 8 caracteres)' : ''}</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        {error && <p className="notice err" role="alert">{error}</p>}
        <p><button type="submit" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button></p>
      </form>
      <p className="muted">
        {mode === 'login' ? <>¿No tienes cuenta? <Link to={`/register${next}`}>Regístrate</Link></> : <>¿Ya tienes cuenta? <Link to={`/login${next}`}>Entra</Link></>}
      </p>
    </main>
  )
}
