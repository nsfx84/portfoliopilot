import { beforeEach, describe, expect, it } from 'vitest'
import { clearSpotCache } from './fx.js'
import { convertQuoteToAud } from './valuation.js'

describe('convertQuoteToAud', () => {
  beforeEach(() => clearSpotCache())

  it('passes AUD through unchanged', () => {
    expect(convertQuoteToAud(42, 'AUD', '', {})).toBe(42)
    expect(convertQuoteToAud({ price: 42, currency: 'AUD' }, {})).toBe(42)
  })

  it('converts USD using Yahoo AUDUSD convention', () => {
    const fx = { AUDUSD: 0.65 }
    expect(convertQuoteToAud(100, 'USD', '', fx)).toBeCloseTo(100 / 0.65, 4)
  })

  it('converts MYR to AUD with mocked FX rate', () => {
    const fx = { AUDMYR: 3.0 }
    const aud = convertQuoteToAud({ price: 100, currency: 'MYR' }, fx)
    expect(aud).toBeCloseTo(100 / 3, 4)
  })

  it('returns 0 for unsupported currencies', () => {
    expect(convertQuoteToAud(50, 'JPY', '', {})).toBe(0)
  })
})
