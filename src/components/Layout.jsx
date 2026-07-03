import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

const navBase =
  'rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'

const signOutBtn =
  'rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white'

export function Layout() {
  const { signOut } = useAuth()

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 antialiased">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/95 shadow-md shadow-black/20 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/25 to-indigo-600/25 text-sm font-bold tracking-tight text-sky-300 ring-1 ring-sky-500/35 shadow-lg shadow-black/30"
              aria-hidden
            >
              PP
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-white sm:text-xl">
                PortfolioPilot
              </h1>
              <p className="truncate text-xs text-slate-500 sm:text-sm">
                ASX · US · Crypto · ETFs · AUD reporting
              </p>
            </div>
          </div>

          <nav
            className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2"
            aria-label="Primary"
          >
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/transactions"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Transactions
            </NavLink>
            <NavLink
              to="/import"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Import
            </NavLink>
            <NavLink
              to="/cgt-report"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              CGT Report
            </NavLink>
            <NavLink
              to="/income-report"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Income Report
            </NavLink>
            <NavLink
              to="/networth"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Net Worth
            </NavLink>
            <NavLink
              to="/statements"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Statements
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                [
                  navBase,
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-slate-600/70 shadow-md shadow-black/25'
                    : 'text-slate-400 hover:bg-slate-800/90 hover:text-white',
                ].join(' ')
              }
            >
              Settings
            </NavLink>
            <button type="button" onClick={() => signOut()} className={signOutBtn}>
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
