import { beforeEach, describe, expect, it } from 'vitest'
import {
  audPerQuoteFromYahooBundle,
  buildFxAudPerUnit,
  clearSpotCache,
  getSpot,
} from './fx.js'

describe('getSpot', () => {
  beforeEach(() => clearSpotCache())

  it('returns 1 for same currency', () => {
    expect(getSpot('AUD', 'AUD')).toBe(1)
    expect(getSpot('MYR', 'MYR')).toBe(1)
  })

  it('converts USD to AUD via Yahoo AUDUSD bundle', () => {
    const fx = { AUDUSD: 0.65 }
    expect(getSpot('USD', 'AUD', fx)).toBeCloseTo(1 / 0.65, 6)
  })

  it('converts MYR to AUD via Yahoo AUDMYR bundle', () => {
    const fx = { AUDMYR: 3.0 }
    expect(getSpot('MYR', 'AUD', fx)).toBeCloseTo(1 / 3, 6)
  })

  it('caches spot rates for the session', () => {
    const fx = { AUDMYR: 3.0 }
    expect(getSpot('MYR', 'AUD', fx)).toBeCloseTo(1 / 3, 6)
    expect(getSpot('MYR', 'AUD', {})).toBeCloseTo(1 / 3, 6)
  })
})

describe('audPerQuoteFromYahooBundle', () => {
  it('returns AUD per quote unit from AUDXXX keys', () => {
    expect(audPerQuoteFromYahooBundle({ AUDUSD: 0.65 }, 'USD')).toBeCloseTo(
      1 / 0.65,
      6,
    )
    expect(audPerQuoteFromYahooBundle({ AUDMYR: 3.0 }, 'MYR')).toBeCloseTo(
      1 / 3,
      6,
    )
  })
})

describe('buildFxAudPerUnit', () => {
  beforeEach(() => clearSpotCache())

  it('includes MYR in the aud-per-unit map', () => {
    const map = buildFxAudPerUnit({ AUDMYR: 3.0 })
    expect(map.MYR).toBeCloseTo(1 / 3, 6)
    expect(map.AUD).toBe(1)
  })
})
