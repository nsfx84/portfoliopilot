import { collection, getDocs } from 'firebase/firestore'
import { SAMPLE_FX_AUD_PER_UNIT } from '../data/samplePortfolio.js'
import { db } from '../lib/firebase.js'
import { buildFxAudPerUnit } from '../lib/fx.js'
import { fetchQuotes } from '../lib/prices.js'
import { isKlseStock } from '../lib/tickerMarket.js'
import { aggregateParcelsToHoldings, convertQuoteToAud } from '../lib/valuation.js'

function buildHoldingRow(holding, quote, fx) {
  const qty = holding.quantity
  const market = holding.market ?? ''
  const q = quote || {}
  const price = q.lastPrice
  const ccy = String(q.currency || holding.quoteCurrency || 'USD').toUpperCase()
  const priceAud = convertQuoteToAud(price, ccy, market, fx)
  const marketValueAud =
    priceAud != null && Number.isFinite(priceAud) ? priceAud * qty : 0

  return {
    ticker: holding.ticker,
    assetClass: holding.assetClass,
    quoteCurrency: ccy,
    marketValueAud,
  }
}

function bucketHoldingValue(row) {
  const ac = String(row.assetClass || 'OTHER').toUpperCase()
  if (isKlseStock(row.ticker, row.quoteCurrency)) return 'stocks'
  if (ac === 'ETF') return 'etfs'
  if (ac === 'CRYPTO') return 'crypto'
  if (STOCK_CLASSES.has(ac)) return 'stocks'
  return 'stocks'
}

/**
 * Fetch a single live quote (dev console: `await window.portfolioService.fetchQuote('5171.KL')`).
 *
 * @param {string} ticker
 */
export async function fetchQuote(ticker) {
  const t = String(ticker || '').trim()
  if (!t) throw new Error('ticker required')
  const bundle = await fetchQuotes([t])
  const row = bundle.prices[t] || {}
  return {
    ticker: t,
    lastPrice: row.lastPrice ?? null,
    currency: row.currency ?? null,
    regularMarketPreviousClose: row.regularMarketPreviousClose ?? null,
    regularMarketChangePercent: row.regularMarketChangePercent ?? null,
    error: row.error,
    fx: bundle.fx,
    fetchedAt: bundle.fetchedAt,
  }
}

const STOCK_CLASSES = new Set(['ASX', 'US', 'NASDAQ', 'NYSE'])

/**
 * Live portfolio totals by category for net-worth aggregation.
 *
 * @param {string} uid
 * @returns {Promise<{
 *   stocks: number,
 *   etfs: number,
 *   crypto: number,
 *   super: number,
 *   holdings: Array<{ ticker: string, assetClass: string, quoteCurrency: string, marketValueAud: number }>,
 * }>}
 */
export async function getTotalValueByCategory(uid) {
  if (!db) throw new Error('Firestore is not configured.')

  const snap = await getDocs(collection(db, 'users', uid, 'parcels'))
  const parcels = snap.docs
    .map((d) => {
      const x = d.data()
      return {
        ticker: x.ticker,
        remainingQuantity: Number(x.remainingQuantity),
        unitCostAud: Number(x.unitCostAud),
        assetClass: x.assetClass,
        quoteCurrency: x.quoteCurrency,
        name: x.name,
        market: x.market,
      }
    })
    .filter((p) => p.ticker && p.remainingQuantity > 0)

  if (parcels.length === 0) {
    return { stocks: 0, etfs: 0, crypto: 0, super: 0, holdings: [] }
  }

  const tickers = [...new Set(parcels.map((p) => p.ticker))].sort()
  const priceBundle = await fetchQuotes(tickers)
  const fxAudPerUnit =
    priceBundle.fx && Object.keys(priceBundle.fx).length > 0
      ? buildFxAudPerUnit(priceBundle.fx, SAMPLE_FX_AUD_PER_UNIT)
      : SAMPLE_FX_AUD_PER_UNIT
  const holdings = aggregateParcelsToHoldings(parcels, fxAudPerUnit)
  const fx = priceBundle.fx || {}
  const prices = priceBundle.prices || {}

  const rows = holdings.map((h) => buildHoldingRow(h, prices[h.ticker], fx))

  let stocks = 0
  let etfs = 0
  let crypto = 0

  for (const row of rows) {
    const bucket = bucketHoldingValue(row)
    if (bucket === 'etfs') etfs += row.marketValueAud
    else if (bucket === 'crypto') crypto += row.marketValueAud
    else stocks += row.marketValueAud
  }

  return {
    stocks,
    etfs,
    crypto,
    super: 0,
    holdings: rows.map((r) => ({
      ticker: r.ticker,
      assetClass: r.assetClass,
      quoteCurrency: r.quoteCurrency,
      marketValueAud: r.marketValueAud,
    })),
  }
}
