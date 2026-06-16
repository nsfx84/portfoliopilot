import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import {
  deleteCashAccount,
  listCashAccounts,
} from '../../lib/netWorthService.js'
import { CashAccountForm } from './CashAccountForm.jsx'

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

const pct = new Intl.NumberFormat('en-AU', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})

const TYPE_LABELS = {
  savings: 'Savings',
  offset: 'Offset',
  checking: 'Checking',
}

function formatAud(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return aud.format(value)
}

function formatRate(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return pct.format(value)
}

export function CashAccountList({ onNetWorthChange }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      queueMicrotask(() => {
        setAccounts([])
        setLoading(false)
        setError(null)
      })
      return undefined
    }

    let cancelled = false
    queueMicrotask(() => {
      setLoading(true)
      setError(null)
    })

    listCashAccounts(user.uid)
      .then((list) => {
        if (!cancelled) {
          setAccounts(list)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user, refreshKey])

  function openAdd() {
    setEditingAccount(null)
    setFormOpen(true)
  }

  function openEdit(account) {
    setEditingAccount(account)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingAccount(null)
  }

  function handleSaved() {
    bumpRefresh()
    onNetWorthChange?.()
  }

  async function handleDelete(account) {
    if (!user?.uid) return
    const confirmed = window.confirm(
      `Delete "${account.name}"? This cannot be undone.`,
    )
    if (!confirmed) return

    setDeletingId(account.id)
    setError(null)
    try {
      await deleteCashAccount(user.uid, account.id)
      bumpRefresh()
      onNetWorthChange?.()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 shadow-xl shadow-black/35 ring-1 ring-slate-700/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 bg-slate-800/55 px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Cash accounts
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Bank balances · stored as AUD-equivalent
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500"
          >
            Add cash account
          </button>
        </div>

        {error ? (
          <div className="border-b border-slate-700/80 px-6 py-3">
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error.message}
            </p>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700/80 bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3 font-semibold">Name</th>
                <th className="px-6 py-3 font-semibold">Provider</th>
                <th className="px-6 py-3 font-semibold">Currency</th>
                <th className="px-6 py-3 font-semibold">Type</th>
                <th className="px-6 py-3 text-right font-semibold">
                  Balance (AUD)
                </th>
                <th className="px-6 py-3 text-right font-semibold">
                  Interest rate
                </th>
                <th className="px-6 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    Loading cash accounts…
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-14 text-center align-middle"
                  >
                    <p className="text-slate-400">No cash accounts yet.</p>
                    <button
                      type="button"
                      onClick={openAdd}
                      className="mt-4 inline-flex rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500"
                    >
                      Add your first cash account
                    </button>
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr
                    key={account.id}
                    className="transition-colors duration-150 hover:bg-slate-700/20"
                  >
                    <td className="px-6 py-3.5 align-middle font-semibold text-slate-50">
                      {account.name}
                    </td>
                    <td className="px-6 py-3.5 align-middle text-slate-300">
                      {account.provider || '—'}
                    </td>
                    <td className="px-6 py-3.5 align-middle text-slate-300">
                      {account.currency ?? '—'}
                    </td>
                    <td className="px-6 py-3.5 align-middle text-slate-300">
                      {TYPE_LABELS[account.type] ?? account.type ?? '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-white">
                      {formatAud(account.balanceAUD)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                      {formatRate(account.interestRate)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(account)}
                          className="rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(account)}
                          disabled={deletingId === account.id}
                          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:border-rose-400/50 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === account.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <CashAccountForm
        open={formOpen}
        account={editingAccount}
        uid={user?.uid}
        onClose={closeForm}
        onSaved={handleSaved}
      />
    </>
  )
}
