import { describe, expect, it } from 'vitest'
import {
  buildManualTradeDoc,
  computeTradeTotals,
  defaultCurrencyForMarket,
  emptyTradeForm,
  FALLBACK_MARKET,
  currentFinancialYearMelbourne,
  financialYearForDate,
  formatTradeBreakdown,
  isoDateToLocalDate,
  LAST_MARKET_KEY,
  localDateToIsoDate,
  mostRecentManualMarket,
  readLastMarket,
  todayInMelbourne,
  tradeDocToForm,
  validateTrade,
  warnIfClosedFinancialYear,
  writeLastMarket,
} from './manualTrades.js'

describe('computeTradeTotals', () => {
  it('adds brokerage to an AUD buy', () => {
    const t = computeTradeTotals({
      type: 'buy',
      quantity: '100',
      price: '10',
      currency: 'AUD',
      brokerage: '9.5',
    })
    expect(t.totalAud).toBeCloseTo(1009.5, 8)
  })

  it('subtracts brokerage from an AUD sell', () => {
    const t = computeTradeTotals({
      type: 'sell',
      quantity: '100',
      price: '10',
      currency: 'AUD',
      brokerage: '9.5',
    })
    expect(t.totalAud).toBeCloseTo(990.5, 8)
  })

  it('ignores a supplied fx rate when the currency is AUD', () => {
    const t = computeTradeTotals({
      type: 'buy',
      quantity: '10',
      price: '5',
      currency: 'AUD',
      fxRate: '1.46',
      brokerage: '0',
    })
    expect(t.fxRate).toBe(1)
    expect(t.totalAud).toBeCloseTo(50, 8)
  })

  it('converts a foreign buy and adds AUD brokerage outside the conversion', () => {
    const t = computeTradeTotals({
      type: 'buy',
      quantity: '50',
      price: '78.99',
      currency: 'USD',
      fxRate: '1.4611',
      brokerage: '0',
    })
    expect(t.grossAud).toBeCloseTo(5770.61445, 6)
    expect(t.totalAud).toBeCloseTo(5770.61445, 6)
  })

  it('handles fractional crypto quantities', () => {
    const t = computeTradeTotals({
      type: 'buy',
      quantity: '0.00125',
      price: '96000',
      currency: 'USD',
      fxRate: '1.5',
      brokerage: '0',
    })
    expect(t.totalAud).toBeCloseTo(180, 8)
  })

  it('is incomplete until quantity, price and a positive fx rate are present', () => {
    expect(
      computeTradeTotals({ type: 'buy', quantity: '1', currency: 'AUD' }).complete,
    ).toBe(false)
    expect(
      computeTradeTotals({
        type: 'buy',
        quantity: '1',
        price: '2',
        currency: 'USD',
        fxRate: '',
      }).complete,
    ).toBe(false)
    expect(
      computeTradeTotals({
        type: 'buy',
        quantity: '1',
        price: '2',
        currency: 'USD',
        fxRate: '0',
      }).complete,
    ).toBe(false)
  })
})

describe('formatTradeBreakdown', () => {
  it('shows the full working for a foreign buy', () => {
    const t = computeTradeTotals({
      type: 'buy',
      quantity: '50',
      price: '78.99',
      currency: 'USD',
      fxRate: '1.4611',
      brokerage: '0',
    })
    expect(formatTradeBreakdown(t)).toBe(
      '50 × $78.99 USD × 1.4611 + $0.00 brokerage = $5,770.61 AUD',
    )
  })

  it('omits the fx factor for AUD and subtracts brokerage on a sell', () => {
    const t = computeTradeTotals({
      type: 'sell',
      quantity: '100',
      price: '12.5',
      currency: 'AUD',
      brokerage: '9.5',
    })
    expect(formatTradeBreakdown(t)).toBe(
      '100 × $12.5 AUD − $9.50 brokerage = $1,240.50 AUD',
    )
  })

  it('returns an empty string when the inputs are incomplete', () => {
    expect(formatTradeBreakdown(computeTradeTotals({ type: 'buy' }))).toBe('')
  })
})

describe('isoDateToLocalDate', () => {
  it('parses YYYY-MM-DD to local noon on the same calendar day', () => {
    const d = isoDateToLocalDate('2026-03-09')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(9)
    expect(d.getHours()).toBe(12)
  })

  it('rejects malformed and impossible dates', () => {
    expect(isoDateToLocalDate('')).toBeNull()
    expect(isoDateToLocalDate('09/03/2026')).toBeNull()
    expect(isoDateToLocalDate('2026-13-01')).toBeNull()
    expect(isoDateToLocalDate('2026-02-30')).toBeNull()
  })

  it('round-trips with localDateToIsoDate', () => {
    expect(localDateToIsoDate(isoDateToLocalDate('2025-12-31'))).toBe('2025-12-31')
  })
})

describe('todayInMelbourne', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayInMelbourne()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses the Melbourne calendar day, not the browser one', () => {
    // 2026-06-30T23:00Z is already 1 July in Melbourne (UTC+10).
    expect(todayInMelbourne(new Date('2026-06-30T23:00:00Z'))).toBe('2026-07-01')
  })
})

describe('currentFinancialYearMelbourne', () => {
  it('uses Melbourne time for the July boundary', () => {
    expect(currentFinancialYearMelbourne(new Date('2026-11-13T00:00:00Z'))).toBe(2027)
    expect(currentFinancialYearMelbourne(new Date('2026-06-15T00:00:00Z'))).toBe(2026)
    // 30 Jun 2026 15:00 UTC is already 1 Jul 01:00 in Melbourne (AEST, UTC+10)
    expect(currentFinancialYearMelbourne(new Date('2026-06-30T15:00:00Z'))).toBe(2027)
    expect(currentFinancialYearMelbourne(new Date('2026-06-30T13:00:00Z'))).toBe(2026)
  })
})

describe('financialYearForDate', () => {
  it('puts 1 July into the next FY and 30 June into the current one', () => {
    expect(financialYearForDate(new Date(2025, 6, 1))).toBe(2026)
    expect(financialYearForDate(new Date(2026, 5, 30))).toBe(2026)
  })
})

describe('defaultCurrencyForMarket', () => {
  it('defaults ASX to AUD and everything else to USD', () => {
    expect(defaultCurrencyForMarket('ASX')).toBe('AUD')
    expect(defaultCurrencyForMarket('NASDAQ')).toBe('USD')
    expect(defaultCurrencyForMarket('CRYPTO')).toBe('USD')
  })
})

function form(overrides) {
  return {
    type: 'buy',
    tradeDate: '2026-03-09',
    ticker: 'strc',
    market: 'NASDAQ',
    name: 'Strategy Inc.',
    quantity: '50',
    price: '78.99',
    currency: 'USD',
    brokerage: '0',
    fxRate: '1.4611',
    notes: '',
    ...overrides,
  }
}

describe('validateTrade', () => {
  it('accepts a complete trade and upper-cases the ticker', () => {
    const { errors, values } = validateTrade(form())
    expect(errors).toEqual({})
    expect(values.code).toBe('STRC')
    expect(values.totals.totalAud).toBeCloseTo(5770.61445, 6)
  })

  it('reports each missing or invalid field inline', () => {
    const { errors, values } = validateTrade(
      form({ ticker: '  ', quantity: '0', price: '-1', tradeDate: '' }),
    )
    expect(values).toBeNull()
    expect(errors.ticker).toBe('Ticker required')
    expect(errors.quantity).toBe('Quantity must be > 0')
    expect(errors.price).toBe('Price must be > 0')
    expect(errors.tradeDate).toBe('Date required')
  })

  it('requires a positive fx rate only for non-AUD trades', () => {
    expect(validateTrade(form({ fxRate: '' })).errors.fxRate).toBe(
      'FX rate required for non-AUD trades',
    )
    const audOnly = validateTrade(
      form({ market: 'ASX', currency: 'AUD', fxRate: '' }),
    )
    expect(audOnly.errors).toEqual({})
    expect(audOnly.values.fxRate).toBe(1)
  })

  it('treats blank brokerage as zero but rejects a negative one', () => {
    expect(validateTrade(form({ brokerage: '' })).values.brokerage).toBe(0)
    expect(validateTrade(form({ brokerage: '-5' })).errors.brokerage).toBe(
      'Brokerage must be >= 0',
    )
  })

  it('rejects a sell whose brokerage swallows the proceeds', () => {
    const { errors, values } = validateTrade(
      form({ type: 'sell', market: 'ASX', currency: 'AUD', quantity: '1', price: '10', brokerage: '20' }),
    )
    expect(values).toBeNull()
    expect(errors.brokerage).toBe('Brokerage exceeds sale proceeds')
  })
})

describe('buildManualTradeDoc', () => {
  it('writes a buy with the Sharesight field shape plus manual metadata', () => {
    const { values } = validateTrade(form({ notes: 'IG order X78PL' }))
    const d = buildManualTradeDoc(values)

    expect(d.kind).toBe('BUY')
    expect(d.sharesightType).toBe('buy')
    expect(d.ticker).toBe('STRC')
    expect(d.assetClass).toBe('NASDAQ')
    expect(d.totalCostAud).toBeCloseTo(5770.61445, 6)
    expect(d.netProceedsAud).toBeNull()
    expect(d.tradeDate).toBe('2026-03-09')
    expect(d.executedAt.toDate().getDate()).toBe(9)
    expect(d.sourceBroker).toBe('manual')
    expect(d.source).toBe('manual')
    expect(d.deleted).toBe(false)
    expect(d.notes).toBe('IG order X78PL')
    expect(d.rowIndex).toBeNull()
  })

  it('writes a sell into netProceedsAud, leaving totalCostAud null', () => {
    const { values } = validateTrade(form({ type: 'sell', brokerage: '10' }))
    const d = buildManualTradeDoc(values)
    expect(d.kind).toBe('SELL')
    expect(d.totalCostAud).toBeNull()
    expect(d.netProceedsAud).toBeCloseTo(5760.61445, 6)
  })

  it('applies the Yahoo suffix convention per market', () => {
    const asx = buildManualTradeDoc(
      validateTrade(form({ ticker: 'cba', market: 'ASX', currency: 'AUD' })).values,
    )
    expect(asx.ticker).toBe('CBA.AX')

    const crypto = buildManualTradeDoc(
      validateTrade(form({ ticker: 'btc', market: 'CRYPTO' })).values,
    )
    expect(crypto.ticker).toBe('BTC-USD')
    expect(crypto.assetClass).toBe('CRYPTO')

    const bit = buildManualTradeDoc(
      validateTrade(form({ ticker: 'race', market: 'BIT', currency: 'EUR' })).values,
    )
    expect(bit.ticker).toBe('RACE.MI')
    expect(bit.assetClass).toBe('ETF')
  })
})

describe('tradeDocToForm', () => {
  it('round-trips a saved manual trade back into editable form state', () => {
    const { values } = validateTrade(form({ notes: 'note' }))
    const saved = buildManualTradeDoc(values)
    const back = tradeDocToForm({
      ...saved,
      type: saved.sharesightType,
      pricePerUnit: saved.pricePerUnit,
    })

    expect(back.ticker).toBe('STRC')
    expect(back.market).toBe('NASDAQ')
    expect(back.currency).toBe('USD')
    expect(back.quantity).toBe('50')
    expect(back.price).toBe('78.99')
    expect(back.fxRate).toBe('1.4611')
    expect(back.notes).toBe('note')

    const { errors, values: revalidated } = validateTrade(back)
    expect(errors).toEqual({})
    expect(revalidated.totals.totalAud).toBeCloseTo(values.totals.totalAud, 8)
  })

  it('falls back to OTHER for a market the form does not offer', () => {
    expect(tradeDocToForm({ market: 'KLSE' }).market).toBe('OTHER')
  })
})

describe('market defaulting', () => {
  it('falls back to NASDAQ, not ASX, with a USD currency to match', () => {
    expect(FALLBACK_MARKET).toBe('NASDAQ')
    const f = emptyTradeForm('2026-09-25')
    expect(f.market).toBe('NASDAQ')
    expect(f.currency).toBe('USD')
  })

  it('keeps currency in step with an explicitly seeded market', () => {
    expect(emptyTradeForm('2026-09-25', 'ASX').currency).toBe('AUD')
    expect(emptyTradeForm('2026-09-25', 'CRYPTO').currency).toBe('USD')
  })

  it('ignores a market it does not offer', () => {
    expect(emptyTradeForm('2026-09-25', 'KLSE').market).toBe('NASDAQ')
  })

  it('round-trips the last-used market through localStorage', () => {
    const store = new Map()
    const original = globalThis.window
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
      },
    }

    try {
      expect(readLastMarket()).toBeNull()

      writeLastMarket('BIT')
      expect(readLastMarket()).toBe('BIT')
      expect(store.get(LAST_MARKET_KEY)).toBe('BIT')

      // A market outside the dropdown is neither stored nor returned.
      writeLastMarket('KLSE')
      expect(readLastMarket()).toBe('BIT')
    } finally {
      globalThis.window = original
    }
  })

  it('reports no stored market when storage is unavailable', () => {
    // `window` is undefined under the node test environment.
    expect(readLastMarket()).toBeNull()
    expect(() => writeLastMarket('ASX')).not.toThrow()
  })

  it('picks the latest manual trade, ignoring Sharesight rows', () => {
    const rows = [
      { sourceBroker: 'manual', market: 'ASX', date: new Date(2026, 0, 1) },
      { sourceBroker: 'manual', market: 'CRYPTO', date: new Date(2026, 5, 1) },
      { sourceBroker: 'sharesight', market: 'BIT', date: new Date(2026, 8, 1) },
    ]
    expect(mostRecentManualMarket(rows)).toBe('CRYPTO')
  })

  it('returns null when there are no usable manual rows', () => {
    expect(mostRecentManualMarket([])).toBeNull()
    expect(
      mostRecentManualMarket([
        { sourceBroker: 'sharesight', market: 'ASX', date: new Date() },
      ]),
    ).toBeNull()
  })
})

describe('warnIfClosedFinancialYear', () => {
  it('warns for a trade in an FY that has already ended', () => {
    const { values } = validateTrade(form({ tradeDate: '2024-03-01' }))
    expect(warnIfClosedFinancialYear(values, new Date(2026, 8, 24))).toBe(true)
  })

  it('stays quiet for a trade in the current FY', () => {
    const { values } = validateTrade(form({ tradeDate: '2026-08-01' }))
    expect(warnIfClosedFinancialYear(values, new Date(2026, 8, 24))).toBe(false)
  })
})
