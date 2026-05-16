import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  buildParcelsFromTransactions,
  parseSharesightAllTradesReport,
} from '../lib/sharesightImporter.js'
import { replaceUserTransactionsAndParcels } from '../lib/userData.js'

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 2,
})

const qtyFmt = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 8 })

export function Import() {
  const { user } = useAuth()
  const [parseResult, setParseResult] = useState(null)
  const [built, setBuilt] = useState(null)
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [progress, setProgress] = useState('')

  const onFile = useCallback((e) => {
    const f = e.target.files?.[0]
    setError('')
    setSaveOk(false)
    setProgress('')
    setBuilt(null)
    setParseResult(null)
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please choose an .xlsx file.')
      return
    }
    setFilename(f.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const ab = reader.result
        if (!(ab instanceof ArrayBuffer)) {
          setError('Could not read file.')
          return
        }
        const { transactions, warnings } = parseSharesightAllTradesReport(ab)
        const b = buildParcelsFromTransactions(transactions)
        setParseResult({ transactions, warnings })
        setBuilt(b)
      } catch (err) {
        setError(err?.message ?? 'Failed to parse workbook.')
      }
    }
    reader.onerror = () => setError('Failed to read file.')
    reader.readAsArrayBuffer(f)
  }, [])

  const stats = useMemo(() => {
    if (!parseResult) return null
    const txs = parseResult.transactions
    const buys = txs.filter((t) => t.type === 'buy').length
    const sells = txs.filter((t) => t.type === 'sell').length
    const splits = txs.filter((t) => t.type === 'split').length
    const cons = txs.filter((t) => t.type === 'consolidation').length
    const roc = txs.filter((t) => t.type === 'return_of_capital').length
    let minD = null
    let maxD = null
    const tickers = new Set()
    for (const t of txs) {
      if (t.ticker) tickers.add(t.ticker)
      if (t.date) {
        const ms = t.date.getTime()
        if (minD === null || ms < minD) minD = ms
        if (maxD === null || ms > maxD) maxD = ms
      }
    }
    return {
      total: txs.length,
      buys,
      sells,
      splits,
      cons,
      roc,
      dateMin: minD ? new Date(minD) : null,
      dateMax: maxD ? new Date(maxD) : null,
      uniqueTickers: tickers.size,
    }
  }, [parseResult])

  async function onConfirmSave() {
    if (!user || !parseResult || !built) return
    setError('')
    setSaving(true)
    setSaveOk(false)
    setProgress('Saving to Firestore…')
    try {
      await replaceUserTransactionsAndParcels(
        user.uid,
        parseResult.transactions,
        built.parcels,
      )
      setSaveOk(true)
      setProgress('Import saved.')
    } catch (err) {
      setError(err?.message ?? 'Save failed.')
      setProgress('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Sharesight import
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Upload an <span className="font-mono text-slate-400">All Trades</span>{' '}
          XLSX export. We read the <span className="font-mono">Combined</span>{' '}
          sheet and rebuild parcels with FIFO. Saving replaces your existing
          imported transactions and parcels for this account.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/80 bg-slate-800/35 p-6 shadow-xl ring-1 ring-slate-700/40">
        <label className="block text-sm font-medium text-slate-300">
          XLSX file
        </label>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFile}
          className="mt-3 block w-full cursor-pointer text-sm text-slate-400 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
        />
        {filename ? (
          <p className="mt-2 text-xs text-slate-500">Selected: {filename}</p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}
      </div>

      {parseResult && stats ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-700/80 bg-slate-800/35 p-6 ring-1 ring-slate-700/40">
            <h3 className="text-sm font-semibold text-slate-100">Summary</h3>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-slate-500">Transactions</dt>
                <dd className="font-mono text-lg text-white">{stats.total}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Buys / sells</dt>
                <dd className="font-mono text-white">
                  {stats.buys} / {stats.sells}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Splits / consolidations / ROC</dt>
                <dd className="font-mono text-white">
                  {stats.splits} / {stats.cons} / {stats.roc}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Date range</dt>
                <dd className="text-slate-300">
                  {stats.dateMin && stats.dateMax
                    ? `${stats.dateMin.toLocaleDateString('en-AU')} → ${stats.dateMax.toLocaleDateString('en-AU')}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Unique tickers</dt>
                <dd className="font-mono text-white">{stats.uniqueTickers}</dd>
              </div>
            </dl>
          </div>

          {parseResult.warnings?.length ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
              <h4 className="text-sm font-medium text-amber-100">Warnings</h4>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-100/90">
                {parseResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {built?.holdings?.length ? (
            <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 ring-1 ring-slate-700/40">
              <div className="border-b border-slate-700/80 px-6 py-4">
                <h3 className="text-sm font-semibold text-slate-100">
                  Reconstructed open holdings
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  From FIFO parcel rebuild (preview only until saved).
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-6 py-3 text-left">Ticker</th>
                      <th className="px-6 py-3 text-left">Market</th>
                      <th className="px-6 py-3 text-right">Qty</th>
                      <th className="px-6 py-3 text-right">Cost base (AUD)</th>
                      <th className="px-6 py-3 text-right">Avg / share (AUD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {built.holdings.map((h) => (
                      <tr key={h.ticker} className="hover:bg-slate-700/20">
                        <td className="px-6 py-3 font-medium text-slate-100">
                          {h.ticker}
                        </td>
                        <td className="px-6 py-3 text-slate-400">{h.market}</td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-200">
                          {qtyFmt.format(h.totalQuantity)}
                        </td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-200">
                          {aud.format(h.totalCostAud)}
                        </td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-200">
                          {aud.format(h.avgCostAud)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No open holdings reconstructed from this file (all positions
              closed or no buy rows).
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onConfirmSave}
              disabled={saving || !user}
              className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Confirm and save to Firestore'}
            </button>
            {progress ? (
              <span className="text-sm text-slate-400">{progress}</span>
            ) : null}
            {saveOk ? (
              <span className="text-sm font-medium text-emerald-400">
                Saved — view{' '}
                <Link to="/" className="underline hover:text-emerald-300">
                  Dashboard
                </Link>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
