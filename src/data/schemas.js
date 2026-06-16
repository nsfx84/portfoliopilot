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
  properties: 'properties',
  cashAccounts: 'cashAccounts',
  liabilities: 'liabilities',
  netWorthSnapshots: 'netWorthSnapshots',
}

/**
 * Yahoo Finance ticker suffix convention (canonical `ticker` on holdings / parcels):
 *
 * | Market              | Suffix   | Example    | Quote ccy |
 * |---------------------|----------|------------|-----------|
 * | ASX (Australia)     | `.AX`    | `CBA.AX`   | AUD       |
 * | KLSE (Malaysia)     | `.KL`    | `5171.KL`  | MYR       |
 * | US (NASDAQ/NYSE)    | (none)   | `AAPL`     | USD       |
 * | Crypto (Yahoo)      | `-USD`   | `BTC-USD`  | USD       |
 *
 * Suffixes are passed through to Yahoo Finance unchanged. Net-worth FX exposure
 * and geographic charts infer currency/region from the live quote and suffix.
 */

/**
 * holdings — aggregated position metadata per ticker / instrument (derivable from parcels).
 * Typically one doc per userId + ticker composite key or deterministic doc id.
 *
 * Fields:
 * - userId: string — Firebase Auth uid
 * - ticker: string — canonical Yahoo symbol (e.g. CBA.AX, AAPL, 5171.KL, BTC-USD)
 * - displayName: string — optional human label
 * - assetClass: 'ASX' | 'US' | 'NASDAQ' | 'NYSE' | 'ETF' | 'CRYPTO' | 'OTHER'
 * - quoteCurrency: string — ISO 4217 for fiat (AUD, USD, MYR), or synthetic for crypto pairs
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
 * - ticker: string — aligns with holdings.ticker (Yahoo suffix convention; see file header)
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

/**
 * properties — manually-entered real estate under users/{uid}/properties/{propertyId}.
 *
 * Fields:
 * - name: string
 * - type: 'residential' | 'commercial'
 * - country: 'AU' | 'MY'
 * - ownership: 'Matterhorn Trust' | 'joint' | 'wife' | 'personal'
 * - currentValueAUD: number
 * - grossRentAUD: number — annual
 * - annualCostsAUD: number
 * - createdAt: Timestamp
 * - updatedAt: Timestamp
 */
export const PROPERTIES_SCHEMA = {
  collection: COLLECTIONS.properties,
  fields: [
    'name',
    'type',
    'country',
    'ownership',
    'currentValueAUD',
    'grossRentAUD',
    'annualCostsAUD',
    'createdAt',
    'updatedAt',
  ],
}

/**
 * cashAccounts — bank / offset / savings balances under users/{uid}/cashAccounts/{accountId}.
 *
 * Fields:
 * - name: string
 * - provider: string
 * - currency: 'AUD' | 'MYR'
 * - balanceAUD: number — always stored in AUD-equivalent
 * - interestRate: number
 * - type: 'savings' | 'offset' | 'checking'
 * - createdAt: Timestamp
 * - updatedAt: Timestamp
 */
export const CASH_ACCOUNTS_SCHEMA = {
  collection: COLLECTIONS.cashAccounts,
  fields: [
    'name',
    'provider',
    'currency',
    'balanceAUD',
    'interestRate',
    'type',
    'createdAt',
    'updatedAt',
  ],
}

/**
 * liabilities — mortgages and other debt under users/{uid}/liabilities/{liabilityId}.
 *
 * Fields:
 * - name: string
 * - linkedPropertyId: string — optional FK to properties doc
 * - lender: string
 * - balanceAUD: number
 * - interestRate: number
 * - type: 'mortgage' | 'credit_card' | 'personal' | 'car_loan'
 * - createdAt: Timestamp
 * - updatedAt: Timestamp
 */
export const LIABILITIES_SCHEMA = {
  collection: COLLECTIONS.liabilities,
  fields: [
    'name',
    'linkedPropertyId',
    'lender',
    'balanceAUD',
    'interestRate',
    'type',
    'createdAt',
    'updatedAt',
  ],
}

/**
 * netWorthSnapshots — daily/weekly net worth history under users/{uid}/netWorthSnapshots/{date}.
 *
 * Fields:
 * - date: string — ISO 'YYYY-MM-DD'
 * - totalAssets: number
 * - totalLiabilities: number
 * - netWorth: number
 * - breakdown: { property, cash, stocks, crypto, super, other? }
 */
export const NET_WORTH_SNAPSHOTS_SCHEMA = {
  collection: COLLECTIONS.netWorthSnapshots,
  fields: [
    'date',
    'totalAssets',
    'totalLiabilities',
    'netWorth',
    'breakdown',
  ],
}
