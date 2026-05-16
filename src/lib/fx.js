export const FX_SOURCE_RBA = 'RBA'

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
  }
}

/**
 * Cached rates map for UI wiring; keys are ISO quote currencies.
 * @param {string} asOfDate
 */
export async function getCachedAudFxMap(asOfDate) {
  return fetchRbaDailyRates(asOfDate)
}
