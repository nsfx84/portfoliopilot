/**
 * Firestore collection identifiers used across PortfolioPilot.
 * Paths can nest under users/{userId}/… when rules require per-user isolation.
 */
export const COLLECTIONS = {
  holdings: 'holdings',
  parcels: 'parcels',
  transactions: 'transactions',
  fxRates: 'fxRates',
  priceCache: 'priceCache',
}

/**
 * holdings — aggregated position metadata per ticker / instrument (derivable from parcels).
 * Typically one doc per userId + ticker composite key or deterministic doc id.
 *
 * Fields:
 * - userId: string — Firebase Auth uid
 * - ticker: string — canonical symbol (e.g. CBA.AX, AAPL, BTC-AUD)
 * - displayName: string — optional human label
 * - assetClass: 'ASX' | 'US' | 'CRYPTO' | 'ETF'
 * - quoteCurrency: string — ISO 4217 for fiat (AUD, USD), or synthetic for crypto pairs
 * - totalQuantity: number — net on-hand units (sum of parcel remainingQuantity)
 * - notes: string — optional
 * - createdAt: Timestamp
 * - updatedAt: Timestamp
 */
export const HOLDINGS_SCHEMA = {
  collection: COLLECTIONS.holdings,
  fields: [
    'userId',
    'ticker',
    'displayName',
    'assetClass',
    'quoteCurrency',
    'totalQuantity',
    'notes',
    'createdAt',
    'updatedAt',
  ],
}

/**
 * parcels — tax lots / cost-base parcels with FIFO/LIFO/minGain consumption via remainingQuantity.
 *
 * Fields:
 * - userId: string
 * - holdingId: string — optional reference to holdings doc id
 * - ticker: string — aligns with holdings.ticker
 * - acquisitionTxnId: string — originating buy transaction id (optional but recommended)
 * - acquiredAt: Timestamp — settlement / trade date for CGT ordering
 * - originalQuantity: number — units acquired in this parcel
 * - remainingQuantity: number — units not yet disposed (FIFO/LIFO decrement sales here)
 * - unitCostAud: number — AUD cost per unit including proportional brokerage for this parcel
 * - acquisitionCurrency: string — currency unitCost was sourced from before AUD conversion (optional audit)
 * - fxAudPerUnitAtAcquisition: number — optional audit trail when converting to AUD
 * - isEligibleForDiscount: boolean — held >12 months (Australian resident CGT discount flag at parcel level)
 * - createdAt: Timestamp
 * - updatedAt: Timestamp
 */
export const PARCELS_SCHEMA = {
  collection: COLLECTIONS.parcels,
  fields: [
    'userId',
    'holdingId',
    'ticker',
    'acquisitionTxnId',
    'acquiredAt',
    'originalQuantity',
    'remainingQuantity',
    'unitCostAud',
    'acquisitionCurrency',
    'fxAudPerUnitAtAcquisition',
    'isEligibleForDiscount',
    'createdAt',
    'updatedAt',
  ],
}

/**
 * transactions — cash ledger events that create parcels or realised gains (buys/sells/dividends…).
 *
 * Fields:
 * - userId: string
 * - kind: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'TRANSFER_IN' | 'TRANSFER_OUT'
 * - ticker: string — optional for non-security cash rows
 * - quantity: number — signed semantics optional; prefer absolute + kind
 * - unitPrice: number — in quoteCurrency where applicable
 * - feesAud: number — brokerage/fees converted to AUD for consistent reporting
 * - quoteCurrency: string
 * - fxAudPerQuoteUnit: number — AUD per 1 unit of quoteCurrency at execution (snapshot)
 * - executedAt: Timestamp
 * - settlementAt: Timestamp — optional
 * - externalRef: string — broker trade id / hash
 * - notes: string
 * - createdAt: Timestamp
 */
export const TRANSACTIONS_SCHEMA = {
  collection: COLLECTIONS.transactions,
  fields: [
    'userId',
    'kind',
    'ticker',
    'quantity',
    'unitPrice',
    'feesAud',
    'quoteCurrency',
    'fxAudPerQuoteUnit',
    'executedAt',
    'settlementAt',
    'externalRef',
    'notes',
    'createdAt',
  ],
}

/**
 * fxRates — cached foreign-exchange snapshots (e.g. RBA daily AUD crosses).
 *
 * Document id suggestion: `${quoteCurrency}_${asOfDate}` under base AUD.
 *
 * Fields:
 * - baseCurrency: string — always 'AUD' for this app’s reporting currency
 * - quoteCurrency: string — 'USD', 'EUR', …
 * - audPerQuoteUnit: number — AUD equivalent for one unit of quoteCurrency (e.g. 1 USD → n AUD)
 * - asOfDate: string — ISO date 'YYYY-MM-DD'
 * - source: string — 'RBA' | 'manual' | …
 * - fetchedAt: Timestamp
 */
export const FX_RATES_SCHEMA = {
  collection: COLLECTIONS.fxRates,
  fields: [
    'baseCurrency',
    'quoteCurrency',
    'audPerQuoteUnit',
    'asOfDate',
    'source',
    'fetchedAt',
  ],
}

/**
 * priceCache — intraday / daily quote cache keyed by ticker for dashboard valuations.
 *
 * Fields:
 * - ticker: string — mirrors Yahoo / broker symbol used client-side
 * - lastPrice: number — last trade / regular hours close proxy in quoteCurrency
 * - quoteCurrency: string
 * - regularMarketPreviousClose: number
 * - regularMarketChangePercent: number — daily % move vs prior close
 * - shortName: string — optional label from vendor
 * - updatedAt: Timestamp
 */
export const PRICE_CACHE_SCHEMA = {
  collection: COLLECTIONS.priceCache,
  fields: [
    'ticker',
    'lastPrice',
    'quoteCurrency',
    'regularMarketPreviousClose',
    'regularMarketChangePercent',
    'shortName',
    'updatedAt',
  ],
}
