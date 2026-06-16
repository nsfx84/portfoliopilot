export const FX_SOURCE_RBA = 'RBA'
export const FX_SOURCE_YAHOO = 'YAHOO'

/** @type {Map<string, number>} key `${from}:${to}` → toCurrency per 1 fromCurrency */
const spotCache = new Map()

/** Clear session spot cache (tests). */
export function clearSpotCache() {
  spotCache.clear()
}

/**
 * Yahoo FX bundle keys use AUDXXX = XXX per 1 AUD (e.g. AUDUSD, AUDEUR, AUDMYR).
 *
 * @param {Record<string, number>} yahooFx
 * @param {string} quoteCurrency ISO code of the quote currency (e.g. USD, MYR)
 * @returns {number | null} AUD per 1 unit of quoteCurrency
 */
export function audPerQuoteFromYahooBundle(yahooFx, quoteCurrency) {
  const ccy = String(quoteCurrency || '').toUpperCase()
  if (!ccy || ccy === 'AUD') return 1
  const audPerCcy = yahooFx?.[`AUD${ccy}`]
  if (audPerCcy != null && Number.isFinite(audPerCcy) && audPerCcy > 0) {
    return 1 / audPerCcy
  }
  return null
}

/**
 * Spot rate: how many `toCurrency` per 1 `fromCurrency`.
 * Uses Yahoo bundle when provided; falls back to RBA stub for known currencies.
 *
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @param {Record<string, number>} [yahooFx]
 * @returns {number | null}
 */
export function getSpot(fromCurrency, toCurrency, yahooFx = {}) {
  const from = String(fromCurrency || '').toUpperCase()
  const to = String(toCurrency || '').toUpperCase()
  if (!from || !to) return null
  if (from === to) return 1

  const cacheKey = `${from}:${to}`
  if (spotCache.has(cacheKey)) return spotCache.get(cacheKey)

  let rate = null
  if (to === 'AUD') {
    rate = audPerQuoteFromYahooBundle(yahooFx, from)
  } else if (from === 'AUD') {
    const audPerTo = yahooFx?.[`AUD${to}`]
    if (audPerTo != null && Number.isFinite(audPerTo) && audPerTo > 0) {
      rate = audPerTo
    }
  }

  if (rate == null) {
    rate = rbaStubSpot(from, to)
  }

  if (rate != null && Number.isFinite(rate) && rate > 0) {
    spotCache.set(cacheKey, rate)
    return rate
  }
  return null
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {number | null}
 */
function rbaStubSpot(from, to) {
  const stub = {
    AUD: 1,
    USD: 1.5342,
    EUR: 1.6621,
    GBP: 1.989,
    MYR: 0.33,
  }
  const fromRate = stub[from]
  const toRate = stub[to]
  if (fromRate == null || toRate == null) return null
  return toRate / fromRate
}

/**
 * Build AUD-per-unit map for dashboard valuation (AUD per 1 unit of quote currency).
 *
 * @param {Record<string, number>} yahooFx
 * @param {Record<string, number>} [fallback]
 */
export function buildFxAudPerUnit(yahooFx = {}, fallback = {}) {
  const pick = (ccy) =>
    getSpot(ccy, 'AUD', yahooFx) ?? fallback[ccy] ?? null

  return {
    AUD: 1,
    USD: pick('USD') ?? 1.5342,
    EUR: pick('EUR') ?? 1.64,
    MYR: pick('MYR') ?? 0.33,
  }
}

/**
 * Stub: Reserve Bank of Australia daily USD→AUD (or cross) fix.
 * Production: parse RBA Statistical Table F11 / FEXR series or CSV feed.
 *
 * @param {string} asOfDate ISO 'YYYY-MM-DD'
 * @returns {Promise<Record<string, number>>} map of quoteCurrency → audPerQuoteUnit (AUD for 1 unit of quote)
 */
export async function fetchRbaDailyRates(asOfDate) {
  void asOfDate
  return {
    AUD: 1,
    USD: 1.5342,
    EUR: 1.6621,
    GBP: 1.989,
    MYR: 0.33,
  }
}

/**
 * Cached rates map for UI wiring; keys are ISO quote currencies.
 * @param {string} asOfDate
 */
export async function getCachedAudFxMap(asOfDate) {
  return fetchRbaDailyRates(asOfDate)
}
