import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance()

/** Base symbol (e.g. BTC) → CoinGecko id (OTHER / CRYPTO / -USD pairs) */
const CRYPTO_SYMBOL_TO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  XRP: 'ripple',
  ETC: 'ethereum-classic',
  YFI: 'yearn-finance',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  ATOM: 'cosmos',
  NEAR: 'near',
  APT: 'aptos',
  SUI: 'sui',
  TRX: 'tron',
  UNI: 'uniswap',
  AAVE: 'aave',
  MKR: 'maker',
  SNX: 'havven',
  CRV: 'curve-dao-token',
}

const COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price'

export function classifyTicker(ticker) {
  const t = String(ticker ?? '').trim()
  if (!t) return { kind: 'stock' }

  if (/-USD$/i.test(t)) {
    const base = t.slice(0, -4).toUpperCase()
    return { kind: 'crypto', base, vs: 'usd' }
  }
  if (/-AUD$/i.test(t)) {
    const base = t.slice(0, -4).toUpperCase()
    return { kind: 'crypto', base, vs: 'aud' }
  }

  const upper = t.toUpperCase()
  if (/^[A-Z]{2,5}$/.test(upper) && CRYPTO_SYMBOL_TO_ID[upper]) {
    return { kind: 'crypto', base: upper, vs: 'usd' }
  }

  return { kind: 'stock' }
}

export function parseTickerList(tickersParam) {
  if (!tickersParam || typeof tickersParam !== 'string') return []
  return tickersParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isAllowedOrigin(origin, host) {
  if (!origin) return true
  if (!host) return false
  try {
    const originHost = new URL(origin).host
    return originHost === host
  } catch {
    return false
  }
}

function requestHost(req) {
  return (
    req.headers?.['x-forwarded-host'] ||
    req.headers?.host ||
    ''
  )
    .split(',')[0]
    .trim()
}

export function assertSameOrigin(req, res) {
  const origin = req.headers?.origin
  const host = requestHost(req)
  if (!isAllowedOrigin(origin, host)) {
    res.statusCode = 403
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Forbidden: cross-origin request not allowed' }))
    return false
  }
  return true
}

async function yahooQuoteSafe(symbol) {
  try {
    const q = await yahooFinance.quote(symbol)
    const price =
      typeof q.regularMarketPrice === 'number'
        ? q.regularMarketPrice
        : q.postMarketPrice != null
          ? Number(q.postMarketPrice)
          : null
    const prevClose =
      typeof q.regularMarketPreviousClose === 'number'
        ? q.regularMarketPreviousClose
        : null
    const currency =
      (q.currency && String(q.currency)) ||
      (q.financialCurrency && String(q.financialCurrency)) ||
      'USD'
    return {
      price: price != null && Number.isFinite(price) ? price : null,
      prevClose:
        prevClose != null && Number.isFinite(prevClose) ? prevClose : null,
      currency,
      source: 'yahoo',
    }
  } catch (e) {
    const msg = e?.message || e?.toString?.() || 'Not found'
    return { price: null, error: msg, source: 'yahoo' }
  }
}

export async function buildPricesPayload(tickers) {
  const unique = [...new Set(tickers.map((t) => t.trim()).filter(Boolean))]
  const prices = {}

  const stockTickers = []
  const cryptoJobs = []

  for (const ticker of unique) {
    const c = classifyTicker(ticker)
    if (c.kind === 'crypto') {
      const id = CRYPTO_SYMBOL_TO_ID[c.base]
      if (!id) {
        prices[ticker] = {
          price: null,
          error: `Unknown crypto symbol: ${c.base}`,
          source: 'coingecko',
        }
      } else {
        cryptoJobs.push({ ticker, base: c.base, vs: c.vs, id })
      }
    } else {
      stockTickers.push(ticker)
    }
  }

  const yahooBatch = [...stockTickers, 'AUDUSD=X', 'AUDEUR=X', 'AUDMYR=X']
  const yahooUnique = [...new Set(yahooBatch)]

  const yahooResults = await Promise.all(
    yahooUnique.map(async (sym) => {
      const row = await yahooQuoteSafe(sym)
      return [sym, row]
    }),
  )

  const yahooMap = Object.fromEntries(yahooResults)

  for (const t of stockTickers) {
    prices[t] = yahooMap[t] || { price: null, error: 'No data', source: 'yahoo' }
  }

  let fxAUDUSD = yahooMap['AUDUSD=X']?.price
  let fxAUDEUR = yahooMap['AUDEUR=X']?.price
  let fxAUDMYR = yahooMap['AUDMYR=X']?.price

  if (fxAUDUSD == null || !Number.isFinite(fxAUDUSD)) {
    const row = await yahooQuoteSafe('AUDUSD=X')
    fxAUDUSD = row.price
  }
  if (fxAUDEUR == null || !Number.isFinite(fxAUDEUR)) {
    const row = await yahooQuoteSafe('AUDEUR=X')
    fxAUDEUR = row.price
  }
  if (fxAUDEUR == null || !Number.isFinite(fxAUDEUR)) {
    const eurAud = await yahooQuoteSafe('EURAUD=X')
    const p = eurAud.price
    if (p != null && Number.isFinite(p) && p > 0) {
      fxAUDEUR = 1 / p
    }
  }
  if (fxAUDMYR == null || !Number.isFinite(fxAUDMYR)) {
    const row = await yahooQuoteSafe('AUDMYR=X')
    fxAUDMYR = row.price
  }
  if (fxAUDMYR == null || !Number.isFinite(fxAUDMYR)) {
    const myrAud = await yahooQuoteSafe('MYRAUD=X')
    const p = myrAud.price
    if (p != null && Number.isFinite(p) && p > 0) {
      fxAUDMYR = 1 / p
    }
  }

  const fx = {}
  if (fxAUDUSD != null && Number.isFinite(fxAUDUSD)) {
    fx.AUDUSD = fxAUDUSD
  }
  if (fxAUDEUR != null && Number.isFinite(fxAUDEUR)) {
    fx.AUDEUR = fxAUDEUR
  }
  if (fxAUDMYR != null && Number.isFinite(fxAUDMYR)) {
    fx.AUDMYR = fxAUDMYR
  }

  const idSet = [...new Set(cryptoJobs.map((j) => j.id))]
  if (idSet.length > 0) {
    const url = `${COINGECKO_SIMPLE}?ids=${encodeURIComponent(idSet.join(','))}&vs_currencies=usd%2Caud`

    let cgData = null
    let cgErrMsg = null
    try {
      const cgRes = await fetch(url, {
        headers: { Accept: 'application/json' },
      })
      if (!cgRes.ok) {
        throw new Error(`CoinGecko HTTP ${cgRes.status}`)
      }
      cgData = await cgRes.json()
    } catch (e) {
      cgErrMsg = e?.message || 'CoinGecko request failed'
    }

    for (const j of cryptoJobs) {
      if (cgErrMsg) {
        prices[j.ticker] = {
          price: null,
          error: cgErrMsg,
          source: 'coingecko',
        }
        continue
      }
      const row = cgData[j.id]
      const vsKey = j.vs
      const raw = row?.[vsKey]
      const num = raw != null ? Number(raw) : null
      if (num != null && Number.isFinite(num)) {
        prices[j.ticker] = {
          price: num,
          currency: vsKey.toUpperCase(),
          source: 'coingecko',
        }
      } else {
        prices[j.ticker] = {
          price: null,
          error: 'No CoinGecko price',
          source: 'coingecko',
        }
      }
    }
  }

  return {
    prices,
    fx,
    fetchedAt: new Date().toISOString(),
  }
}

const CACHE_CONTROL =
  's-maxage=300, stale-while-revalidate=600'

export async function sendPricesHttpResponse(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end()
    return
  }

  if (!assertSameOrigin(req, res)) return

  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', CACHE_CONTROL)
    res.end()
    return
  }

  const pathAndQuery = req.originalUrl || req.url || '/'
  const url = new URL(
    pathAndQuery,
    `http://${requestHost(req) || 'localhost'}`,
  )
  const tickersParam = url.searchParams.get('tickers') || ''

  const list = parseTickerList(tickersParam)
  const payload = await buildPricesPayload(list)

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', CACHE_CONTROL)
  res.end(JSON.stringify(payload))
}

/**
 * Vercel Node serverless: GET /api/prices?tickers=AAPL,BTC-USD
 */
export default async function handler(req, res) {
  await sendPricesHttpResponse(req, res)
}
