/**
 * Dashboard sample portfolio: matches `schemas.js` shapes conceptually (not persisted yet).
 */

export const SAMPLE_PRICE_CACHE = {
  'CBA.AX': {
    ticker: 'CBA.AX',
    lastPrice: 118.62,
    quoteCurrency: 'AUD',
    regularMarketPreviousClose: 118.17,
    regularMarketChangePercent: 0.38,
    shortName: 'Commonwealth Bank',
  },
  AAPL: {
    ticker: 'AAPL',
    lastPrice: 212.45,
    quoteCurrency: 'USD',
    regularMarketPreviousClose: 214.42,
    regularMarketChangePercent: -0.92,
    shortName: 'Apple Inc.',
  },
  IVV: {
    ticker: 'IVV',
    lastPrice: 522.8,
    quoteCurrency: 'AUD',
    regularMarketPreviousClose: 521.7,
    regularMarketChangePercent: 0.21,
    shortName: 'iShares S&P 500 ETF',
  },
  'BTC-AUD': {
    ticker: 'BTC-AUD',
    lastPrice: 98240,
    quoteCurrency: 'AUD',
    regularMarketPreviousClose: 97120,
    regularMarketChangePercent: 1.05,
    shortName: 'Bitcoin (AUD pair)',
  },
}

/** Cached FX: AUD per 1 unit of quote currency */
export const SAMPLE_FX_AUD_PER_UNIT = {
  AUD: 1,
  USD: 1.5342,
  EUR: 1.64,
}

/**
 * Holdings snapshot rows — qty & avg cost in native quote currency units.
 * avgCostNative is volume-weighted average for display only here.
 */
export const SAMPLE_HOLDINGS = [
  {
    ticker: 'CBA.AX',
    assetClass: 'ASX',
    quantity: 120,
    avgCostNative: 112.4,
    quoteCurrency: 'AUD',
  },
  {
    ticker: 'AAPL',
    assetClass: 'US',
    quantity: 35,
    avgCostNative: 178.25,
    quoteCurrency: 'USD',
  },
  {
    ticker: 'IVV',
    assetClass: 'ETF',
    quantity: 80,
    avgCostNative: 498.6,
    quoteCurrency: 'AUD',
  },
  {
    ticker: 'BTC-AUD',
    assetClass: 'CRYPTO',
    quantity: 0.42,
    avgCostNative: 88450,
    quoteCurrency: 'AUD',
  },
]
