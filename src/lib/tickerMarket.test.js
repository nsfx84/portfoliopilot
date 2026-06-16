import { describe, expect, it } from 'vitest'
import {
  fxBucketForHolding,
  geographicRegionForHolding,
  isKlseStock,
} from './tickerMarket.js'

describe('isKlseStock', () => {
  it('detects .KL suffix and MYR quote currency', () => {
    expect(isKlseStock('5171.KL', 'MYR')).toBe(true)
    expect(isKlseStock('5171.KL', 'USD')).toBe(true)
    expect(isKlseStock('CBA.AX', 'MYR')).toBe(true)
    expect(isKlseStock('CBA.AX', 'AUD')).toBe(false)
  })
})

describe('fxBucketForHolding', () => {
  it('attributes KLSE to MYR and crypto to crypto', () => {
    expect(
      fxBucketForHolding({
        ticker: '5171.KL',
        assetClass: 'OTHER',
        quoteCurrency: 'MYR',
      }),
    ).toBe('myr')
    expect(
      fxBucketForHolding({
        ticker: 'BTC-USD',
        assetClass: 'CRYPTO',
        quoteCurrency: 'USD',
      }),
    ).toBe('crypto')
    expect(
      fxBucketForHolding({
        ticker: 'CBA.AX',
        assetClass: 'ASX',
        quoteCurrency: 'AUD',
      }),
    ).toBe('aud')
  })
})

describe('geographicRegionForHolding', () => {
  it('maps KLSE, ASX, US, and crypto', () => {
    expect(
      geographicRegionForHolding({
        ticker: '5171.KL',
        quoteCurrency: 'MYR',
      }),
    ).toBe('my')
    expect(
      geographicRegionForHolding({
        ticker: 'CBA.AX',
        assetClass: 'ASX',
      }),
    ).toBe('au')
    expect(
      geographicRegionForHolding({
        ticker: 'AAPL',
        assetClass: 'US',
        quoteCurrency: 'USD',
      }),
    ).toBe('us')
    expect(
      geographicRegionForHolding({
        ticker: 'BTC-USD',
        assetClass: 'CRYPTO',
      }),
    ).toBe('borderless')
  })
})
