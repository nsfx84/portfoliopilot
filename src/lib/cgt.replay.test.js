import { describe, expect, it } from 'vitest'
import {
  calculateCgtForFY,
  normalizeFirestoreTransaction,
  sortTransactionsForReplay,
} from './cgt.js'
import { buildParcelsFromTransactions } from './sharesightImporter.js'

/** Minimal stand-in for a Firestore Timestamp. */
function ts(date) {
  return { toDate: () => date }
}

function importedBuy(overrides = {}) {
  return {
    id: 'imported-1',
    kind: 'BUY',
    sharesightType: 'buy',
    ticker: 'CBA.AX',
    market: 'ASX',
    name: 'Commonwealth Bank',
    assetClass: 'ASX',
    quoteCurrency: 'AUD',
    quantity: 100,
    totalCostAud: 10000,
    rowIndex: 3,
    executedAt: ts(new Date(2020, 0, 15, 12)),
    source: 'sharesight',
    sourceBroker: 'sharesight',
    ...overrides,
  }
}

function manualSell(overrides = {}) {
  return {
    id: 'manual-1',
    kind: 'SELL',
    sharesightType: 'sell',
    ticker: 'CBA.AX',
    market: 'ASX',
    name: 'Commonwealth Bank',
    assetClass: 'ASX',
    quoteCurrency: 'AUD',
    quantity: 40,
    netProceedsAud: 6000,
    rowIndex: null,
    executedAt: ts(new Date(2025, 8, 1, 12)),
    createdAt: ts(new Date(2026, 8, 24, 9)),
    source: 'manual',
    sourceBroker: 'manual',
    deleted: false,
    ...overrides,
  }
}

describe('normalizeFirestoreTransaction', () => {
  it('drops soft-deleted documents', () => {
    expect(normalizeFirestoreTransaction(manualSell({ deleted: true }))).toBeNull()
    expect(normalizeFirestoreTransaction(manualSell())).not.toBeNull()
  })

  it('keeps documents written before the deleted flag existed', () => {
    const legacy = importedBuy()
    delete legacy.deleted
    expect(normalizeFirestoreTransaction(legacy)).not.toBeNull()
  })

  it('gives imported rows their sheet order and manual rows a trailing sequence', () => {
    expect(normalizeFirestoreTransaction(importedBuy()).sequence).toBe(3)
    expect(normalizeFirestoreTransaction(manualSell()).sequence).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })
})

describe('sortTransactionsForReplay', () => {
  const sameDay = new Date(2025, 8, 1, 12)

  it('replays same-day manual rows after imported ones', () => {
    const rows = [
      manualSell({ id: 'm', executedAt: ts(sameDay) }),
      importedBuy({ id: 'i', rowIndex: 7, executedAt: ts(sameDay) }),
    ].map(normalizeFirestoreTransaction)

    expect(sortTransactionsForReplay(rows).map((r) => r.id)).toEqual(['i', 'm'])
  })

  it('breaks ties between manual rows by creation time', () => {
    const rows = [
      manualSell({
        id: 'later',
        executedAt: ts(sameDay),
        createdAt: ts(new Date(2026, 8, 24, 11)),
      }),
      manualSell({
        id: 'earlier',
        executedAt: ts(sameDay),
        createdAt: ts(new Date(2026, 8, 24, 9)),
      }),
    ].map(normalizeFirestoreTransaction)

    expect(sortTransactionsForReplay(rows).map((r) => r.id)).toEqual([
      'earlier',
      'later',
    ])
  })

  it('still orders by date first', () => {
    const rows = [
      manualSell({ id: 'new', executedAt: ts(new Date(2025, 8, 1, 12)) }),
      importedBuy({ id: 'old', executedAt: ts(new Date(2020, 0, 15, 12)) }),
    ].map(normalizeFirestoreTransaction)

    expect(sortTransactionsForReplay(rows).map((r) => r.id)).toEqual(['old', 'new'])
  })
})

describe('imported and manual rows replayed together', () => {
  const ledger = sortTransactionsForReplay(
    [importedBuy(), manualSell()].map(normalizeFirestoreTransaction),
  )

  it('rebuilds parcels net of the manual sell', () => {
    const { parcels, holdings } = buildParcelsFromTransactions(ledger)
    expect(parcels).toHaveLength(1)
    expect(parcels[0].remainingQuantity).toBeCloseTo(60, 8)
    // 40 of 100 units sold removes 40% of the $10,000 cost base.
    expect(parcels[0].totalCostAud).toBeCloseTo(6000, 8)
    expect(holdings).toHaveLength(1)
    expect(holdings[0].ticker).toBe('CBA.AX')
  })

  it('realises the manual sell into the FY it falls in, with the CGT discount', () => {
    // Sold 1 Sep 2025 → FY2026. Proceeds 6000 against a 4000 cost base.
    const fy2026 = calculateCgtForFY(ledger, null, 2026, 'FIFO', 0)
    expect(fy2026.sales).toHaveLength(1)
    expect(fy2026.grossGains).toBeCloseTo(2000, 8)
    expect(fy2026.discountEligibleGain).toBeCloseTo(2000, 8)
    expect(fy2026.taxableCapitalGain).toBeCloseTo(1000, 8)

    const fy2025 = calculateCgtForFY(ledger, null, 2025, 'FIFO', 0)
    expect(fy2025.sales).toHaveLength(0)
  })

  it('leaves the parcel whole once the sell is soft-deleted', () => {
    const afterDelete = sortTransactionsForReplay(
      [importedBuy(), manualSell({ deleted: true })]
        .map(normalizeFirestoreTransaction)
        .filter(Boolean),
    )
    const { parcels } = buildParcelsFromTransactions(afterDelete)
    expect(parcels).toHaveLength(1)
    expect(parcels[0].remainingQuantity).toBeCloseTo(100, 8)
    expect(parcels[0].totalCostAud).toBeCloseTo(10000, 8)
    expect(calculateCgtForFY(afterDelete, null, 2026, 'FIFO', 0).sales).toHaveLength(0)
  })
})
