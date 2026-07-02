import { describe, expect, it, vi } from 'vitest'

vi.mock('./firebase.js', () => ({
  db: {},
  storage: {},
}))

import {
  aggregateSpendingTotals,
  buildStatementStoragePath,
  defaultMonthlyUsage,
  filterSpendingTransactions,
  sanitizeStatementFilename,
  summarizeSpendingTransactions,
} from './statementService.js'

const SAMPLE_TRANSACTIONS = [
  {
    id: '1',
    date: '2026-05-10',
    merchant: 'WOOLWORTHS 3317',
    merchantNormalised: 'Woolworths',
    amount: 85.4,
    category: 'Groceries',
    source: { statementId: 'stmt-a', account: 'amex' },
  },
  {
    id: '2',
    date: '2026-05-15',
    merchant: 'UBER EATS',
    merchantNormalised: 'Uber Eats',
    amount: 32.5,
    category: 'Dining',
    source: { statementId: 'stmt-a', account: 'amex' },
  },
  {
    id: '3',
    date: '2026-06-01',
    merchant: 'WOOLWORTHS ONLINE',
    merchantNormalised: 'Woolworths',
    amount: -12,
    category: 'Groceries',
    source: { statementId: 'stmt-b', account: 'cba' },
  },
  {
    id: '4',
    date: '2026-06-20',
    merchant: 'NETFLIX',
    merchantNormalised: 'Netflix',
    amount: 22.99,
    category: 'Subscriptions',
    source: { statementId: 'stmt-b', account: 'cba' },
  },
]

describe('sanitizeStatementFilename', () => {
  it('keeps safe filenames and falls back for empty input', () => {
    expect(sanitizeStatementFilename('2026-06-04.pdf')).toBe('2026-06-04.pdf')
    expect(sanitizeStatementFilename('')).toBe('statement.pdf')
    expect(sanitizeStatementFilename('weird#name!.pdf')).toBe('weird_name_.pdf')
  })

  it('strips directory segments from paths', () => {
    expect(sanitizeStatementFilename('C:\\downloads\\amex.pdf')).toBe('amex.pdf')
  })
})

describe('buildStatementStoragePath', () => {
  it('builds the per-user statement storage path', () => {
    expect(
      buildStatementStoragePath('uid-1', 'stmt-1', '2026-06-04.pdf'),
    ).toBe('users/uid-1/statements/stmt-1/2026-06-04.pdf')
  })
})

describe('aggregateSpendingTotals', () => {
  it('sums debits and credits separately', () => {
    expect(aggregateSpendingTotals(SAMPLE_TRANSACTIONS)).toEqual({
      transactionCount: 4,
      totalDebits: 85.4 + 32.5 + 22.99,
      totalCredits: 12,
    })
  })

  it('treats invalid amounts as zero', () => {
    expect(
      aggregateSpendingTotals([
        { amount: 'x' },
        { amount: 10 },
        { amount: -3 },
      ]),
    ).toEqual({
      transactionCount: 3,
      totalDebits: 10,
      totalCredits: 3,
    })
  })
})

describe('filterSpendingTransactions', () => {
  it('filters by date range', () => {
    const result = filterSpendingTransactions(SAMPLE_TRANSACTIONS, {
      startDate: '2026-05-15',
      endDate: '2026-06-01',
    })

    expect(result.map((tx) => tx.id)).toEqual(['2', '3'])
  })

  it('filters by categories', () => {
    const result = filterSpendingTransactions(SAMPLE_TRANSACTIONS, {
      categories: ['Groceries', 'Subscriptions'],
    })

    expect(result.map((tx) => tx.id)).toEqual(['1', '3', '4'])
  })

  it('filters by merchant search across raw and normalised names', () => {
    const result = filterSpendingTransactions(SAMPLE_TRANSACTIONS, {
      merchant: 'wool',
    })

    expect(result.map((tx) => tx.id)).toEqual(['1', '3'])
  })
})

describe('summarizeSpendingTransactions', () => {
  it('returns filtered rows and aggregated totals together', () => {
    const result = summarizeSpendingTransactions(SAMPLE_TRANSACTIONS, {
      startDate: '2026-06-01',
      categories: ['Groceries', 'Subscriptions'],
    })

    expect(result.transactions.map((tx) => tx.id)).toEqual(['3', '4'])
    expect(result.transactionCount).toBe(2)
    expect(result.totalDebits).toBe(22.99)
    expect(result.totalCredits).toBe(12)
  })
})

describe('defaultMonthlyUsage', () => {
  it('returns zeroed usage for a month', () => {
    expect(defaultMonthlyUsage('2026-06')).toEqual({
      month: '2026-06',
      statementsProcessed: 0,
      totalCostUsd: 0,
    })
  })
})
