/**
 * Browser client for `/api/prices`. Session cache: same ticker set is not
 * refetched within 60 seconds.
 *
 * IMPORTANT: send Accept: application/json — Vite htmlFallback rewrites API paths
 * when the fetch default Accept header triggers the SPA branch.
 *
 * @typedef {Record<string, {
 *   lastPrice: number | null,
 *   currency: string,
 *   regularMarketPreviousClose: number | null,
 *   regularMarketChangePercent: number | null,
 *   shortName?: string,
 *   error?: string,
 * }>} PriceMap
 */

const CACHE_TTL_MS = 60_000

/** @type {{ key: string, at: number, bundle: QuotesBundle } | null} */
let sessionCache = null

/**
 * @typedef {{
 *   prices: PriceMap,
 *   fx: { AUDUSD?: number, AUDEUR?: number },
 *   fetchedAt: string,
 *   failedTickers: string[],
 * }} QuotesBundle
 */

/**
 * @param {string[]} tickers
 * @returns {Promise<QuotesBundle>}
 */
export async function fetchQuotes(tickers) {
  const uniq = [...new Set(tickers.map((t) => String(t).trim()).filter(Boolean))]
  const key = uniq.slice().sort().join(',')
  const now = Date.now()

  if (uniq.length === 0) {
    console.log('[fetchQuotes] skip: no tickers')
    const empty = {
      prices: {},
      fx: {},
      fetchedAt: new Date().toISOString(),
      failedTickers: [],
    }
    return empty
  }

  if (
    sessionCache &&
    sessionCache.key === key &&
    now - sessionCache.at < CACHE_TTL_MS
  ) {
    console.log('[fetchQuotes] cache hit, tickers=', key)
    return sessionCache.bundle
  }

  const url = `/api/prices?${new URLSearchParams({ tickers: uniq.join(',') }).toString()}`
  console.log('[fetchQuotes] GET', url)

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    })

    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error('[fetchQuotes] non-JSON response', text.slice(0, 200))
      throw new Error(`Expected JSON, got ${res.status} ${text.slice(0, 80)}`)
    }

    if (!res.ok) {
      throw new Error(`Prices API HTTP ${res.status}`)
    }

    /** @type {PriceMap} */
    const prices = {}
    for (const t of uniq) {
      const row = data.prices?.[t]
      if (
        !row ||
        row.price == null ||
        !Number.isFinite(Number(row.price)) ||
        row.error
      ) {
        prices[t] = {
          lastPrice: null,
          currency: String(row?.currency || 'USD'),
          regularMarketPreviousClose: null,
          regularMarketChangePercent: null,
          error: row?.error || 'No price',
        }
      } else {
        const price = Number(row.price)
        const prev =
          row.prevClose != null && Number.isFinite(Number(row.prevClose))
            ? Number(row.prevClose)
            : null
        const pct =
          prev != null && prev !== 0
            ? ((price - prev) / prev) * 100
            : null
        prices[t] = {
          lastPrice: price,
          currency: String(row.currency || 'USD'),
          regularMarketPreviousClose: prev,
          regularMarketChangePercent: pct,
        }
      }
    }

    const failedTickers = uniq.filter((t) => prices[t].lastPrice == null)

    const bundle = {
      prices,
      fx: data.fx && typeof data.fx === 'object' ? data.fx : {},
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      failedTickers,
    }

    console.log('[fetchQuotes] ok', { tickers: uniq, fetchedAt: bundle.fetchedAt, failed: failedTickers })

    sessionCache = { key, at: now, bundle }
    return bundle
  } catch (err) {
    console.error('[fetchQuotes]', err)
    const msg = err?.message || 'Request failed'
    /** @type {PriceMap} */
    const prices = Object.fromEntries(
      uniq.map((t) => [
        t,
        {
          lastPrice: null,
          currency: 'USD',
          regularMarketPreviousClose: null,
          regularMarketChangePercent: null,
          error: msg,
        },
      ]),
    )
    const bundle = {
      prices,
      fx: {},
      fetchedAt: new Date().toISOString(),
      failedTickers: uniq,
    }
    sessionCache = { key, at: now, bundle }
    return bundle
  }
}
