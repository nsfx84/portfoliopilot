import { getSpot } from './fx.js'

/**
 * Convert holdings + cached quotes + AUD FX map into dashboard row metrics.
 */

/**
 * Convert a live quote price in native currency to AUD.
 *
 * @param {number | { price?: number, lastPrice?: number, currency?: string, market?: string }} rawOrQuote
 * @param {string | Record<string, number>} [currencyOrFx]
 * @param {string} [market]
 * @param {Record<string, number>} [fx]
 * @returns {number | null}
 */
export function convertQuoteToAud(rawOrQuote, currencyOrFx, market, fx) {
  let raw
  let ccy
  let mkt
  let fxBundle

  if (
    typeof rawOrQuote === 'object' &&
    rawOrQuote != null &&
    ('price' in rawOrQuote || 'lastPrice' in rawOrQuote || 'currency' in rawOrQuote)
  ) {
    raw = rawOrQuote.price ?? rawOrQuote.lastPrice
    ccy = rawOrQuote.currency
    mkt = rawOrQuote.market ?? ''
    fxBundle =
      currencyOrFx && typeof currencyOrFx === 'object' && !Array.isArray(currencyOrFx)
        ? currencyOrFx
        : fx ?? {}
  } else {
    raw = rawOrQuote
    ccy = currencyOrFx
    mkt = market ?? ''
    fxBundle = fx ?? {}
  }

  if (raw == null || !Number.isFinite(raw)) return null

  const c = String(ccy || 'USD').toUpperCase()
  if (c === 'AUD') return raw

  const audPerUnit = getSpot(c, 'AUD', fxBundle)
  if (audPerUnit != null && audPerUnit > 0) {
    return raw * audPerUnit
  }

  if (mkt === 'BIT' && c === 'EUR') {
    const eurAud = getSpot('EUR', 'AUD', fxBundle)
    if (eurAud != null && eurAud > 0) return raw * eurAud
  }

  console.warn(`[convertQuoteToAud] unsupported currency ${c}`)
  return 0
}

/**
 * @param {{
 *   ticker: string,
 *   assetClass: string,
 *   quantity: number,
 *   avgCostNative: number,
 *   quoteCurrency: string,
 *   shortName?: string,
 * }} holding
 * @param {{
 *   lastPrice: number,
 *   quoteCurrency: string,
 *   regularMarketPreviousClose?: number,
 *   regularMarketChangePercent?: number,
 *   shortName?: string,
 * }} [priceRow]
 * @param {Record<string, number>} fxAudPerUnit AUD per 1 unit of quote currency (AUD keys = 1)
 */
export function buildDashboardRow(holding, priceRow, fxAudPerUnit) {
  const quoteCcy = holding.quoteCurrency
  const fx = quoteCcy === 'AUD' ? 1 : (fxAudPerUnit[quoteCcy] ?? 1)

  const lastNative = priceRow?.lastPrice ?? 0
  const prevNative =
    priceRow?.regularMarketPreviousClose ?? lastNative

  const qty = holding.quantity
  const avgNative = holding.avgCostNative

  const marketValueAud = qty * lastNative * fx
  const prevMarketValueAud = qty * prevNative * fx
  const costBaseAud = qty * avgNative * fx

  const unrealisedAud = marketValueAud - costBaseAud
  const unrealisedPct = costBaseAud > 0 ? (unrealisedAud / costBaseAud) * 100 : 0

  const dayChangePct = priceRow?.regularMarketChangePercent ?? 0
  const todayChangeAud = marketValueAud - prevMarketValueAud

  return {
    ticker: holding.ticker,
    shortName: priceRow?.shortName ?? holding.shortName ?? holding.ticker,
    assetClass: holding.assetClass,
    quoteCurrency: quoteCcy,
    qty,
    avgCostAud: avgNative * fx,
    currentPriceAud: lastNative * fx,
    marketValueAud,
    dayChangePct,
    todayChangeAud,
    unrealisedAud,
    unrealisedPct,
    costBaseAud,
    fxUsed: fx,
  }
}

/**
 * @param {ReturnType<typeof buildDashboardRow>[]} rows
 */
export function summarisePortfolio(rows) {
  const totalValueAud = rows.reduce((s, r) => s + r.marketValueAud, 0)
  const totalCostAud = rows.reduce((s, r) => s + r.costBaseAud, 0)
  const totalTodayChangeAud = rows.reduce((s, r) => s + r.todayChangeAud, 0)
  const totalUnrealisedAud = totalValueAud - totalCostAud
  const totalReturnPct =
    totalCostAud > 0 ? (totalUnrealisedAud / totalCostAud) * 100 : 0
  const priorValue = totalValueAud - totalTodayChangeAud
  const totalDayChangePct =
    priorValue > 0 ? (totalTodayChangeAud / priorValue) * 100 : 0

  return {
    totalValueAud,
    totalCostAud,
    totalTodayChangeAud,
    totalUnrealisedAud,
    totalReturnPct,
    totalDayChangePct,
  }
}

/**
 * Group open Firestore parcels into dashboard holding rows (native avg cost for quote ccy).
 *
 * @param {Array<{ ticker: string, remainingQuantity: number, unitCostAud: number, assetClass?: string, quoteCurrency?: string, name?: string, market?: string }>} parcels
 * @param {Record<string, number>} fxAudPerUnit
 */
export function aggregateParcelsToHoldings(parcels, fxAudPerUnit) {
  const byTicker = new Map()
  for (const p of parcels) {
    const t = p.ticker
    if (!t || !(p.remainingQuantity > 0)) continue
    const rem = p.remainingQuantity
    const ucAud = Number(p.unitCostAud)
    if (!Number.isFinite(ucAud)) continue
    if (!byTicker.has(t)) {
      byTicker.set(t, {
        ticker: t,
        quantity: 0,
        costAud: 0,
        assetClass: p.assetClass ?? 'OTHER',
        quoteCurrency: p.quoteCurrency ?? 'AUD',
        name: p.name ?? t,
        market: p.market ?? '',
      })
    }
    const h = byTicker.get(t)
    h.quantity += rem
    h.costAud += rem * ucAud
  }
  const rows = []
  for (const h of byTicker.values()) {
    const q = h.quantity
    if (q <= 0) continue
    const avgAudPerShare = h.costAud / q
    const ccy = h.quoteCurrency === 'AUD' ? 'AUD' : h.quoteCurrency
    const fx = ccy === 'AUD' ? 1 : fxAudPerUnit[ccy] ?? fxAudPerUnit.USD ?? 1
    const avgNative = ccy === 'AUD' ? avgAudPerShare : avgAudPerShare / fx
    rows.push({
      ticker: h.ticker,
      assetClass: h.assetClass,
      quantity: q,
      avgCostNative: avgNative,
      quoteCurrency: ccy,
      shortName: h.name,
      costAud: h.costAud,
      market: h.market ?? '',
    })
  }
  rows.sort((a, b) => a.ticker.localeCompare(b.ticker))
  return rows
}
