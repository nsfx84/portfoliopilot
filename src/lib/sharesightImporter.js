import * as XLSX from 'xlsx'

const COL = {
  code: 0,
  marketCode: 1,
  name: 2,
  date: 3,
  type: 4,
  qty: 5,
  price: 6,
  instrumentCurrency: 7,
  costBasePerShareAud: 8,
  brokerage: 9,
  brokerageCurrency: 10,
  exchRate: 11,
  value: 12,
}

/** @type {Record<string, string>} */
const MARKET_SUFFIX = {
  ASX: '.AX',
  BIT: '.MI',
  NASDAQ: '',
  NYSE: '',
  BATS: '',
  CRYPTO: '-USD',
  OTHER: '',
}

export function yahooTickerSuffix(marketCode) {
  const m = String(marketCode ?? '')
    .trim()
    .toUpperCase()
  return MARKET_SUFFIX[m] ?? ''
}

function buildYahooTicker(code, marketCode) {
  const c = String(code ?? '').trim()
  if (!c) return ''
  const m = String(marketCode ?? '')
    .trim()
    .toUpperCase()
  if (m === 'CRYPTO') return `${c}-USD`
  return c + yahooTickerSuffix(marketCode)
}

export function classifyAssetClass(marketCode) {
  const m = String(marketCode ?? '')
    .trim()
    .toUpperCase()
  if (m === 'ASX') return 'ASX'
  if (m === 'NASDAQ') return 'NASDAQ'
  if (m === 'NYSE') return 'NYSE'
  if (m === 'BATS' || m === 'BIT') return 'ETF'
  if (m === 'CRYPTO' || m === 'OTHER') return 'CRYPTO'
  return 'OTHER'
}

function quoteCurrencyFor(marketCode, instrumentCurrency) {
  const m = String(marketCode ?? '')
    .trim()
    .toUpperCase()
  if (m === 'ASX') return 'AUD'
  if (['NASDAQ', 'NYSE', 'BATS', 'BIT'].includes(m)) return 'USD'
  if (m === 'CRYPTO') return 'USD'
  const ic = String(instrumentCurrency ?? '')
    .trim()
    .toUpperCase()
  if (ic === 'AUD' || ic === 'USD' || ic === 'EUR') return ic
  return instrumentCurrency || 'USD'
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normaliseType(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
}

function startOfTomorrow(d = new Date()) {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  t.setDate(t.getDate() + 1)
  return t
}

function parseCodeCell(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return String(raw)
  return String(raw).trim()
}

/**
 * Parse Sharesight "All Trades Report" XLSX (Combined sheet).
 * Header row at index 2, first data row index 3 (0-based sheet rows).
 */
export function parseSharesightAllTradesReport(arrayBuffer) {
  const warnings = []
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets.Combined
  if (!sheet) {
    return {
      transactions: [],
      warnings: ['Missing "Combined" sheet in workbook.'],
    }
  }

  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
  const raw = []

  for (let r = 3; r < grid.length; r++) {
    const row = grid[r]
    if (!row) continue
    const code = parseCodeCell(row[COL.code])
    if (code === null || code === '') break
    if (code.toLowerCase() === 'total') break

    const d =
      row[COL.date] instanceof Date
        ? row[COL.date]
        : row[COL.date]
          ? new Date(row[COL.date])
          : null
    if (!d || Number.isNaN(d.getTime())) {
      warnings.push(`Row ${r + 1}: invalid date, skipped.`)
      continue
    }

    if (d >= startOfTomorrow()) {
      continue
    }

    const marketCode = String(row[COL.marketCode] ?? '').trim()
    const name = String(row[COL.name] ?? '').trim()
    const typeRaw = normaliseType(row[COL.type])
    const qtyN = num(row[COL.qty])
    const cbpsAud = num(row[COL.costBasePerShareAud])
    const valueN = num(row[COL.value])

    const ticker = buildYahooTicker(code, marketCode)
    const assetClass = classifyAssetClass(marketCode)
    const quoteCurrency = quoteCurrencyFor(marketCode, row[COL.instrumentCurrency])

    let tx

    if (typeRaw === 'buy') {
      if (qtyN === null || qtyN === 0) {
        warnings.push(`Row ${r + 1}: Buy with invalid quantity, skipped.`)
        continue
      }
      tx = {
        type: 'buy',
        date: d,
        ticker,
        market: marketCode,
        code,
        name,
        assetClass,
        quoteCurrency,
        quantity: Math.abs(qtyN),
        totalCostAud: Math.abs(valueN ?? 0),
        rawType: String(row[COL.type] ?? '').trim(),
        _rowIndex: r,
      }
    } else if (typeRaw === 'opening balance') {
      if (qtyN === null || qtyN === 0) {
        warnings.push(`Row ${r + 1}: Opening balance with invalid quantity, skipped.`)
        continue
      }
      let totalCostAud = Math.abs(valueN ?? 0)
      if (cbpsAud !== null && cbpsAud !== 0) {
        totalCostAud = Math.abs(cbpsAud * Math.abs(qtyN))
      }
      tx = {
        type: 'buy',
        subtype: 'opening_balance',
        date: d,
        ticker,
        market: marketCode,
        code,
        name,
        assetClass,
        quoteCurrency,
        quantity: Math.abs(qtyN),
        totalCostAud,
        rawType: String(row[COL.type] ?? '').trim(),
        _rowIndex: r,
      }
    } else if (typeRaw === 'sell') {
      if (qtyN === null || qtyN === 0) {
        warnings.push(`Row ${r + 1}: Sell with invalid quantity, skipped.`)
        continue
      }
      tx = {
        type: 'sell',
        date: d,
        ticker,
        market: marketCode,
        code,
        name,
        assetClass,
        quoteCurrency,
        quantity: Math.abs(qtyN),
        netProceedsAud: Math.abs(valueN ?? 0),
        rawType: String(row[COL.type] ?? '').trim(),
        _rowIndex: r,
      }
    } else if (typeRaw === 'split') {
      if (qtyN === null) {
        warnings.push(`Row ${r + 1}: Split with invalid qty, skipped.`)
        continue
      }
      tx = {
        type: 'split',
        date: d,
        ticker,
        market: marketCode,
        code,
        name,
        assetClass,
        quoteCurrency,
        quantityDelta: qtyN,
        rawType: String(row[COL.type] ?? '').trim(),
        _rowIndex: r,
      }
    } else if (typeRaw === 'consolidation') {
      if (qtyN === null) {
        warnings.push(`Row ${r + 1}: Consolidation with invalid qty, skipped.`)
        continue
      }
      tx = {
        type: 'consolidation',
        date: d,
        ticker,
        market: marketCode,
        code,
        name,
        assetClass,
        quoteCurrency,
        quantityDelta: qtyN,
        rawType: String(row[COL.type] ?? '').trim(),
        _rowIndex: r,
      }
    } else if (typeRaw === 'return of capital' || typeRaw.includes('return of capital')) {
      tx = {
        type: 'return_of_capital',
        date: d,
        ticker,
        market: marketCode,
        code,
        name,
        assetClass,
        quoteCurrency,
        amountAud: Math.abs(valueN ?? 0),
        rawType: String(row[COL.type] ?? '').trim(),
        _rowIndex: r,
      }
    } else {
      warnings.push(`Row ${r + 1}: Unsupported type "${row[COL.type]}", skipped.`)
      continue
    }

    if (tx) raw.push(tx)
  }

  raw.sort((a, b) => {
    const ad = a.date.getTime()
    const bd = b.date.getTime()
    if (ad !== bd) return ad - bd
    return a._rowIndex - b._rowIndex
  })

  return { transactions: raw, warnings }
}

/**
 * Rebuild open parcels from chronological normalised transactions (FIFO sells).
 * @param {object[]} txs Normalised transactions from parseSharesightAllTradesReport (sorted).
 */
export function buildParcelsFromTransactions(txs) {
  /** @type {Map<string, ParcelState[]>} */
  const byTicker = new Map()
  /** @type {object[]} */
  const realisedEvents = []

  /**
   * @typedef {object} ParcelState
   * @property {string} id
   * @property {string} ticker
   * @property {string} market
   * @property {string} name
   * @property {string} assetClass
   * @property {string} quoteCurrency
   * @property {number} remainingQuantity
   * @property {number} originalQuantity
   * @property {number} totalCostAud
   * @property {Date} acquiredDate
   */

  function parcelsFor(ticker) {
    if (!byTicker.has(ticker)) byTicker.set(ticker, [])
    return byTicker.get(ticker)
  }

  for (const tx of txs) {
    const t = tx.ticker
    if (!t) continue

    if (tx.type === 'buy') {
      const qty = tx.quantity
      const cost = tx.totalCostAud
      parcelsFor(t).push({
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `p-${t}-${Date.now()}-${Math.random()}`,
        ticker: tx.ticker,
        market: tx.market,
        name: tx.name,
        assetClass: tx.assetClass,
        quoteCurrency: tx.quoteCurrency,
        remainingQuantity: qty,
        originalQuantity: qty,
        totalCostAud: cost,
        acquiredDate: new Date(tx.date),
      })
      continue
    }

    if (tx.type === 'sell') {
      let need = tx.quantity
      const list = parcelsFor(t)
        .slice()
        .sort((a, b) => a.acquiredDate.getTime() - b.acquiredDate.getTime())
      const costParts = []

      for (const p of list) {
        if (need <= 0) break
        if (p.remainingQuantity <= 0) continue
        const take = Math.min(p.remainingQuantity, need)
        const costRemoved =
          p.remainingQuantity > 0
            ? (take / p.remainingQuantity) * p.totalCostAud
            : 0
        p.remainingQuantity -= take
        p.totalCostAud -= costRemoved
        need -= take
        costParts.push({ parcelId: p.id, quantity: take, costBasisAud: costRemoved })
      }

      if (need > 1e-8) {
        realisedEvents.push({
          type: 'warning',
          message: `Sell on ${tx.date.toISOString()} for ${t}: short by ${need} units (insufficient parcels).`,
          ticker: t,
          date: tx.date,
        })
      }

      realisedEvents.push({
        type: 'sell',
        ticker: t,
        date: tx.date,
        quantity: tx.quantity - Math.max(0, need),
        netProceedsAud: tx.netProceedsAud,
        fifoLots: costParts,
      })
      continue
    }

    if (tx.type === 'split' || tx.type === 'consolidation') {
      const plist = parcelsFor(t).filter((p) => p.remainingQuantity > 1e-12)
      const totalOpen = plist.reduce((s, p) => s + p.remainingQuantity, 0)
      const delta = tx.quantityDelta
      if (totalOpen <= 0 || delta === undefined) continue
      const factor = (totalOpen + delta) / totalOpen
      if (!Number.isFinite(factor) || factor < 0) continue

      for (const p of parcelsFor(t)) {
        if (p.remainingQuantity <= 0) continue
        p.remainingQuantity *= factor
        p.originalQuantity *= factor
      }
      continue
    }

    if (tx.type === 'return_of_capital') {
      const plist = parcelsFor(t).filter((p) => p.remainingQuantity > 1e-12)
      const totalRem = plist.reduce((s, p) => s + p.remainingQuantity, 0)
      const amt = tx.amountAud
      if (totalRem <= 0 || amt === undefined) continue

      for (const p of parcelsFor(t)) {
        if (p.remainingQuantity <= 0) continue
        const share = p.remainingQuantity / totalRem
        p.totalCostAud -= amt * share
        if (p.totalCostAud < 0) p.totalCostAud = 0
      }
      realisedEvents.push({
        type: 'return_of_capital',
        ticker: t,
        date: tx.date,
        amountAud: amt,
      })
    }
  }

  /** @type {ParcelState[]} */
  const parcels = []
  for (const [, plist] of byTicker) {
    for (const p of plist) {
      if (p.remainingQuantity > 0.0000001) {
        parcels.push(p)
      }
    }
  }

  /** @type {Map<string, { ticker: string, market: string, name: string, assetClass: string, quoteCurrency: string, totalQuantity: number, totalCostAud: number, avgCostAud: number }>} */
  const holdMap = new Map()
  for (const p of parcels) {
    if (!holdMap.has(p.ticker)) {
      holdMap.set(p.ticker, {
        ticker: p.ticker,
        market: p.market,
        name: p.name,
        assetClass: p.assetClass,
        quoteCurrency: p.quoteCurrency,
        totalQuantity: 0,
        totalCostAud: 0,
        avgCostAud: 0,
      })
    }
    const h = holdMap.get(p.ticker)
    h.totalQuantity += p.remainingQuantity
    h.totalCostAud += p.totalCostAud
  }
  const holdings = []
  for (const h of holdMap.values()) {
    h.avgCostAud =
      h.totalQuantity > 0 ? h.totalCostAud / h.totalQuantity : 0
    holdings.push(h)
  }
  holdings.sort((a, b) => a.ticker.localeCompare(b.ticker))

  return { parcels, holdings, realisedEvents }
}
