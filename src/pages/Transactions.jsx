import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext.jsx'
import { db } from '../lib/firebase.js'
import {
  createManualTrade,
  emptyTradeForm,
  FALLBACK_MARKET,
  localDateToIsoDate,
  mostRecentManualMarket,
  readLastMarket,
  softDeleteManualTrade,
  todayInMelbourne,
  tradeDocToForm,
  updateManualTrade,
  warnIfClosedFinancialYear,
  writeLastMarket,
} from '../lib/manualTrades.js'
import { rebuildParcelsForUser } from '../lib/rebuildParcels.js'
import { TradeForm } from '../components/transactions/TradeForm.jsx'

const ADD_OPEN_KEY = 'pp:transactions:addTradeOpen'

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 2,
})

const qtyFmt = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 8 })
const priceFmt = new Intl.NumberFormat('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

const SOURCE_PILL = {
  sharesight: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',
  manual: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  ig: 'bg-teal-500/15 text-teal-300 ring-teal-500/30',
}

function readInitialOpen() {
  try {
    const stored = window.localStorage.getItem(ADD_OPEN_KEY)
    // No stored preference means this is the first visit: start expanded.
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

/** Firestore doc → table row. */
function toRow(id, x) {
  const date =
    x.executedAt && typeof x.executedAt.toDate === 'function'
      ? x.executedAt.toDate()
      : new Date(x.executedAt ?? 0)
  const type = String(x.sharesightType ?? '').toLowerCase()
  const totalAud =
    x.totalCostAud != null
      ? Number(x.totalCostAud)
      : x.netProceedsAud != null
        ? Number(x.netProceedsAud)
        : x.amountAud != null
          ? Number(x.amountAud)
          : null

  return {
    id,
    type,
    date,
    tradeDate: x.tradeDate ?? localDateToIsoDate(date),
    ticker: x.ticker ?? '',
    code: x.code ?? null,
    market: x.market ?? '',
    name: x.name ?? '',
    quantity: x.quantity != null ? Number(x.quantity) : null,
    quantityDelta: x.quantityDelta != null ? Number(x.quantityDelta) : null,
    pricePerUnit: x.pricePerUnit != null ? Number(x.pricePerUnit) : null,
    priceCurrency: x.priceCurrency ?? x.quoteCurrency ?? '',
    quoteCurrency: x.quoteCurrency ?? '',
    brokerage: x.brokerage != null ? Number(x.brokerage) : null,
    fxRate: x.fxRate != null ? Number(x.fxRate) : null,
    totalAud,
    notes: x.notes ?? '',
    sourceBroker: String(x.sourceBroker ?? x.source ?? 'sharesight').toLowerCase(),
    rawType: x.rawType ?? '',
  }
}

function TypePill({ type }) {
  const base =
    'inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1'
  if (type === 'buy') {
    return (
      <span className={`${base} bg-emerald-500/15 text-emerald-300 ring-emerald-500/30`}>
        Buy
      </span>
    )
  }
  if (type === 'sell') {
    return (
      <span className={`${base} bg-rose-500/15 text-rose-300 ring-rose-500/30`}>
        Sell
      </span>
    )
  }
  return (
    <span className={`${base} bg-slate-600/25 text-slate-300 ring-slate-500/30`}>
      {String(type || 'other').replace(/_/g, ' ')}
    </span>
  )
}

function SourcePill({ source }) {
  const tone = SOURCE_PILL[source] ?? 'bg-slate-600/25 text-slate-300 ring-slate-500/30'
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${tone}`}
    >
      {source}
    </span>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.379-8.379-2.828-2.828Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path
        fillRule="evenodd"
        d="M8.5 2a1 1 0 0 0-.98.8L7.32 4H4a1 1 0 0 0 0 2h12a1 1 0 1 0 0-2h-3.32l-.2-1.2A1 1 0 0 0 11.5 2h-3ZM5.5 7.5h9l-.63 8.2A2 2 0 0 1 11.88 17.5H8.12a2 2 0 0 1-1.99-1.8L5.5 7.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

const DISABLED_HINT = 'Re-import Sharesight to change this trade'

/**
 * A disabled <button> receives no pointer events, so its own `title` never
 * appears. The tooltip lives on the wrapping span instead.
 */
function ActionButton({ enabled, label, hoverClass, onClick, children }) {
  const title = enabled ? label : DISABLED_HINT
  return (
    <span title={title} className="inline-flex">
      <button
        type="button"
        disabled={!enabled}
        onClick={onClick}
        aria-label={title}
        className={
          enabled
            ? `rounded-md p-1.5 text-slate-300 transition-colors hover:bg-slate-700 ${hoverClass}`
            : 'cursor-not-allowed rounded-md p-1.5 text-slate-500'
        }
      >
        {children}
      </button>
    </span>
  )
}

function Modal({ titleId, children, onClose, busy, maxWidth = 'max-w-lg' }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${maxWidth} rounded-2xl border border-slate-700/80 bg-slate-800/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30`}
      >
        {children}
      </div>
    </div>
  )
}

export function Transactions() {
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [addOpen, setAddOpen] = useState(readInitialOpen)
  const [addForm, setAddForm] = useState(() =>
    emptyTradeForm(todayInMelbourne(), readLastMarket() ?? FALLBACK_MARKET),
  )
  // A stored preference wins outright; otherwise we seed once from the user's
  // latest manual trade when the ledger first arrives.
  const marketSeeded = useRef(readLastMarket() !== null)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [editRow, setEditRow] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState('')

  const [deleteRow, setDeleteRow] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortDir, setSortDir] = useState('desc')

  const showToast = useCallback((tone, message) => {
    setToast({ tone, message })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  useEffect(() => {
    try {
      window.localStorage.setItem(ADD_OPEN_KEY, String(addOpen))
    } catch {
      // Private browsing / storage disabled — the default is fine.
    }
  }, [addOpen])

  useEffect(() => {
    if (!db || !user) {
      queueMicrotask(() => {
        setRows([])
        setLoading(false)
      })
      return undefined
    }
    queueMicrotask(() => setLoading(true))
    const col = collection(db, 'users', user.uid, 'transactions')
    const unsub = onSnapshot(
      col,
      (snap) => {
        const next = []
        snap.forEach((d) => {
          const x = d.data()
          if (x.deleted === true) return
          next.push(toRow(d.id, x))
        })
        setRows(next)
        setLoadError('')
        setLoading(false)
      },
      (err) => {
        setLoadError(err?.message ?? 'Could not load transactions.')
        setLoading(false)
      },
    )
    return () => unsub()
  }, [user])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const from = dateFrom ? dateFrom : null
    const to = dateTo ? dateTo : null

    const out = rows.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (sourceFilter !== 'all' && r.sourceBroker !== sourceFilter) return false
      if (from && r.tradeDate < from) return false
      if (to && r.tradeDate > to) return false
      if (q) {
        const hay = `${r.ticker} ${r.code ?? ''} ${r.notes}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    out.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime()
      if (diff !== 0) return sortDir === 'asc' ? diff : -diff
      return a.ticker.localeCompare(b.ticker)
    })
    return out
  }, [rows, search, typeFilter, sourceFilter, dateFrom, dateTo, sortDir])

  const manualCount = useMemo(
    () => rows.filter((r) => r.sourceBroker === 'manual').length,
    [rows],
  )

  useEffect(() => {
    if (marketSeeded.current || rows.length === 0) return
    const market = mostRecentManualMarket(rows)
    if (!market) return
    marketSeeded.current = true
    queueMicrotask(() =>
      setAddForm((prev) =>
        // Never overwrite a form the user has already started filling in.
        prev.ticker || prev.quantity || prev.price
          ? prev
          : emptyTradeForm(prev.tradeDate, market),
      ),
    )
  }, [rows])

  const resetAddForm = useCallback(() => {
    // Keep the date and market for rapid entry of several trades in a row.
    setAddForm((prev) =>
      emptyTradeForm(prev.tradeDate, readLastMarket() ?? prev.market),
    )
    setFormError('')
  }, [])

  async function handleAdd(values) {
    if (!user) {
      setFormError('You must be signed in to add a trade.')
      return
    }
    setAddSubmitting(true)
    setFormError('')
    try {
      warnIfClosedFinancialYear(values)
      await createManualTrade(user.uid, values)
      writeLastMarket(values.market)
      marketSeeded.current = true
      const { parcelCount } = await rebuildParcelsForUser(user.uid)
      showToast(
        'success',
        `Added: ${values.type.toUpperCase()} ${qtyFmt.format(values.quantity)} ${values.code} @ ${priceFmt.format(values.price)} ${values.currency} · ${parcelCount} parcels rebuilt`,
      )
      resetAddForm()
    } catch (err) {
      setFormError(err?.message ?? 'Could not save the trade.')
    } finally {
      setAddSubmitting(false)
    }
  }

  // The form's live-FX lookup is async and may resolve after the modal has
  // closed; ignore those updates rather than resurrecting an empty form.
  const updateEditForm = useCallback((next) => {
    setEditForm((prev) => {
      if (prev == null) return prev
      return typeof next === 'function' ? next(prev) : next
    })
  }, [])

  function openEdit(row) {
    setEditRow(row)
    setEditForm(tradeDocToForm(row))
    setEditError('')
  }

  function closeEdit() {
    setEditRow(null)
    setEditForm(null)
    setEditError('')
  }

  async function handleEdit(values) {
    if (!user || !editRow) return
    setEditSubmitting(true)
    setEditError('')
    try {
      warnIfClosedFinancialYear(values)
      await updateManualTrade(user.uid, editRow.id, values)
      const { parcelCount } = await rebuildParcelsForUser(user.uid)
      showToast(
        'success',
        `Updated: ${values.type.toUpperCase()} ${qtyFmt.format(values.quantity)} ${values.code} · ${parcelCount} parcels rebuilt`,
      )
      closeEdit()
    } catch (err) {
      setEditError(err?.message ?? 'Could not save changes.')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!user || !deleteRow) return
    setDeleting(true)
    setDeleteError('')
    try {
      await softDeleteManualTrade(user.uid, deleteRow.id)
      const { parcelCount } = await rebuildParcelsForUser(user.uid)
      showToast(
        'success',
        `Deleted: ${deleteRow.type.toUpperCase()} ${deleteRow.ticker} · ${parcelCount} parcels rebuilt`,
      )
      setDeleteRow(null)
    } catch (err) {
      setDeleteError(err?.message ?? 'Could not delete the trade.')
    } finally {
      setDeleting(false)
    }
  }

  const filterInput =
    'rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40'

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Transactions
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Hand-entered trades sit alongside your Sharesight import. Every add,
          edit or delete rebuilds parcels from the whole ledger, so the Dashboard
          and CGT Report stay in sync.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 ring-1 ring-slate-700/40">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          aria-expanded={addOpen}
          className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-slate-700/20"
        >
          <span>
            <span className="text-sm font-semibold text-slate-100">Add trade</span>
            <span className="ml-3 text-xs text-slate-500">
              {manualCount} manual {manualCount === 1 ? 'trade' : 'trades'} recorded
            </span>
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {addOpen ? 'Hide' : 'Show'}
          </span>
        </button>

        {addOpen ? (
          <div className="border-t border-slate-700/80 px-6 py-6">
            <TradeForm
              idPrefix="add-trade"
              value={addForm}
              onChange={setAddForm}
              onSubmit={handleAdd}
              onReset={resetAddForm}
              submitting={addSubmitting}
              submitLabel="Add trade"
              footer={
                formError ? (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    {formError}
                  </p>
                ) : null
              }
            />
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 ring-1 ring-slate-700/40">
        <div className="border-b border-slate-700/80 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-100">All transactions</h3>
          <p className="mt-1 text-xs text-slate-500">
            {loading
              ? 'Loading…'
              : `${filtered.length} of ${rows.length} shown`}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-700/80 bg-slate-900/40 px-6 py-4">
          <div className="min-w-[200px] flex-1">
            <label
              htmlFor="tx-search"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Search
            </label>
            <input
              id="tx-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ticker or notes"
              className={`${filterInput} w-full`}
            />
          </div>
          <div>
            <label
              htmlFor="tx-type"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Type
            </label>
            <select
              id="tx-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={filterInput}
            >
              <option value="all">All</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="tx-source"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Source
            </label>
            <select
              id="tx-source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className={filterInput}
            >
              <option value="all">All</option>
              <option value="sharesight">Sharesight</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="tx-from"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              From
            </label>
            <input
              id="tx-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={filterInput}
            />
          </div>
          <div>
            <label
              htmlFor="tx-to"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              To
            </label>
            <input
              id="tx-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className={filterInput}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setTypeFilter('all')
              setSourceFilter('all')
              setDateFrom('')
              setDateTo('')
            }}
            className="rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700"
          >
            Clear
          </button>
        </div>

        {loadError ? (
          <p className="px-6 py-4 text-sm text-rose-300">{loadError}</p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                    className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-slate-300"
                    aria-label={`Sort by date, currently ${sortDir === 'desc' ? 'newest first' : 'oldest first'}`}
                  >
                    Date <span aria-hidden>{sortDir === 'desc' ? '↓' : '↑'}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Ticker</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-left">Ccy</th>
                <th className="px-4 py-3 text-right">Total AUD</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="sticky right-0 border-l border-slate-700/60 bg-slate-900 px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Loading transactions…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    {rows.length === 0
                      ? 'No transactions yet — add one above or run a Sharesight import.'
                      : 'No transactions match these filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const editable = r.sourceBroker === 'manual'
                  const qty = r.quantity ?? r.quantityDelta
                  return (
                    <tr
                      key={r.id}
                      title={r.notes || undefined}
                      className="hover:bg-slate-700/20"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums text-slate-300">
                        {r.tradeDate || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <TypePill type={r.type} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-100">
                            {r.ticker || '—'}
                          </span>
                          {r.market ? (
                            <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              {r.market}
                            </span>
                          ) : null}
                        </div>
                        {r.name ? (
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {r.name}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                        {qty != null ? qtyFmt.format(qty) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                        {r.pricePerUnit != null
                          ? priceFmt.format(r.pricePerUnit)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {r.priceCurrency || r.quoteCurrency || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-100">
                        {r.totalAud != null ? aud.format(r.totalAud) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <SourcePill source={r.sourceBroker} />
                      </td>
                      <td className="sticky right-0 border-l border-slate-700/60 bg-slate-900 px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <ActionButton
                            enabled={editable}
                            label={`Edit ${r.ticker} trade`}
                            hoverClass="hover:text-sky-300"
                            onClick={() => openEdit(r)}
                          >
                            <PencilIcon />
                          </ActionButton>
                          <ActionButton
                            enabled={editable}
                            label={`Delete ${r.ticker} trade`}
                            hoverClass="hover:text-rose-300"
                            onClick={() => {
                              setDeleteError('')
                              setDeleteRow(r)
                            }}
                          >
                            <TrashIcon />
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editRow && editForm ? (
        <Modal titleId="edit-trade-title" onClose={closeEdit} busy={editSubmitting} maxWidth="max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <h3
              id="edit-trade-title"
              className="text-lg font-semibold tracking-tight text-white"
            >
              Edit trade
            </h3>
            <button
              type="button"
              onClick={closeEdit}
              disabled={editSubmitting}
              className="rounded-md px-2 py-1 text-sm text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Saving rebuilds parcels, so CGT numbers will change.
          </p>
          <div className="mt-5">
            <TradeForm
              idPrefix="edit-trade"
              value={editForm}
              onChange={updateEditForm}
              onSubmit={handleEdit}
              submitting={editSubmitting}
              submitLabel="Save changes"
              footer={
                editError ? (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    {editError}
                  </p>
                ) : null
              }
            />
          </div>
        </Modal>
      ) : null}

      {deleteRow ? (
        <Modal
          titleId="delete-trade-title"
          onClose={() => setDeleteRow(null)}
          busy={deleting}
        >
          <h3
            id="delete-trade-title"
            className="text-lg font-semibold tracking-tight text-white"
          >
            Delete this trade?
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            This will rebuild parcels and CGT numbers will change.
          </p>
          <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-900/50 px-4 py-3 text-sm">
            <p className="font-medium text-slate-100">
              {deleteRow.type.toUpperCase()} {qtyFmt.format(deleteRow.quantity ?? 0)}{' '}
              {deleteRow.ticker}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {deleteRow.tradeDate} ·{' '}
              {deleteRow.totalAud != null ? aud.format(deleteRow.totalAud) : '—'}
            </p>
          </div>

          {deleteError ? (
            <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {deleteError}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteRow(null)}
              disabled={deleting}
              className="rounded-lg border border-slate-600 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-rose-900/30 transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete trade'}
            </button>
          </div>
        </Modal>
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={[
            'fixed bottom-6 right-6 z-[60] max-w-sm rounded-xl border bg-slate-800/95 px-4 py-3 text-sm shadow-2xl shadow-black/50 ring-1',
            toast.tone === 'error'
              ? 'border-rose-500/30 text-rose-100 ring-rose-500/20'
              : 'border-emerald-500/30 text-emerald-100 ring-emerald-500/20',
          ].join(' ')}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
