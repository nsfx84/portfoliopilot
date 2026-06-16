/**
 * Exchange suffix conventions for Yahoo Finance tickers.
 * See HOLDINGS_SCHEMA / PARCELS_SCHEMA in src/data/schemas.js.
 */

/** @param {string} ticker */
export function isKlseTicker(ticker) {
  return /\.KL$/i.test(String(ticker || '').trim())
}

/** @param {string} ticker */
export function isAsxTicker(ticker) {
  return /\.AX$/i.test(String(ticker || '').trim())
}

/**
 * KLSE stock: Bursa Malaysia suffix or live quote in MYR.
 *
 * @param {string} ticker
 * @param {string} [quoteCurrency]
 */
export function isKlseStock(ticker, quoteCurrency) {
  if (isKlseTicker(ticker)) return true
  return String(quoteCurrency || '').toUpperCase() === 'MYR'
}

/** @param {string} [assetClass] */
export function isCryptoAsset(assetClass) {
  return String(assetClass || '').toUpperCase() === 'CRYPTO'
}

/**
 * @param {string} ticker
 * @param {string} [assetClass]
 */
export function isUsStock(ticker, assetClass) {
  if (isCryptoAsset(assetClass)) return false
  const ac = String(assetClass || '').toUpperCase()
  if (['US', 'NASDAQ', 'NYSE'].includes(ac)) return true
  const t = String(ticker || '').trim()
  if (!t || isKlseTicker(t) || isAsxTicker(t)) return false
  if (/-/.test(t)) return false
  return !/\./.test(t)
}

/**
 * Geographic bucket for net-worth charts: au | my | us | borderless.
 *
 * @param {{ ticker?: string, assetClass?: string, quoteCurrency?: string }} holding
 */
export function geographicRegionForHolding(holding) {
  const ticker = holding.ticker ?? ''
  const quoteCurrency = String(holding.quoteCurrency || '').toUpperCase()

  if (isCryptoAsset(holding.assetClass)) return 'borderless'
  if (isKlseStock(ticker, quoteCurrency)) return 'my'
  if (isAsxTicker(ticker) || String(holding.assetClass || '').toUpperCase() === 'ASX') {
    return 'au'
  }
  if (isUsStock(ticker, holding.assetClass)) return 'us'
  return 'borderless'
}

/**
 * FX exposure bucket for net-worth charts: aud | myr | crypto.
 * Values are already AUD-denominated; bucket reflects underlying quote currency.
 *
 * @param {{ ticker?: string, assetClass?: string, quoteCurrency?: string }} holding
 */
export function fxBucketForHolding(holding) {
  if (isCryptoAsset(holding.assetClass)) return 'crypto'
  if (isKlseStock(holding.ticker, holding.quoteCurrency)) return 'myr'
  return 'aud'
}
