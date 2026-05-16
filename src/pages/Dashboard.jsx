import { useMemo, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext.jsx'
import { SAMPLE_FX_AUD_PER_UNIT } from '../data/samplePortfolio'
import { db } from '../lib/firebase'
import { fetchQuotes } from '../lib/prices.js'
import { aggregateParcelsToHoldings, summarisePortfolio } from '../lib/valuation'

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 2,
})

const qtyFmt = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 8,
})

function pctClass(v) {
  if (v == null || Number.isNaN(v)) return 'text-slate-400'
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-rose-400'
  return 'text-slate-400'
}

function formatPct(v) {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function buildFxAudPerUnit(fx) {
  const u = fx?.AUDUSD
  const e = fx?.AUDEUR
  return {
    AUD: 1,
    USD: u != null && u > 0 ? 1 / u : SAMPLE_FX_AUD_PER_UNIT.USD,
    EUR:
      e != null && e > 0
        ? 1 / e
        : (SAMPLE_FX_AUD_PER_UNIT.EUR ?? SAMPLE_FX_AUD_PER_UNIT.USD),
  }
}

/**
 * Spot in quote ccy → AUD using Yahoo FX convention (AUDUSD = USD per 1 AUD).
 */
function convertQuoteToAud(raw, currencyUpper, market, fx) {
  if (raw == null || !Number.isFinite(raw)) return null
  const c = String(currencyUpper || 'USD').toUpperCase()
  if (c === 'AUD') return raw
  const audUsd = fx?.AUDUSD
  const audEur = fx?.AUDEUR
  if (market === 'BIT' && c === 'EUR' && audEur != null && audEur > 0) {
    return raw / audEur
  }
  if (audUsd != null && audUsd > 0) {
    return raw / audUsd
  }
  return null
}

function buildLiveHoldingRow(holding, quote, fx) {
  const qty = holding.quantity
  const costBaseAud = holding.costAud ?? 0
  const avgCostAud = qty > 0 ? costBaseAud / qty : 0
  const market = holding.market ?? ''

  const q = quote || {}
  const price = q.lastPrice
  const prev = q.regularMarketPreviousClose
  const ccy = (q.currency || 'USD').toString()

  const priceAud = convertQuoteToAud(price, ccy, market, fx)
  const prevAud =
    prev != null ? convertQuoteToAud(prev, ccy, market, fx) : null

  const marketValueAud =
    priceAud != null && Number.isFinite(priceAud) ? priceAud * qty : 0
  const prevMarketValueAud =
    prevAud != null && Number.isFinite(prevAud) ? prevAud * qty : null

  const todayChangeAud =
    prevMarketValueAud != null &&
    Number.isFinite(prevMarketValueAud) &&
    Number.isFinite(marketValueAud)
      ? marketValueAud - prevMarketValueAud
      : 0

  let dayChangePct = null
  if (
    prev != null &&
    prev !== 0 &&
    price != null &&
    Number.isFinite(price)
  ) {
    dayChangePct = ((price - prev) / prev) * 100
  } else if (
    q.regularMarketChangePercent != null &&
    Number.isFinite(q.regularMarketChangePercent)
  ) {
    dayChangePct = q.regularMarketChangePercent
  }

  const unrealisedAud =
    priceAud != null && Number.isFinite(priceAud)
      ? marketValueAud - costBaseAud
      : 0
  const unrealisedPct =
    costBaseAud > 0 && priceAud != null && Number.isFinite(priceAud)
      ? (unrealisedAud / costBaseAud) * 100
      : 0

  return {
    ticker: holding.ticker,
    shortName: holding.shortName ?? holding.ticker,
    assetClass: holding.assetClass,
    quoteCurrency: holding.quoteCurrency,
    qty,
    avgCostAud,
    currentPriceAud: priceAud ?? 0,
    marketValueAud,
    dayChangePct,
    todayChangeAud,
    unrealisedAud,
    unrealisedPct,
    costBaseAud,
    missingPrice: priceAud == null || !Number.isFinite(priceAud),
  }
}

function formatFetchedAgo(iso) {
  if (!iso) return ''
  const sec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  )
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min === 1) return '1 min ago'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr === 1) return '1 hour ago'
  if (hr < 48) return `${hr} hours ago`
  return `${Math.floor(hr / 24)} days ago`
}

/** Tailwind-safe badge map — full class strings only (no dynamic palette builds). */
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
  const cls = ASSET_BADGES[assetClass] ?? 'bg-slate-500/15 text-slate-300 ring-slate-500/25'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${cls}`}
    >
      {assetClass}
    </span>
  )
}

function DayChangeCell({ pct }) {
  if (pct == null || Number.isNaN(pct)) {
    return (
      <span className="inline-flex justify-end rounded-md px-2 py-1 font-mono text-xs tabular-nums text-slate-500 ring-1 ring-slate-600/40">
        —
      </span>
    )
  }
  const positive = pct > 0
  const neutral = pct === 0
  const pill =
    neutral
      ? 'bg-slate-700/40 text-slate-400 ring-slate-600/40'
      : positive
        ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25'
        : 'bg-rose-500/15 text-rose-400 ring-rose-500/25'
  return (
    <span
      className={`inline-flex justify-end rounded-md px-2 py-1 font-mono text-xs tabular-nums ring-1 ${pill}`}
    >
      {formatPct(pct)}
    </span>
  )
}

function InlineSkeleton() {
  return (
    <span className="inline-block h-4 w-20 animate-pulse rounded bg-slate-700/80 align-middle" />
  )
}

export function Dashboard() {
  const { user } = useAuth()
  const [parcelDocs, setParcelDocs] = useState([])
  const [parcelsLoading, setParcelsLoading] = useState(true)
  const [priceBundle, setPriceBundle] = useState(null)
  const [pricesLoading, setPricesLoading] = useState(false)

  useEffect(() => {
    if (!db || !user) {
      queueMicrotask(() => {
        setParcelDocs([])
        setParcelsLoading(false)
      })
      return undefined
    }

    queueMicrotask(() => {
      setParcelDocs([])
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
            remainingQuantity: Number(x.remainingQuantity),
            unitCostAud: Number(x.unitCostAud),
            assetClass: x.assetClass,
            quoteCurrency: x.quoteCurrency,
            name: x.name,
            market: x.market,
          })
        })
        setParcelDocs(rows)
        setParcelsLoading(false)
      },
      () => setParcelsLoading(false),
    )
    return () => unsub()
  }, [user])

  const hasParcels = parcelDocs.length > 0

  const uniqueTickers = useMemo(
    () =>
      [...new Set(parcelDocs.map((p) => p.ticker).filter(Boolean))].sort(),
    [parcelDocs],
  )

  useEffect(() => {
    if (!hasParcels || uniqueTickers.length === 0) {
      queueMicrotask(() => {
        setPriceBundle(null)
        setPricesLoading(false)
      })
      return undefined
    }
    console.log('[Dashboard] fetchQuotes tickers', uniqueTickers)
    let cancelled = false
    queueMicrotask(() => setPricesLoading(true))
    fetchQuotes(uniqueTickers)
      .then((b) => {
        console.log('[Dashboard] fetchQuotes result', b)
        if (!cancelled) {
          setPriceBundle(b)
          setPricesLoading(false)
        }
      })
      .catch((err) => {
        console.error('[Dashboard] fetchQuotes error', err)
        if (!cancelled) {
          setPricesLoading(false)
        }
      })
  }, [hasParcels, uniqueTickers])

  const fxAudPerUnit = useMemo(
    () =>
      priceBundle?.fx && priceBundle.fx.AUDUSD
        ? buildFxAudPerUnit(priceBundle.fx)
        : SAMPLE_FX_AUD_PER_UNIT,
    [priceBundle],
  )

  const holdings = useMemo(() => {
    if (!hasParcels) return []
    return aggregateParcelsToHoldings(parcelDocs, fxAudPerUnit)
  }, [hasParcels, parcelDocs, fxAudPerUnit])

  const { rows, summary } = useMemo(() => {
    if (!hasParcels || holdings.length === 0) {
      return {
        rows: [],
        summary: {
          totalValueAud: 0,
          totalCostAud: 0,
          totalTodayChangeAud: 0,
          totalUnrealisedAud: 0,
          totalReturnPct: 0,
          totalDayChangePct: 0,
        },
      }
    }
    const fx = priceBundle?.fx || {}
    const pmap = priceBundle?.prices || {}
    const built = holdings.map((h) =>
      buildLiveHoldingRow(h, pmap[h.ticker], fx),
    )
    return { rows: built, summary: summarisePortfolio(built) }
  }, [hasParcels, holdings, priceBundle])

  const showPriceSkeleton = hasParcels && pricesLoading && !priceBundle
  const failedList = priceBundle?.failedTickers?.length
    ? priceBundle.failedTickers.join(', ')
    : ''

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-col gap-1 border-b border-slate-800 pb-6">
          <h2 className="text-xl font-semibold tracking-tight text-white">
            Portfolio overview
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
            {parcelsLoading
              ? 'Loading your parcels…'
              : hasParcels
                ? (
                    <>
                      Live quotes via{' '}
                      <span className="font-mono text-slate-400">/api/prices</span>
                      {priceBundle?.fx?.AUDUSD ? (
                        <>
                          {' '}
                          · USD→AUD spot{' '}
                          <span className="font-mono text-slate-400">
                            {(1 / priceBundle.fx.AUDUSD).toFixed(4)}
                          </span>
                        </>
                      ) : null}
                    </>
                  )
                : (
                    <>
                      No imported parcels yet — use Import to load your
                      Sharesight export when you’re ready.
                    </>
                  )}
          </p>
          {hasParcels && priceBundle?.fetchedAt ? (
            <p className="text-xs text-slate-600">
              Prices updated {formatFetchedAgo(priceBundle.fetchedAt)}
            </p>
          ) : null}
          {failedList ? (
            <p className="text-xs text-amber-500/90">
              Could not fetch: {failedList}
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Total value"
            primary={
              showPriceSkeleton ? '…' : aud.format(summary.totalValueAud)
            }
            primaryClass="text-white"
            hint="Marked to market · AUD"
            loading={showPriceSkeleton}
          />
          <SummaryCard
            label="Today's change"
            primary={
              showPriceSkeleton
                ? '…'
                : aud.format(summary.totalTodayChangeAud)
            }
            primaryClass={pctClass(summary.totalTodayChangeAud)}
            deltaLabel={
              showPriceSkeleton ? null : formatPct(summary.totalDayChangePct)
            }
            deltaClass={pctClass(summary.totalTodayChangeAud)}
            hint="Vs prior close · portfolio-wide"
            loading={showPriceSkeleton}
          />
          <SummaryCard
            label="Total return"
            primary={
              showPriceSkeleton
                ? '…'
                : formatPct(summary.totalReturnPct)
            }
            primaryClass={pctClass(summary.totalUnrealisedAud)}
            deltaLabel={
              showPriceSkeleton
                ? null
                : aud.format(summary.totalUnrealisedAud)
            }
            deltaClass={pctClass(summary.totalUnrealisedAud)}
            hint={`Unrealised P&L vs cost base`}
            loading={showPriceSkeleton}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 shadow-xl shadow-black/35 ring-1 ring-slate-700/40">
        <div className="border-b border-slate-700/80 bg-slate-800/55 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-100">Holdings</h3>
          <p className="mt-1 text-xs text-slate-500">
            Values and averages shown in AUD unless noted · Hover rows for emphasis
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700/80 bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3 font-semibold">Ticker</th>
                <th className="px-6 py-3 font-semibold">Class</th>
                <th className="px-6 py-3 text-right font-semibold">Qty</th>
                <th className="px-6 py-3 text-right font-semibold">Avg cost</th>
                <th className="px-6 py-3 text-right font-semibold">Price</th>
                <th className="px-6 py-3 text-right font-semibold">Market value</th>
                <th className="px-6 py-3 text-right font-semibold">Day Δ</th>
                <th className="px-6 py-3 text-right font-semibold">Unrealised</th>
                <th className="px-6 py-3 text-right font-semibold">Unrealised %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {parcelsLoading ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    Loading holdings…
                  </td>
                </tr>
              ) : !hasParcels ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-14 text-center align-middle"
                  >
                    <p className="text-slate-400">
                      You don&apos;t have any open parcels yet.
                    </p>
                    <Link
                      to="/import"
                      className="mt-4 inline-flex rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500"
                    >
                      Import from Sharesight
                    </Link>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.ticker}
                    className="transition-colors duration-150 hover:bg-slate-700/20"
                  >
                    <td className="px-6 py-3.5 align-middle">
                      <div className="font-semibold text-slate-50">{r.ticker}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {r.shortName}
                      </div>
                    </td>
                    <td className="px-6 py-3.5 align-middle">
                      <AssetBadge assetClass={r.assetClass} />
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-200">
                      {qtyFmt.format(r.qty)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                      {aud.format(r.avgCostAud)}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums text-slate-300">
                      {showPriceSkeleton || r.missingPrice ? (
                        r.missingPrice && !showPriceSkeleton ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <InlineSkeleton />
                        )
                      ) : (
                        aud.format(r.currentPriceAud)
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle font-mono text-sm font-medium tabular-nums text-white">
                      {showPriceSkeleton || r.missingPrice ? (
                        r.missingPrice && !showPriceSkeleton ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <InlineSkeleton />
                        )
                      ) : (
                        aud.format(r.marketValueAud)
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right align-middle">
                      <div className="flex justify-end">
                        {showPriceSkeleton || r.missingPrice ? (
                          r.missingPrice && !showPriceSkeleton ? (
                            <DayChangeCell pct={null} />
                          ) : (
                            <span className="inline-block h-6 w-14 animate-pulse rounded bg-slate-700/80" />
                          )
                        ) : (
                          <DayChangeCell pct={r.dayChangePct} />
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums ${pctClass(r.unrealisedAud)}`}
                    >
                      {showPriceSkeleton || r.missingPrice ? (
                        r.missingPrice && !showPriceSkeleton ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <InlineSkeleton />
                        )
                      ) : (
                        aud.format(r.unrealisedAud)
                      )}
                    </td>
                    <td
                      className={`px-6 py-3.5 text-right align-middle font-mono text-sm tabular-nums ${pctClass(r.unrealisedPct)}`}
                    >
                      {showPriceSkeleton || r.missingPrice ? (
                        r.missingPrice && !showPriceSkeleton ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <InlineSkeleton />
                        )
                      ) : (
                        formatPct(r.unrealisedPct)
                      )}
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

function SummaryCard({
  label,
  primary,
  primaryClass,
  deltaLabel,
  deltaClass,
  hint,
  loading,
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-700/80 bg-slate-800/70 p-5 shadow-lg shadow-black/40 ring-1 ring-slate-600/30 ${loading ? 'animate-pulse' : ''}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-3 text-3xl font-semibold tracking-tight tabular-nums ${primaryClass ?? 'text-white'}`}
      >
        {primary}
      </p>
      {deltaLabel ? (
        <p
          className={`mt-2 text-sm font-medium tabular-nums ${deltaClass ?? 'text-slate-400'}`}
        >
          {deltaLabel}
        </p>
      ) : null}
      {hint ? (
        <p className="mt-3 text-xs leading-snug text-slate-600">{hint}</p>
      ) : null}
    </div>
  )
}
