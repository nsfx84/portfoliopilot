import { useState } from 'react'
import { isFirebaseConfigured } from '../lib/firebase'
import {
  NOT_INVITED_MESSAGE,
  useAuth,
} from '../contexts/AuthContext.jsx'

export function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const configured = isFirebaseConfigured()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!configured) {
      setError('Firebase is not configured. Add VITE_FIREBASE_* keys to .env.local.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
      } else {
        await signUp(email.trim(), password)
      }
    } catch (err) {
      if (err?.code === 'auth/not-invited') {
        setError(NOT_INVITED_MESSAGE)
      } else {
        setError(err?.message ?? 'Authentication failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-12 text-slate-100 antialiased">
      <div className="mb-10 flex flex-col items-center text-center">
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/25 to-indigo-600/25 text-base font-bold tracking-tight text-sky-300 ring-1 ring-sky-500/35 shadow-lg shadow-black/30"
          aria-hidden
        >
          PP
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          PortfolioPilot
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Sign in to track ASX, US, crypto and ETFs with AUD reporting.
        </p>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-slate-700/80 bg-slate-800/70 p-6 shadow-xl shadow-black/40 ring-1 ring-slate-600/30">
        <div className="mb-6 flex rounded-lg bg-slate-900/80 p-1 ring-1 ring-slate-700/80">
          <button
            type="button"
            onClick={() => {
              setMode('signin')
              setError('')
            }}
            className={
              mode === 'signin'
                ? 'flex-1 rounded-md bg-slate-700 py-2 text-sm font-medium text-white shadow-md'
                : 'flex-1 rounded-md py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white'
            }
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError('')
            }}
            className={
              mode === 'signup'
                ? 'flex-1 rounded-md bg-slate-700 py-2 text-sm font-medium text-white shadow-md'
                : 'flex-1 rounded-md py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white'
            }
          >
            Create account
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-slate-600 placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-slate-600 placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
