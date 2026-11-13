/**
 * Manual trade entry: pure math/validation helpers plus Firestore writes for
 * hand-entered buys and sells. Documents share the shape written by the
 * Sharesight importer (see userData.js) so the CGT engine and the parcel
 * rebuild treat imported and manual rows identically.
 */

import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { fetchQuotes } from './prices.js'
import { buildYahooTicker, classifyAssetClass } from './sharesightImporter.js'

export const TRADE_MARKETS = Object.freeze([
  'ASX',
  'NASDAQ',
  'NYSE',
  'BATS',
  'BIT',
  'CRYPTO',
  'OTHER',
])

export const TRADE_CURRENCIES = Object.freeze(['AUD', 'USD', 'EUR', 'GBP'])

const MELBOURNE = 'Australia/Melbourne'

/** `YYYY-MM-DD` for today in Australia/Melbourne, whatever the browser locale is. */
export function todayInMelbourne(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MELBOURNE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Default instrument currency for a market (ASX trades in AUD, everything else USD). */
export function defaultCurrencyForMarket(market) {
  return String(market ?? '').toUpperCase() === 'ASX' ? 'AUD' : 'USD'
}

/**
 * `YYYY-MM-DD` to a Date at local noon. Noon keeps the calendar day stable
 * under DST shifts, and the CGT financial-year bounds are local-time too.
 *
 * @param {string} iso
 * @returns {Date | null}
 */
export function isoDateToLocalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null
  }
  return dt
}

/** Date (or Firestore Timestamp) to `YYYY-MM-DD` in local time. */
export function localDateToIsoDate(value) {
  const d =
    value && typeof value.toDate === 'function'
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value)
  if (!d || Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

/** Australian FY ending 30 June: 2026-03-01 is FY2026, 2026-07-01 is FY2027. */
export function financialYearForDate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.getMonth() >= 6 ? dt.getFullYear() + 1 : dt.getFullYear()
}

/**
 * Current Australian FY as observed in Melbourne, regardless of the browser's
 * time zone. Jul–Dec → year + 1, Jan–Jun → year.
 */
export function currentFinancialYearMelbourne(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year').value)
  const month = Number(parts.find((p) => p.type === 'month').value)
  return month >= 7 ? year + 1 : year
}

function toNumber(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * AUD total for a trade.
 *
 * Buy:  qty * price * fx + brokerage
 * Sell: qty * price * fx - brokerage
 *
 * `fxRate` is AUD per unit of the instrument currency and is forced to 1 for
 * AUD. Brokerage is always AUD, so it sits outside the FX conversion.
 *
 * @param {{ type?: string, quantity?: unknown, price?: unknown, currency?: string, fxRate?: unknown, brokerage?: unknown }} input
 */
export function computeTradeTotals(input) {
  const type =
    String(input?.type ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy'
  const currency = String(input?.currency ?? 'AUD').toUpperCase()
  const quantity = toNumber(input?.quantity)
  const price = toNumber(input?.price)
  const brokerage = toNumber(input?.brokerage) ?? 0
  const fxRate = currency === 'AUD' ? 1 : toNumber(input?.fxRate)

  const complete =
    quantity != null && price != null && fxRate != null && fxRate > 0

  const grossAud = complete ? quantity * price * fxRate : null
  const totalAud =
    grossAud == null
      ? null
      : type === 'buy'
        ? grossAud + brokerage
        : grossAud - brokerage

  return {
    type,
    currency,
    quantity,
    price,
    brokerage,
    fxRate,
    grossAud,
    totalAud,
    complete,
  }
}

const audFmt = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numFmt = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 8 })

/**
 * Human-readable working, e.g.
 * `50 x $78.99 USD x 1.4611 + $0.00 brokerage = $5,770.76 AUD`
 */
export function formatTradeBreakdown(totals) {
  if (!totals?.complete) return ''
  const parts = [
    numFmt.format(totals.quantity),
    '×',
    `$${numFmt.format(totals.price)} ${totals.currency}`,
  ]
  if (totals.currency !== 'AUD') {
    parts.push('×', numFmt.format(totals.fxRate))
  }
  parts.push(
    totals.type === 'buy' ? '+' : '−',
    `${audFmt.format(Math.abs(totals.brokerage))} brokerage`,
    '=',
    `${audFmt.format(totals.totalAud)} AUD`,
  )
  return parts.join(' ')
}

/**
 * Validate raw form strings.
 *
 * @returns {{ errors: Record<string, string>, values: object | null }}
 */
export function validateTrade(form) {
  /** @type {Record<string, string>} */
  const errors = {}

  const type = form.type === 'sell' ? 'sell' : 'buy'

  const tradeDate = String(form.tradeDate ?? '').trim()
  const date = isoDateToLocalDate(tradeDate)
  if (!tradeDate) errors.tradeDate = 'Date required'
  else if (!date) errors.tradeDate = 'Date must be a valid calendar date'

  const code = String(form.ticker ?? '')
    .trim()
    .toUpperCase()
  if (!code) errors.ticker = 'Ticker required'

  const market = String(form.market ?? '').toUpperCase()
  if (!TRADE_MARKETS.includes(market)) errors.market = 'Market required'

  const currency = String(form.currency ?? '').toUpperCase()
  if (!TRADE_CURRENCIES.includes(currency)) errors.currency = 'Currency required'

  const quantity = toNumber(form.quantity)
  if (quantity == null) errors.quantity = 'Quantity required'
  else if (!(quantity > 0)) errors.quantity = 'Quantity must be > 0'

  const price = toNumber(form.price)
  if (price == null) errors.price = 'Price required'
  else if (!(price > 0)) errors.price = 'Price must be > 0'

  const brokerageRaw = String(form.brokerage ?? '').trim()
  const brokerage = brokerageRaw === '' ? 0 : toNumber(brokerageRaw)
  if (brokerage == null) errors.brokerage = 'Brokerage must be a number'
  else if (brokerage < 0) errors.brokerage = 'Brokerage must be >= 0'

  let fxRate = 1
  if (currency !== 'AUD') {
    fxRate = toNumber(form.fxRate)
    if (fxRate == null) errors.fxRate = 'FX rate required for non-AUD trades'
    else if (!(fxRate > 0)) errors.fxRate = 'FX rate must be > 0'
  }

  if (Object.keys(errors).length > 0) return { errors, values: null }

  const totals = computeTradeTotals({
    type,
    quantity,
    price,
    currency,
    fxRate,
    brokerage,
  })

  if (type === 'sell' && !(totals.totalAud > 0)) {
    errors.brokerage = 'Brokerage exceeds sale proceeds'
    return { errors, values: null }
  }

  return {
    errors,
    values: {
      type,
      tradeDate,
      date,
      code,
      market,
      name: String(form.name ?? '').trim(),
      currency,
      quantity,
      price,
      brokerage,
      fxRate,
      notes: String(form.notes ?? '').trim(),
      totals,
    },
  }
}

export const LAST_MARKET_KEY = 'pp:transactions:lastMarket'

/**
 * Most manual entries are US trades that Sharesight does not cover, so the
 * form falls back here rather than to ASX.
 */
export const FALLBACK_MARKET = 'NASDAQ'

/** Last market the user added a trade for, or null if none is stored. */
export function readLastMarket() {
  try {
    const v = window.localStorage.getItem(LAST_MARKET_KEY)
    return v && TRADE_MARKETS.includes(v) ? v : null
  } catch {
    return null
  }
}

export function writeLastMarket(market) {
  if (!TRADE_MARKETS.includes(market)) return
  try {
    window.localStorage.setItem(LAST_MARKET_KEY, market)
  } catch {
    // Private browsing / storage disabled — the fallback default still applies.
  }
}

/**
 * Market of the user's latest manual trade by trade date. Used to seed the
 * form on a device that has no stored preference yet.
 *
 * @param {Array<{ sourceBroker?: string, market?: string, date?: Date }>} rows
 * @returns {string | null}
 */
export function mostRecentManualMarket(rows) {
  let best = null
  for (const r of rows ?? []) {
    if (r.sourceBroker !== 'manual') continue
    if (!TRADE_MARKETS.includes(r.market)) continue
    if (!best || r.date > best.date) best = r
  }
  return best?.market ?? null
}

/** Blank add-trade form state, with the currency matching the market. */
export function emptyTradeForm(
  tradeDate = todayInMelbourne(),
  market = FALLBACK_MARKET,
) {
  const m = TRADE_MARKETS.includes(market) ? market : FALLBACK_MARKET
  return {
    type: 'buy',
    tradeDate,
    ticker: '',
    market: m,
    name: '',
    quantity: '',
    price: '',
    currency: defaultCurrencyForMarket(m),
    brokerage: '0',
    fxRate: '',
    notes: '',
  }
}

/** Transactions table row (from a Firestore doc) to form state, for editing. */
export function tradeDocToForm(row) {
  return {
    type: row.type === 'sell' ? 'sell' : 'buy',
    tradeDate: row.tradeDate ?? '',
    ticker: row.code ?? row.ticker ?? '',
    market: TRADE_MARKETS.includes(row.market) ? row.market : 'OTHER',
    name: row.name ?? '',
    quantity: row.quantity != null ? String(row.quantity) : '',
    price: row.pricePerUnit != null ? String(row.pricePerUnit) : '',
    currency: TRADE_CURRENCIES.includes(row.priceCurrency)
      ? row.priceCurrency
      : TRADE_CURRENCIES.includes(row.quoteCurrency)
        ? row.quoteCurrency
        : 'AUD',
    brokerage: row.brokerage != null ? String(row.brokerage) : '0',
    fxRate: row.fxRate != null ? String(row.fxRate) : '',
    notes: row.notes ?? '',
  }
}

/**
 * Live AUD per 1 unit of `currency`, via the Yahoo `AUD<CCY>=X` pair on
 * /api/prices (which quotes <CCY> per 1 AUD, so we invert).
 *
 * @param {string} currency
 * @returns {Promise<{ rate: number, fetchedAt: string } | null>}
 */
export async function fetchLiveAudPerUnit(currency) {
  const ccy = String(currency ?? '').toUpperCase()
  if (!ccy || ccy === 'AUD') {
    return { rate: 1, fetchedAt: new Date().toISOString() }
  }
  const symbol = `AUD${ccy}=X`
  const bundle = await fetchQuotes([symbol])
  const perAud = bundle.prices?.[symbol]?.lastPrice
  if (perAud == null || !Number.isFinite(perAud) || perAud <= 0) return null
  return { rate: 1 / perAud, fetchedAt: bundle.fetchedAt }
}

/**
 * Validated form values to a Firestore document body (minus server timestamps).
 * Mirrors the Sharesight importer's field set so downstream readers need no
 * special cases for manual rows.
 */
export function buildManualTradeDoc(values) {
  const ticker = buildYahooTicker(values.code, values.market)
  const assetClass = classifyAssetClass(values.market)
  const isBuy = values.type === 'buy'

  return {
    kind: isBuy ? 'BUY' : 'SELL',
    sharesightType: values.type,
    ticker,
    market: values.market,
    code: values.code,
    name: values.name || null,
    assetClass,
    quoteCurrency: values.currency,
    quantity: values.quantity,
    quantityDelta: null,
    totalCostAud: isBuy ? values.totals.totalAud : null,
    netProceedsAud: isBuy ? null : values.totals.totalAud,
    amountAud: null,
    subtype: null,
    rowIndex: null,
    rawType: isBuy ? 'Buy' : 'Sell',
    executedAt: Timestamp.fromDate(values.date),
    /** Canonical trade date, always YYYY-MM-DD regardless of browser locale. */
    tradeDate: values.tradeDate,
    pricePerUnit: values.price,
    priceCurrency: values.currency,
    brokerage: values.brokerage,
    brokerageCurrency: 'AUD',
    fxRate: values.fxRate,
    notes: values.notes || null,
    source: 'manual',
    sourceBroker: 'manual',
    deleted: false,
  }
}

/**
 * Console-only warning when a trade lands in a financial year that has already
 * closed: any CGT schedule already exported for that year is now stale. We do
 * not track exports, so this never blocks the save.
 */
export function warnIfClosedFinancialYear(values, now = new Date()) {
  const tradeFy = financialYearForDate(values.date)
  const currentFy = financialYearForDate(now)
  if (tradeFy < currentFy) {
    console.warn(
      `[manualTrades] Trade dated ${values.tradeDate} lands in FY${tradeFy}, which has already closed. ` +
        'Any CGT schedule already exported for that year will need reconciling.',
    )
    return true
  }
  return false
}

function txCollection(uid) {
  if (!db) throw new Error('Firestore is not configured.')
  if (!uid) throw new Error('Not signed in.')
  return collection(db, 'users', uid, 'transactions')
}

/** @returns {Promise<string>} the new document id */
export async function createManualTrade(uid, values) {
  const ref = doc(txCollection(uid))
  await setDoc(ref, {
    ...buildManualTradeDoc(values),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateManualTrade(uid, id, values) {
  const ref = doc(txCollection(uid), id)
  await updateDoc(ref, {
    ...buildManualTradeDoc(values),
    updatedAt: serverTimestamp(),
  })
}

/** Soft delete so an undo can be layered on later. */
export async function softDeleteManualTrade(uid, id) {
  const ref = doc(txCollection(uid), id)
  await updateDoc(ref, {
    deleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}
