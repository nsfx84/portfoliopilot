import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext.jsx'
import { db } from '../lib/firebase'
import { fetchQuotes } from '../lib/prices.js'
import { convertQuoteToAud } from '../lib/valuation.js'
import {
  calculateAllMethodsComparison,
  calculateCgtForFY,
  firestoreParcelToCgtParcel,
  getFinancialYearBounds,
  isDateInRange,
  normalizeCgtMethod,
  normalizeFirestoreTransaction,
  previewSale,
  sortTransactionsForReplay,
} from '../lib/cgt.js'
import { buildCgtPdfReportData, exportCgtPdf } from '../lib/cgtSchedulePdf.js'

const FY_OPTIONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026]

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const audInt = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

const qtyFmt = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 8,
})

function fyLabel(fy) {
  return `FY${String(fy).slice(-2)}`
}

function hasSalesInFinancialYear(transactions, fy) {
  const { fyStart, fyEnd } = getFinancialYearBounds(fy)
  return transactions.some(
    (t) => t.type === 'sell' && isDateInRange(t.date, fyStart, fyEnd),
  )
}

function findPriorFyWithSales(currentFy, transactions) {
  for (let y = currentFy - 1; y >= FY_OPTIONS[0]; y--) {
    if (hasSalesInFinancialYear(transactions, y)) return y
  }
  return null
}

/** Tailwind-safe badge map — matches Dashboard Holdings. */
const ASSET_BADGES = {
  ASX: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  US: 'bg-sky-500/15 text-sky-300 ring-sky-500/25',
  NASDAQ: 'bg-sky-500/15 text-sky-300 ring-sky-500/25',
  NYSE: 'bg-sky-500/15 text-sky-300 ring-sky-500/25',
  ETF: 'bg-violet-500/15 text-violet-300 ring-violet-500/25',
  CRYPTO: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
  OTHER: 'bg-slate-500/15 text-slate-300 ring-slate-500/25',
}

function AssetBadge({ assetClass }) {
  const cls =
    ASSET_BADGES[assetClass] ??
    'bg-slate-500/15 text-slate-300 ring-slate-500/25'
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${cls}`}
    >
      {assetClass}
    </span>
  )
}

function pctClass(v) {
  if (v == null || Number.isNaN(v)) return 'text-slate-400'
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-rose-400'
  return 'text-slate-400'
}

function SummaryCard({
  label,
  primary,
  primaryClass,
  hint,
  loading,
  primarySizeClass,
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-700/80 bg-slate-800/70 p-5 shadow-lg shadow-black/40 ring-1 ring-slate-600/30 ${loading ? 'animate-pulse' : ''}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-3 font-semibold tracking-tight tabular-nums ${primarySizeClass ?? 'text-3xl'} ${primaryClass ?? 'text-white'}`}
      >
        {primary}
      </p>
      {hint ? (
        <p className="mt-3 text-xs leading-snug text-slate-600">{hint}</p>
      ) : null}
    </div>
  )
}

function saleMatchTotals(sale) {
  let cost = 0
  let gross = 0
  let taxable = 0
  for (const m of sale.matches) {
    cost += m.costBaseProRata
    gross += m.gain
    taxable += m.prePoolTaxableWeight
  }
  return { cost, gross, taxable }
}

export function CgtReport() {
  const { user } = useAuth()
  const [txDocs, setTxDocs] = useState([])
  const [txLoading, setTxLoading] = useState(true)
  const [parcelRows, setParcelRows] = useState([])
  const [parcelsLoading, setParcelsLoading] = useState(true)
  const [fy, setFy] = useState(2026)
  const [method, setMethod] = useState('FIFO')
  const [priorLosses, setPriorLosses] = useState(0)
  const [priceBundle, setPriceBundle] = useState(null)
  const [pricesLoading, setPricesLoading] = useState(false)
  const [unrealisedSort, setUnrealisedSort] = useState('taxDesc')

  useEffect(() => {
    if (!db || !user) {
      queueMicrotask(() => {
        setTxDocs([])
        setTxLoading(false)
      })
      return undefined
    }
    queueMicrotask(() => {
      setTxDocs([])
      setTxLoading(true)
    })
    const col = collection(db, 'users', user.uid, 'transactions')
    const unsub = onSnapshot(
      col,
      (snap) => {
        const rows = []
        snap.forEach((d) => rows.push(d))
        setTxDocs(rows)
        setTxLoading(false)
      },
      () => setTxLoading(false),
    )
    return () => unsub()
  }, [user])

  useEffect(() => {
    if (!db || !user) {
      queueMicrotask(() => {
        setParcelRows([])
        setParcelsLoading(false)
      })
      return undefined
    }
    queueMicrotask(() => {
      setParcelRows([])
      setParcelsLoading(true)
    })
    const col = collection(db, 'users', user.uid, 'parcels')
    const unsub = onSnapshot(
      col,
      (snap) => {
        const rows = []
        snap.forEach((d) => {
          const x = d.data()
          rows.push({
            id: d.id,
            ticker: x.ticker,
            market: x.market ?? '',
            name: x.name ?? null,
            assetClass: x.assetClass ?? null,
            quoteCurrency: x.quoteCurrency ?? null,
            remainingQuantity: Number(x.remainingQuantity),
            unitCostAud: Number(x.unitCostAud),
            totalCostAud:
              x.totalCostAud != null
                ? Number(x.totalCostAud)
                : Number(x.unitCostAud) * Number(x.remainingQuantity),
            acquiredAt: x.acquiredAt,
          })
        })
        setParcelRows(rows)
        setParcelsLoading(false)
      },
      () => setParcelsLoading(false),
    )
    return () => unsub()
  }, [user])

  const cgtTxs = useMemo(() => {
    const out = []
    for (const d of txDocs) {
      const n = normalizeFirestoreTransaction(d)
      if (n) out.push(n)
    }
    return sortTransactionsForReplay(out)
  }, [txDocs])

  const mNorm = normalizeCgtMethod(method)

  const result = useMemo(
    () => calculateCgtForFY(cgtTxs, null, fy, mNorm, priorLosses),
    [cgtTxs, fy, mNorm, priorLosses],
  )

  const comparison = useMemo(
    () => calculateAllMethodsComparison(cgtTxs, null, fy, priorLosses),
    [cgtTxs, fy, priorLosses],
  )

  const priorFyWithSales = useMemo(
    () => findPriorFyWithSales(fy, cgtTxs),
    [fy, cgtTxs],
  )

  const anyOtherFySales = useMemo(() => {
    return FY_OPTIONS.some((y) => y !== fy && hasSalesInFinancialYear(cgtTxs, y))
  }, [cgtTxs, fy])

  const uniqueTickers = useMemo(() => {
    const s = new Set(parcelRows.map((p) => p.ticker).filter(Boolean))
    return [...s].sort()
  }, [parcelRows])

  useEffect(() => {
    if (uniqueTickers.length === 0) {
      queueMicrotask(() => {
        setPriceBundle(null)
        setPricesLoading(false)
      })
      return undefined
    }
    let cancelled = false
    queueMicrotask(() => setPricesLoading(true))
    fetchQuotes(uniqueTickers)
      .then((b) => {
        if (!cancelled) {
          setPriceBundle(b)
          setPricesLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setPricesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [uniqueTickers])

  const unrealisedRows = useMemo(() => {
    const pmap = priceBundle?.prices || {}
    const fx = priceBundle?.fx || {}
    /** @type {Map<string, object[]>} */
    const groups = new Map()
    for (const row of parcelRows) {
      if (!(row.remainingQuantity > 0)) continue
      const key = `${row.ticker}|||${row.market ?? ''}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(firestoreParcelToCgtParcel(row))
    }

    const out = []
    for (const [key, lots] of groups) {
      const [ticker, market] = key.split('|||')
      const q = lots.reduce((s, l) => s + l.remainingQuantity, 0)
      const cost = lots.reduce((s, l) => s + l.totalCostAud, 0)
      const quote = pmap[ticker]
      const ccy = (quote?.currency || 'USD').toString()
      const priceAud = convertQuoteToAud(
        quote?.lastPrice,
        ccy,
        market || lots[0]?.market,
        fx,
      )
      const marketVal =
        priceAud != null && Number.isFinite(priceAud) ? priceAud * q : null
      const unrealised =
        marketVal != null ? marketVal - cost : null
      const preview =
        marketVal != null && q > 0
          ? previewSale(lots, ticker, market, q, priceAud, new Date(), mNorm)
          : null

      out.push({
        key,
        ticker,
        market,
        quantity: q,
        costBaseAud: cost,
        currentValueAud: marketVal,
        unrealisedAud: unrealised,
        taxableIfSold: preview?.taxableCapitalGainPreview ?? null,
        missingPrice: priceAud == null,
      })
    }

    const sorted = [...out]
    if (unrealisedSort === 'taxDesc') {
      sorted.sort(
        (a, b) =>
          (b.taxableIfSold ?? -Infinity) - (a.taxableIfSold ?? -Infinity),
      )
    } else if (unrealisedSort === 'taxAsc') {
      sorted.sort(
        (a, b) =>
          (a.taxableIfSold ?? Infinity) - (b.taxableIfSold ?? Infinity),
      )
    } else if (unrealisedSort === 'ticker') {
      sorted.sort((a, b) => a.ticker.localeCompare(b.ticker))
    }

    return sorted
  }, [parcelRows, priceBundle, mNorm, unrealisedSort])

  const cheapestMethodKey = useMemo(() => {
    const a = [
      ['FIFO', comparison.FIFO.taxableCapitalGain],
      ['LIFO', comparison.LIFO.taxableCapitalGain],
      ['MIN_GAIN', comparison.minGain.taxableCapitalGain],
    ]
    a.sort((x, y) => x[1] - y[1])
    return a[0][0]
  }, [comparison])

  const minGainVsFifo = useMemo(() => {
    const f = comparison.FIFO.taxableCapitalGain
    const m = comparison.minGain.taxableCapitalGain
    return Math.max(0, f - m)
  }, [comparison])

  const showMethodComparison = cgtTxs.some((t) => t.type === 'sell')

  const onExportPdf = useCallback(() => {
    exportCgtPdf(
      buildCgtPdfReportData({
        fy,
        methodCode: mNorm,
        generatedAt: new Date(),
        result,
        comparison,
      }),
    )
  }, [fy, mNorm, result, comparison])

  if (!user) {
    return null
  }

  const noSalesThisFy = !txLoading && result.sales.length === 0
  const showSchedule = result.sales.length > 0

  const netTaxClass = pctClass(result.taxableCapitalGain)

  return (
    <div className="space-y-10 bg-slate-900 text-slate-100 antialiased">
      <section>
        <div className="flex flex-col gap-1 border-b border-slate-800 pb-6">
          <h2 className="text-xl font-semibold tracking-tight text-white">
            CGT Report
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
            Capital gains tax schedule
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-800/70 px-4 py-3 shadow-lg shadow-black/40 ring-1 ring-slate-600/30 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="cgt-fy" className="sr-only">
              Financial year
            </label>
            <select
              id="cgt-fy"
              value={fy}
              onChange={(e) => setFy(Number(e.target.value))}
              className="cursor-pointer appearance-none rounded-full border border-slate-600 bg-slate-900 py-2 pl-4 pr-9 text-sm font-medium text-white shadow-inner shadow-black/30 outline-none ring-slate-500/30 hover:border-slate-500 focus:ring-2"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.65rem center',
                backgroundSize: '0.9rem',
              }}
            >
              {FY_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {fyLabel(y)}
                </option>
              ))}
            </select>
          </div>

          <div
            className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-600 bg-slate-900 shadow-inner shadow-black/40"
            role="group"
            aria-label="Parcel matching method"
          >
            {[
              ['FIFO', 'FIFO'],
              ['LIFO', 'LIFO'],
              ['Min-Gain', 'MIN_GAIN'],
            ].map(([label, val], i) => {
              const active = normalizeCgtMethod(method) === normalizeCgtMethod(val)
              const edges =
                i === 0
                  ? 'rounded-l-full'
                  : i === 2
                    ? 'rounded-r-full'
                    : 'rounded-none'
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setMethod(val)}
                  className={[
                    edges,
                    'border-slate-700 px-4 py-2 text-xs font-semibold transition-colors',
                    i > 0 ? 'border-l' : '',
                    active
                      ? 'bg-sky-600 text-white'
                      : 'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200',
                  ].join(' ')}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <label className="flex min-w-[8.5rem] flex-1 items-center gap-0 sm:max-w-xs">
            <span className="sr-only">Prior-year capital losses</span>
            <div className="relative flex min-w-0 flex-1 items-center">
              <span
                className="pointer-events-none absolute left-3.5 text-sm font-medium text-slate-500"
                aria-hidden
              >
                $
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={priorLosses === 0 ? '' : priorLosses}
                placeholder="0.00"
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '') setPriorLosses(0)
                  else setPriorLosses(Math.max(0, Number(v) || 0))
                }}
                className="w-full min-w-0 rounded-full border border-slate-600 bg-slate-900 py-2 pl-7 pr-4 text-sm tabular-nums text-white outline-none ring-slate-500/30 placeholder:text-slate-600 focus:ring-2"
              />
            </div>
          </label>

          <button
            type="button"
            onClick={onExportPdf}
            className="ml-auto shrink-0 rounded-lg border border-slate-600 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700"
          >
            Export PDF
          </button>
        </div>
      </section>

      {txLoading ? (
        <p className="text-sm text-slate-500">Loading transactions…</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard
          label="Net taxable capital gain"
          primary={aud.format(result.taxableCapitalGain)}
          primaryClass={netTaxClass}
          primarySizeClass="text-4xl"
          hint="Before income tax — after FY loss pooling & discount."
          loading={txLoading}
        />
        <SummaryCard
          label="Gross gains"
          primary={aud.format(result.grossGains)}
          primaryClass="text-emerald-400"
          loading={txLoading}
        />
        <SummaryCard
          label="Gross losses"
          primary={aud.format(result.grossLosses)}
          primaryClass="text-rose-400"
          loading={txLoading}
        />
        <SummaryCard
          label="Discount saved"
          primary={aud.format(result.discountSaved)}
          primaryClass="text-emerald-400/95"
          hint="50% discount applied"
          loading={txLoading}
        />
        <SummaryCard
          label="Loss carry-forward"
          primary={aud.format(result.lossCarryForward)}
          primaryClass={
            result.lossCarryForward > 0
              ? 'text-amber-400'
              : 'text-slate-500'
          }
          loading={txLoading}
        />
      </div>

      {showMethodComparison ? (
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/70 px-5 py-3.5 shadow-lg shadow-black/40 ring-1 ring-slate-600/30">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Method comparison
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-1 gap-y-1 text-sm">
            <span
              className={
                cheapestMethodKey === 'FIFO'
                  ? 'font-mono font-semibold tabular-nums text-emerald-400'
                  : 'font-mono tabular-nums text-slate-400'
              }
            >
              FIFO {aud.format(comparison.FIFO.taxableCapitalGain)}
            </span>
            <span className="text-slate-600">·</span>
            <span
              className={
                cheapestMethodKey === 'LIFO'
                  ? 'font-mono font-semibold tabular-nums text-emerald-400'
                  : 'font-mono tabular-nums text-slate-400'
              }
            >
              LIFO {aud.format(comparison.LIFO.taxableCapitalGain)}
            </span>
            <span className="text-slate-600">·</span>
            <span
              className={
                cheapestMethodKey === 'MIN_GAIN'
                  ? 'font-mono font-semibold tabular-nums text-emerald-400'
                  : 'font-mono tabular-nums text-slate-400'
              }
            >
              Min-Gain {aud.format(comparison.minGain.taxableCapitalGain)}
            </span>
          </div>
          {minGainVsFifo > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              Min-Gain vs FIFO saves{' '}
              <span className="font-medium text-slate-400">
                {audInt.format(minGainVsFifo)}
              </span>{' '}
              taxable capital gain this FY (before income tax).
            </p>
          ) : null}
        </div>
      ) : null}

      {noSalesThisFy ? (
        <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/50 p-10 text-center">
          <p className="text-lg font-medium text-slate-300">
            No sales in {fyLabel(fy)} yet
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Import or record sell trades for this financial year to populate the
            schedule.
          </p>
          {priorFyWithSales != null && anyOtherFySales ? (
            <button
              type="button"
              onClick={() => setFy(priorFyWithSales)}
              className="mt-6 inline-flex rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 hover:bg-sky-500"
            >
              View {fyLabel(priorFyWithSales)}
            </button>
          ) : null}
        </div>
      ) : null}

      {showSchedule ? (
        <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 shadow-xl shadow-black/35 ring-1 ring-slate-700/40">
          <div className="border-b border-slate-700/80 bg-slate-800/55 px-6 py-4">
            <h3 className="text-sm font-semibold text-slate-100">
              Realised disposals
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Sale totals on parent rows · parcel matches below · taxable gain per
              line is before year-level pooling (same engine field as previously).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700/80 bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-6 py-3 font-semibold">Sale date</th>
                  <th className="px-6 py-3 font-semibold">Ticker</th>
                  <th className="px-6 py-3 text-right font-semibold">Qty</th>
                  <th className="px-6 py-3 text-right font-semibold">Proceeds</th>
                  <th className="px-6 py-3 text-right font-semibold">
                    Cost base
                  </th>
                  <th className="px-6 py-3 text-right font-semibold">
                    Days held
                  </th>
                  <th className="px-6 py-3 text-right font-semibold">
                    Gross G/L
                  </th>
                  <th className="px-6 py-3 font-semibold">Discount</th>
                  <th className="px-6 py-3 text-right font-semibold">
                    Taxable gain
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {result.sales.map((s) => {
                  const totals = saleMatchTotals(s)
                  const ac = s.assetClass ?? 'OTHER'
                  return (
                    <Fragment key={s.id}>
                      <tr className="bg-slate-800/60 text-slate-200">
                        <td className="px-6 py-3.5 align-middle font-medium text-slate-100">
                          {s.date.toLocaleDateString('en-AU')}
                        </td>
                        <td className="px-6 py-3.5 align-middle">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-50">
                              {s.ticker}
                            </span>
                            <AssetBadge assetClass={ac} />
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-200">
                          {qtyFmt.format(s.quantitySold)}
                        </td>
                        <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                          {aud.format(s.netProceedsAud)}
                        </td>
                        <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                          {aud.format(totals.cost)}
                        </td>
                        <td className="px-6 py-3.5 text-right align-middle text-slate-500">
                          —
                        </td>
                        <td
                          className={`px-6 py-3.5 text-right align-middle font-mono text-sm font-medium tabular-nums ${pctClass(totals.gross)}`}
                        >
                          {aud.format(totals.gross)}
                        </td>
                        <td className="px-6 py-3.5 align-middle text-slate-500">
                          —
                        </td>
                        <td className="px-6 py-3.5 text-right align-middle font-mono text-base font-bold tabular-nums text-white">
                          {aud.format(totals.taxable)}
                        </td>
                      </tr>
                      {s.matches.map((mm, i) => (
                        <tr
                          key={`${s.id}-${i}`}
                          className="transition-colors duration-150 hover:bg-slate-700/20"
                        >
                          <td className="px-6 py-3 pl-12 align-middle text-xs text-slate-500">
                            Parcel
                          </td>
                          <td className="px-6 py-3 align-middle text-xs text-slate-500">
                            {String(mm.parcelId).slice(0, 12)}…
                          </td>
                          <td className="px-6 py-3 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                            {qtyFmt.format(mm.quantity)}
                          </td>
                          <td className="px-6 py-3 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                            {aud.format(mm.proceedsProRata)}
                          </td>
                          <td className="px-6 py-3 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                            {aud.format(mm.costBaseProRata)}
                          </td>
                          <td className="px-6 py-3 text-right align-middle font-mono text-sm tabular-nums text-slate-400">
                            {mm.daysHeld}
                          </td>
                          <td
                            className={`px-6 py-3 text-right align-middle font-mono text-sm tabular-nums ${pctClass(mm.gain)}`}
                          >
                            {aud.format(mm.gain)}
                          </td>
                          <td className="px-6 py-3 align-middle">
                            {mm.discountEligible ? (
                              <span className="inline-flex rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400 ring-1 ring-emerald-500/25">
                                50%
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right align-middle font-mono text-base font-bold tabular-nums text-white">
                            {aud.format(mm.prePoolTaxableWeight)}
                          </td>
                        </tr>
                      ))}
                      {s.shortfall > 0 ? (
                        <tr className="bg-amber-500/5">
                          <td
                            colSpan={9}
                            className="px-6 py-2.5 text-xs text-amber-500/90"
                          >
                            Warning: insufficient parcels — short by{' '}
                            {s.shortfall} units (check import sequence).
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 shadow-xl shadow-black/35 ring-1 ring-slate-700/40">
        <div className="border-b border-slate-700/80 bg-slate-800/55 px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Unrealised gain preview
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                If you sold entire positions today at last price (
                {pricesLoading ? 'loading…' : 'live where available'}), estimated
                taxable CGT using <span className="font-mono">{mNorm}</span> (no
                prior-year losses).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUnrealisedSort('taxDesc')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  unrealisedSort === 'taxDesc'
                    ? 'bg-slate-700 text-white ring-1 ring-slate-600'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                Tax bill (high→low)
              </button>
              <button
                type="button"
                onClick={() => setUnrealisedSort('taxAsc')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  unrealisedSort === 'taxAsc'
                    ? 'bg-slate-700 text-white ring-1 ring-slate-600'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                Tax bill (low→high)
              </button>
              <button
                type="button"
                onClick={() => setUnrealisedSort('ticker')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  unrealisedSort === 'ticker'
                    ? 'bg-slate-700 text-white ring-1 ring-slate-600'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                Ticker A–Z
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700/80 bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3 font-semibold">Ticker · market</th>
                <th className="px-6 py-3 text-right font-semibold">Qty</th>
                <th className="px-6 py-3 text-right font-semibold">Value</th>
                <th className="px-6 py-3 text-right font-semibold">Unrealised</th>
                <th className="px-6 py-3 text-right font-semibold">
                  Est. taxable CGT
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {parcelsLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    Loading parcels…
                  </td>
                </tr>
              ) : unrealisedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    No open parcels — nothing to preview.
                  </td>
                </tr>
              ) : (
                unrealisedRows.map((r) => (
                  <tr
                    key={r.key}
                    className="transition-colors duration-150 hover:bg-slate-700/20"
                  >
                    <td className="px-6 py-3.5 align-middle">
                      <span className="font-semibold text-slate-50">
                        {r.ticker}
                      </span>
                      {r.market ? (
                        <span className="ml-2 text-xs text-slate-500">
                          {r.market}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-200">
                      {qtyFmt.format(r.quantity)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                      {r.currentValueAud != null
                        ? aud.format(r.currentValueAud)
                        : '—'}
                    </td>
                    <td
                      className={`px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums ${pctClass(r.unrealisedAud ?? 0)}`}
                    >
                      {r.unrealisedAud != null ? aud.format(r.unrealisedAud) : '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm font-medium tabular-nums text-amber-400/95">
                      {r.missingPrice
                        ? '—'
                        : r.taxableIfSold != null
                          ? aud.format(r.taxableIfSold)
                          : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
