import { describe, expect, it, vi } from 'vitest'

vi.mock('./firebase.js', () => ({
  db: {},
  auth: {},
}))

vi.mock('./portfolioService.js', () => ({
  getTotalValueByCategory: vi.fn(),
}))

import {
  aggregateNetWorthSummary,
  computeFXExposure,
  computeGeographicSplit,
  sumAud,
} from './netWorthService.js'

describe('sumAud', () => {
  it('sums numeric values and treats non-numbers as zero', () => {
    expect(sumAud([100, 200, 50])).toBe(350)
    expect(sumAud([100, null, undefined, 'x'])).toBe(100)
  })
})

describe('computeFXExposure', () => {
  it('splits property, cash, and portfolio values into AUD/MYR/crypto buckets', () => {
    const result = computeFXExposure(
      [{ currentValueAUD: 1_600_000 }],
      [
        { currency: 'AUD', balanceAUD: 500_000 },
        { currency: 'MYR', balanceAUD: 200_000 },
      ],
      [
        { ticker: 'CBA.AX', assetClass: 'ASX', quoteCurrency: 'AUD', marketValueAud: 300_000 },
        { ticker: 'BTC-USD', assetClass: 'CRYPTO', quoteCurrency: 'USD', marketValueAud: 150_000 },
      ],
    )

    expect(result).toEqual({
      aud: 1_600_000 + 500_000 + 300_000,
      myr: 200_000,
      crypto: 150_000,
    })
  })

  it('attributes KLSE holdings to MYR via live quote currency', () => {
    const result = computeFXExposure([], [], [
      {
        ticker: '5171.KL',
        assetClass: 'OTHER',
        quoteCurrency: 'MYR',
        marketValueAud: 2_500_000,
      },
    ])

    expect(result).toEqual({ aud: 0, myr: 2_500_000, crypto: 0 })
  })
})

describe('computeGeographicSplit', () => {
  it('maps properties, cash, and portfolio by country/currency and ticker suffix', () => {
    const result = computeGeographicSplit(
      [
        { country: 'AU', currentValueAUD: 1_000_000 },
        { country: 'MY', currentValueAUD: 400_000 },
      ],
      [
        { currency: 'AUD', balanceAUD: 100_000 },
        { currency: 'MYR', balanceAUD: 50_000 },
      ],
      [
        { ticker: 'CBA.AX', assetClass: 'ASX', marketValueAud: 250_000 },
        { ticker: '5171.KL', assetClass: 'OTHER', quoteCurrency: 'MYR', marketValueAud: 75_000 },
      ],
    )

    expect(result).toEqual({
      au: 1_000_000 + 100_000 + 250_000,
      my: 400_000 + 50_000 + 75_000,
      us: 0,
      borderless: 0,
    })
  })
})

describe('aggregateNetWorthSummary', () => {
  it('computes assets, liabilities, net worth, liquid wealth, and breakdown', () => {
    const portfolio = {
      stocks: 200_000,
      etfs: 100_000,
      crypto: 50_000,
      super: 0,
      holdings: [
        { ticker: 'CBA.AX', assetClass: 'ASX', quoteCurrency: 'AUD', marketValueAud: 200_000 },
        { ticker: 'VAS.AX', assetClass: 'ETF', quoteCurrency: 'AUD', marketValueAud: 100_000 },
        { ticker: 'BTC-USD', assetClass: 'CRYPTO', quoteCurrency: 'USD', marketValueAud: 50_000 },
      ],
    }
    const properties = [{ country: 'AU', currentValueAUD: 1_600_000 }]
    const cashAccounts = [{ currency: 'AUD', balanceAUD: 1_000_000 }]
    const liabilities = [{ balanceAUD: 900_000 }]

    const summary = aggregateNetWorthSummary(
      portfolio,
      properties,
      cashAccounts,
      liabilities,
    )

    expect(summary.breakdown).toEqual({
      property: 1_600_000,
      cash: 1_000_000,
      stocks: 300_000,
      crypto: 50_000,
      super: 0,
    })
    expect(summary.totalAssets).toBe(1_600_000 + 1_000_000 + 300_000 + 50_000)
    expect(summary.totalLiabilities).toBe(900_000)
    expect(summary.netWorth).toBe(summary.totalAssets - summary.totalLiabilities)
    expect(summary.liquid).toBe(1_000_000 + 300_000 + 50_000)
    expect(summary.fxExposure.aud).toBe(
      1_600_000 + 1_000_000 + 200_000 + 100_000,
    )
    expect(summary.fxExposure.crypto).toBe(50_000)
    expect(summary.geographic.au).toBe(1_600_000 + 1_000_000 + 200_000 + 100_000)
    expect(summary.geographic.borderless).toBe(50_000)
  })

  it('returns zeros when all inputs are empty', () => {
    const summary = aggregateNetWorthSummary(
      { stocks: 0, etfs: 0, crypto: 0, super: 0, holdings: [] },
      [],
      [],
      [],
    )

    expect(summary).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      liquid: 0,
      breakdown: {
        property: 0,
        cash: 0,
        stocks: 0,
        crypto: 0,
        super: 0,
      },
      fxExposure: { aud: 0, myr: 0, crypto: 0 },
      geographic: { au: 0, my: 0, us: 0, borderless: 0 },
    })
  })
})
