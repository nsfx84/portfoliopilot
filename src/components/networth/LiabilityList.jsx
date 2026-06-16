import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import {
  deleteLiability,
  listLiabilities,
  listProperties,
} from '../../lib/netWorthService.js'
import { LiabilityForm } from './LiabilityForm.jsx'

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
  mortgage: 'Mortgage',
  credit_card: 'Credit card',
  personal: 'Personal loan',
  car_loan: 'Car loan',
}

function formatAud(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return aud.format(value)
}

function formatRate(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return pct.format(value)
}

export function LiabilityList({ onNetWorthChange }) {
  const { user } = useAuth()
  const [liabilities, setLiabilities] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const propertyNameById = useMemo(() => {
    const map = new Map()
    for (const property of properties) {
      map.set(property.id, property.name)
    }
    return map
  }, [properties])

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      queueMicrotask(() => {
        setLiabilities([])
        setProperties([])
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

    Promise.all([listLiabilities(user.uid), listProperties(user.uid)])
      .then(([liabilityList, propertyList]) => {
        if (!cancelled) {
          setLiabilities(liabilityList)
          setProperties(propertyList)
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
    setEditingLiability(null)
    setFormOpen(true)
  }

  function openEdit(liability) {
    setEditingLiability(liability)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingLiability(null)
  }

  function handleSaved() {
    bumpRefresh()
    onNetWorthChange?.()
  }

  async function handleDelete(liability) {
    if (!user?.uid) return
    const confirmed = window.confirm(
      `Delete "${liability.name}"? This cannot be undone.`,
    )
    if (!confirmed) return

    setDeletingId(liability.id)
    setError(null)
    try {
      await deleteLiability(user.uid, liability.id)
      bumpRefresh()
      onNetWorthChange?.()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setDeletingId(null)
    }
  }

  function linkedPropertyLabel(linkedPropertyId) {
    if (!linkedPropertyId) return '—'
    return propertyNameById.get(linkedPropertyId) ?? '—'
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 shadow-xl shadow-black/35 ring-1 ring-slate-700/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 bg-slate-800/55 px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Liabilities
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Mortgages · loans · credit cards
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500"
          >
            Add liability
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
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700/80 bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3 font-semibold">Name</th>
                <th className="px-6 py-3 font-semibold">Linked property</th>
                <th className="px-6 py-3 font-semibold">Lender</th>
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
                    Loading liabilities…
                  </td>
                </tr>
              ) : liabilities.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-14 text-center align-middle"
                  >
                    <p className="text-slate-400">No liabilities yet.</p>
                    <button
                      type="button"
                      onClick={openAdd}
                      className="mt-4 inline-flex rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500"
                    >
                      Add your first liability
                    </button>
                  </td>
                </tr>
              ) : (
                liabilities.map((liability) => (
                  <tr
                    key={liability.id}
                    className="transition-colors duration-150 hover:bg-slate-700/20"
                  >
                    <td className="px-6 py-3.5 align-middle font-semibold text-slate-50">
                      {liability.name}
                    </td>
                    <td className="px-6 py-3.5 align-middle text-slate-300">
                      {linkedPropertyLabel(liability.linkedPropertyId)}
                    </td>
                    <td className="px-6 py-3.5 align-middle text-slate-300">
                      {liability.lender || '—'}
                    </td>
                    <td className="px-6 py-3.5 align-middle text-slate-300">
                      {TYPE_LABELS[liability.type] ?? liability.type ?? '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-white">
                      {formatAud(liability.balanceAUD)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                      {formatRate(liability.interestRate)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(liability)}
                          className="rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(liability)}
                          disabled={deletingId === liability.id}
                          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:border-rose-400/50 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === liability.id ? 'Deleting…' : 'Delete'}
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

      <LiabilityForm
        open={formOpen}
        liability={editingLiability}
        uid={user?.uid}
        onClose={closeForm}
        onSaved={handleSaved}
      />
    </>
  )
}
