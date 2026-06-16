import { collection, getDocs } from 'firebase/firestore'
import { SAMPLE_FX_AUD_PER_UNIT } from '../data/samplePortfolio.js'
import { db } from '../lib/firebase.js'
import { fetchQuotes } from '../lib/prices.js'
import { aggregateParcelsToHoldings } from '../lib/valuation.js'

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

function buildHoldingRow(holding, quote, fx) {
  const qty = holding.quantity
  const market = holding.market ?? ''
  const q = quote || {}
  const price = q.lastPrice
  const ccy = (q.currency || 'USD').toString()
  const priceAud = convertQuoteToAud(price, ccy, market, fx)
  const marketValueAud =
    priceAud != null && Number.isFinite(priceAud) ? priceAud * qty : 0

  return {
    ticker: holding.ticker,
    assetClass: holding.assetClass,
    quoteCurrency: holding.quoteCurrency,
    marketValueAud,
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
 *   holdings: Array<{ assetClass: string, quoteCurrency: string, marketValueAud: number }>,
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
    priceBundle.fx?.AUDUSD
      ? buildFxAudPerUnit(priceBundle.fx)
      : SAMPLE_FX_AUD_PER_UNIT
  const holdings = aggregateParcelsToHoldings(parcels, fxAudPerUnit)
  const fx = priceBundle.fx || {}
  const prices = priceBundle.prices || {}

  const rows = holdings.map((h) => buildHoldingRow(h, prices[h.ticker], fx))

  let stocks = 0
  let etfs = 0
  let crypto = 0

  for (const row of rows) {
    const ac = String(row.assetClass || 'OTHER').toUpperCase()
    if (ac === 'ETF') etfs += row.marketValueAud
    else if (ac === 'CRYPTO') crypto += row.marketValueAud
    else if (STOCK_CLASSES.has(ac)) stocks += row.marketValueAud
    else stocks += row.marketValueAud
  }

  return {
    stocks,
    etfs,
    crypto,
    super: 0,
    holdings: rows.map((r) => ({
      assetClass: r.assetClass,
      quoteCurrency: r.quoteCurrency,
      marketValueAud: r.marketValueAud,
    })),
  }
}
