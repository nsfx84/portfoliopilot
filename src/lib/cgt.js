/**
 * Australian CGT-style calculations for individuals (50% discount when held > 365 days).
 * Pure functions — no Firebase or UI. Amounts in AUD; precision preserved until display rounding.
 */

export const CGT_MATCHING_METHODS = Object.freeze(['FIFO', 'LIFO', 'MIN_GAIN'])

const EPS = 1e-9

/** @typedef {'FIFO' | 'LIFO' | 'MIN_GAIN'} CgtMethod */

/**
 * FY number `fy` is the calendar year of 30 June end date: e.g. fy=2026 → 1 Jul 2025–30 Jun 2026.
 */
export function getFinancialYearBounds(fy) {
  const endYear = fy
  const startYear = fy - 1
  const fyStart = new Date(startYear, 6, 1, 0, 0, 0, 0)
  const fyEnd = new Date(endYear, 5, 30, 23, 59, 59, 999)
  return { fyStart, fyEnd }
}

export function isDateInRange(d, start, end) {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

function daysHeldBetween(acquired, sold) {
  const a = acquired instanceof Date ? acquired : new Date(acquired)
  const s = sold instanceof Date ? sold : new Date(sold)
  return Math.floor((s.getTime() - a.getTime()) / 86400000)
}

function makeKey(ticker, market) {
  return `${String(ticker || '')}|||${String(market || '')}`
}

function newParcelId(ticker) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `p-${ticker}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * @param {unknown} m
 * @returns {CgtMethod}
 */
export function normalizeCgtMethod(m) {
  const s = String(m ?? 'FIFO')
    .replace(/[\s-]/g, '')
    .toUpperCase()
  if (s === 'FIFO') return 'FIFO'
  if (s === 'LIFO') return 'LIFO'
  if (s === 'MINGAIN' || s === 'MIN_GAIN' || s === 'MING' || s === 'MG') return 'MIN_GAIN'
  return 'FIFO'
}

/**
 * Normalise a Firestore transaction document into engine input.
 * @param {{ id: string, data?: () => object } | { id?: string } & object} doc
 */
export function normalizeFirestoreTransaction(doc) {
  const raw =
    doc && typeof doc.data === 'function' ? { id: doc.id, ...doc.data() } : { ...doc }
  const id = raw.id ?? doc?.id ?? ''
  const date =
    raw.executedAt && typeof raw.executedAt.toDate === 'function'
      ? raw.executedAt.toDate()
      : new Date(raw.executedAt ?? 0)
  const kind = String(raw.kind ?? '').toUpperCase()
  const st = String(raw.sharesightType ?? '').toLowerCase()
  const ticker = raw.ticker != null ? String(raw.ticker) : ''
  const market = raw.market != null ? String(raw.market) : ''
  const rowIndex =
    raw.rowIndex != null && Number.isFinite(Number(raw.rowIndex))
      ? Number(raw.rowIndex)
      : 0

  const q = Number(raw.quantity)
  const qtyDelta = raw.quantityDelta != null ? Number(raw.quantityDelta) : undefined
  const totalCostAud =
    raw.totalCostAud != null ? Number(raw.totalCostAud) : undefined
  const netProceedsAud =
    raw.netProceedsAud != null ? Number(raw.netProceedsAud) : undefined
  const amountAud = raw.amountAud != null ? Number(raw.amountAud) : undefined

  if (!ticker || !Number.isFinite(date.getTime())) return null

  if (kind === 'BUY' || st === 'buy') {
    if (!(q > 0) || totalCostAud == null || !Number.isFinite(totalCostAud)) return null
    return {
      id,
      type: 'buy',
      date,
      ticker,
      market,
      name: raw.name ?? null,
      assetClass: raw.assetClass ?? null,
      quoteCurrency: raw.quoteCurrency ?? null,
      quantity: q,
      totalCostAud,
      rowIndex,
    }
  }
  if (kind === 'SELL' || st === 'sell') {
    if (!(q > 0)) return null
    return {
      id,
      type: 'sell',
      date,
      ticker,
      market,
      name: raw.name ?? null,
      assetClass: raw.assetClass ?? null,
      quoteCurrency: raw.quoteCurrency ?? null,
      quantity: q,
      netProceedsAud: Number.isFinite(netProceedsAud) ? netProceedsAud : 0,
      rowIndex,
    }
  }
  if (st === 'split' || st === 'consolidation') {
    if (qtyDelta == null || !Number.isFinite(qtyDelta)) return null
    return {
      id,
      type: st === 'consolidation' ? 'consolidation' : 'split',
      date,
      ticker,
      market,
      quantityDelta: qtyDelta,
      rowIndex,
    }
  }
  if (st === 'return_of_capital') {
    if (amountAud == null || !Number.isFinite(amountAud)) return null
    return {
      id,
      type: 'return_of_capital',
      date,
      ticker,
      market,
      amountAud,
      rowIndex,
    }
  }
  return null
}

/**
 * @param {object[]} transactions Normalised tx objects (see normalizeFirestoreTransaction).
 */
export function sortTransactionsForReplay(transactions) {
  const copy = transactions.filter(Boolean)
  copy.sort((a, b) => {
    const ta = a.date?.getTime?.() ?? 0
    const tb = b.date?.getTime?.() ?? 0
    if (ta !== tb) return ta - tb
    const ra = a.rowIndex ?? 0
    const rb = b.rowIndex ?? 0
    if (ra !== rb) return ra - rb
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
  return copy
}

/**
 * @param {object[]} parcelsArray
 * @param {string} ticker
 * @param {string} market
 */
function filterParcelsForTickerMarket(parcelsArray, ticker, market) {
  const m = String(market ?? '')
  return parcelsArray
    .filter(
      (p) =>
        String(p.ticker) === String(ticker) && String(p.market ?? '') === m,
    )
    .map((p) => ({
      id: p.id,
      ticker: p.ticker,
      market: p.market ?? '',
      name: p.name ?? null,
      assetClass: p.assetClass ?? null,
      quoteCurrency: p.quoteCurrency ?? null,
      remainingQuantity: Number(p.remainingQuantity),
      originalQuantity: Number(p.originalQuantity ?? p.remainingQuantity),
      totalCostAud: Number(p.totalCostAud),
      acquiredDate:
        p.acquiredDate instanceof Date
          ? p.acquiredDate
          : p.acquiredAt?.toDate?.() ?? new Date(p.acquiredDate ?? 0),
    }))
    .filter((p) => p.remainingQuantity > EPS && p.totalCostAud >= -EPS)
}

/**
 * Order open parcels for a disposal (does not mutate input arrays).
 * @param {{ remainingQuantity: number, totalCostAud: number, acquiredDate: Date }[]} open
 */
export function orderParcelsForMethod(open, method, sellQuantity, sellProceeds, sellDate) {
  const m = normalizeCgtMethod(method)
  const q = sellQuantity
  const sp = sellProceeds
  const candidates = open.filter((p) => p.remainingQuantity > EPS)

  if (m === 'FIFO') {
    return [...candidates].sort(
      (a, b) => a.acquiredDate.getTime() - b.acquiredDate.getTime(),
    )
  }
  if (m === 'LIFO') {
    return [...candidates].sort(
      (a, b) => b.acquiredDate.getTime() - a.acquiredDate.getTime(),
    )
  }

  const pPerUnit = q > EPS ? sp / q : 0
  const ranked = candidates.map((p) => {
    const u = p.remainingQuantity > EPS ? p.totalCostAud / p.remainingQuantity : 0
    const margin = pPerUnit - u
    const dh = daysHeldBetween(p.acquiredDate, sellDate)
    const eligible = dh > 365
    let tier
    if (margin < -EPS) tier = 0
    else if (eligible) tier = 1
    else tier = 2
    return { p, margin, tier, dh, u }
  })
  ranked.sort((A, B) => {
    if (A.tier !== B.tier) return A.tier - B.tier
    return A.margin - B.margin
  })
  return ranked.map((r) => r.p)
}

function applySplitConsolidation(parcelList, quantityDelta) {
  const open = parcelList.filter((p) => p.remainingQuantity > EPS)
  const totalOpen = open.reduce((s, p) => s + p.remainingQuantity, 0)
  if (totalOpen <= EPS || quantityDelta == null || !Number.isFinite(quantityDelta))
    return
  const factor = (totalOpen + quantityDelta) / totalOpen
  if (!Number.isFinite(factor) || factor < 0) return
  for (const p of parcelList) {
    if (p.remainingQuantity <= EPS) continue
    p.remainingQuantity *= factor
    p.originalQuantity *= factor
  }
}

function applyReturnOfCapital(parcelList, amountAud) {
  const open = parcelList.filter((p) => p.remainingQuantity > EPS)
  const totalRem = open.reduce((s, p) => s + p.remainingQuantity, 0)
  if (totalRem <= EPS || !Number.isFinite(amountAud)) return
  for (const p of parcelList) {
    if (p.remainingQuantity <= EPS) continue
    const share = p.remainingQuantity / totalRem
    p.totalCostAud -= amountAud * share
    if (p.totalCostAud < 0) p.totalCostAud = 0
  }
}

/**
 * Allocate a sell to parcels; mutates parcel objects in `parcelLists` for `key`.
 */
function executeSell(parcelLists, key, tx, method) {
  const qty = tx.quantity
  const proceeds = Number.isFinite(tx.netProceedsAud) ? tx.netProceedsAud : 0
  const date = tx.date
  if (!parcelLists.has(key)) parcelLists.set(key, [])
  const list = parcelLists.get(key)

  const open = list.filter((p) => p.remainingQuantity > EPS)
  const ordered = orderParcelsForMethod(open, method, qty, proceeds, date)

  let need = qty
  /** @type {object[]} */
  const matches = []

  for (const p of ordered) {
    if (need <= EPS) break
    if (p.remainingQuantity <= EPS) continue
    const take = Math.min(p.remainingQuantity, need)
    const costRemoved =
      p.remainingQuantity > EPS ? (take / p.remainingQuantity) * p.totalCostAud : 0
    const proceedsPart = qty > EPS ? (take / qty) * proceeds : 0
    const days = daysHeldBetween(p.acquiredDate, date)
    const discountEligible = days > 365
    const gain = proceedsPart - costRemoved
    const prePoolTaxableWeight =
      gain > EPS ? (discountEligible ? gain * 0.5 : gain) : gain

    matches.push({
      parcelId: p.id,
      quantity: take,
      costBaseProRata: costRemoved,
      proceedsProRata: proceedsPart,
      gain,
      daysHeld: days,
      discountEligible,
      prePoolTaxableWeight,
      acquiredDate: new Date(p.acquiredDate),
    })

    p.remainingQuantity -= take
    p.totalCostAud -= costRemoved
    need -= take
  }

  const shortfall = need > EPS ? need : 0
  return { matches, shortfall }
}

function ensureParcelList(parcelLists, key) {
  if (!parcelLists.has(key)) parcelLists.set(key, [])
  return parcelLists.get(key)
}

function addBuy(parcelLists, tx) {
  const key = makeKey(tx.ticker, tx.market)
  const list = ensureParcelList(parcelLists, key)
  list.push({
    id: newParcelId(tx.ticker),
    ticker: tx.ticker,
    market: tx.market ?? '',
    name: tx.name,
    assetClass: tx.assetClass,
    quoteCurrency: tx.quoteCurrency,
    remainingQuantity: tx.quantity,
    originalQuantity: tx.quantity,
    totalCostAud: tx.totalCostAud,
    acquiredDate: new Date(tx.date),
  })
}

/**
 * Core CGT calculation for one financial year. Parcel state is replayed from
 * `transactions` from the first transaction using `method` for every disposal (ATO lot tracking).
 *
 * @param {object[]} transactions
 * @param {unknown} _parcels Ignored — engine rebuilds from transactions (API compatibility).
 * @param {number} fy
 * @param {string} method
 * @param {number} priorYearLosses Carried-forward capital losses (positive number).
 */
export function calculateCgtForFY(transactions, _parcels, fy, method, priorYearLosses) {
  const m = normalizeCgtMethod(method)
  const sorted = sortTransactionsForReplay(transactions)
  const { fyStart, fyEnd } = getFinancialYearBounds(fy)

  /** @type {Map<string, object[]>} */
  const parcelLists = new Map()

  /** @type {object[]} */
  const sales = []

  for (const tx of sorted) {
    const key = makeKey(tx.ticker, tx.market)

    if (tx.type === 'buy') {
      addBuy(parcelLists, tx)
      continue
    }

    if (tx.type === 'sell') {
      const { matches, shortfall } = executeSell(parcelLists, key, tx, m)
      if (isDateInRange(tx.date, fyStart, fyEnd)) {
        sales.push({
          id: tx.id,
          date: new Date(tx.date),
          ticker: tx.ticker,
          market: tx.market ?? '',
          assetClass: tx.assetClass ?? 'OTHER',
          quantitySold: tx.quantity,
          netProceedsAud: Number.isFinite(tx.netProceedsAud) ? tx.netProceedsAud : 0,
          matches,
          shortfall,
        })
      }
      continue
    }

    const list = ensureParcelList(parcelLists, key)
    if (tx.type === 'split' || tx.type === 'consolidation') {
      applySplitConsolidation(list, tx.quantityDelta)
      continue
    }
    if (tx.type === 'return_of_capital') {
      applyReturnOfCapital(list, tx.amountAud)
    }
  }

  /** @type {{ gain: number, discountEligible: boolean }[]} */
  const allMatches = []
  for (const s of sales) {
    for (const mm of s.matches) allMatches.push(mm)
  }

  let grossGains = 0
  let grossLosses = 0
  let nonDiscountGain = 0
  let discountEligibleGain = 0

  for (const mm of allMatches) {
    const g = mm.gain
    if (g > EPS) {
      grossGains += g
      if (mm.discountEligible) discountEligibleGain += g
      else nonDiscountGain += g
    } else if (g < -EPS) {
      grossLosses += -g
    }
  }

  const netCurrentYearGain = grossGains - grossLosses

  let nd = nonDiscountGain
  let d = discountEligibleGain
  let sameYearLossPool = grossLosses

  const t1 = Math.min(sameYearLossPool, nd)
  nd -= t1
  sameYearLossPool -= t1
  const t2 = Math.min(sameYearLossPool, d)
  d -= t2

  const prior = Math.max(0, Number(priorYearLosses) || 0)
  const pTakeNd = Math.min(prior, nd)
  nd -= pTakeNd
  const priorRem = prior - pTakeNd
  const pTakeD = Math.min(priorRem, d)
  d -= pTakeD

  const priorYearLossesApplied = pTakeNd + pTakeD
  const taxableCapitalGain = nd + 0.5 * d
  const discountSaved = 0.5 * d

  const lossCarryForward = Math.max(0, prior - netCurrentYearGain)

  return {
    fy,
    method: m,
    sales,
    grossGains,
    grossLosses,
    netCurrentYearGain,
    discountEligibleGain,
    nonDiscountGain,
    discountEligibleGainAfterLosses: d,
    nonDiscountGainAfterLosses: nd,
    discountSaved,
    priorYearLossesApplied,
    taxableCapitalGain,
    lossCarryForward,
    fyStart,
    fyEnd,
  }
}

/**
 * @param {object[]} transactions
 * @param {unknown} parcels
 * @param {number} fy
 * @param {number} priorYearLosses
 */
export function calculateAllMethodsComparison(transactions, parcels, fy, priorYearLosses) {
  return {
    FIFO: calculateCgtForFY(transactions, parcels, fy, 'FIFO', priorYearLosses),
    LIFO: calculateCgtForFY(transactions, parcels, fy, 'LIFO', priorYearLosses),
    minGain: calculateCgtForFY(transactions, parcels, fy, 'MIN_GAIN', priorYearLosses),
  }
}

/**
 * Hypothetical disposal of `quantity` at `salePrice` AUD per unit on `saleDate`.
 *
 * @param {object[]} parcels Current open lots (see filter shape).
 * @param {string} ticker
 * @param {string} market
 * @param {number} quantity Units sold.
 * @param {number} salePrice AUD per unit.
 * @param {Date|string} saleDate
 * @param {string} method
 */
export function previewSale(
  parcels,
  ticker,
  market,
  quantity,
  salePrice,
  saleDate,
  method,
) {
  const m = normalizeCgtMethod(method)
  const lots = filterParcelsForTickerMarket(Array.isArray(parcels) ? parcels : [], ticker, market)
  const cloned = lots.map((p) => ({
    ...p,
    remainingQuantity: p.remainingQuantity,
    totalCostAud: p.totalCostAud,
    acquiredDate: new Date(p.acquiredDate),
  }))

  const key = makeKey(ticker, market)
  const map = new Map([[key, cloned]])
  const q = Number(quantity)
  const price = Number(salePrice)
  const proceeds = Number.isFinite(q) && Number.isFinite(price) ? q * price : 0
  const dt = saleDate instanceof Date ? saleDate : new Date(saleDate)

  const tx = {
    id: 'preview',
    type: 'sell',
    date: dt,
    ticker,
    market: market ?? '',
    quantity: q,
    netProceedsAud: proceeds,
    rowIndex: 0,
  }

  const { matches, shortfall } = executeSell(map, key, tx, m)

  let grossGains = 0
  let grossLosses = 0
  let nonDiscountGain = 0
  let discountEligibleGain = 0
  for (const mm of matches) {
    const g = mm.gain
    if (g > EPS) {
      grossGains += g
      if (mm.discountEligible) discountEligibleGain += g
      else nonDiscountGain += g
    } else if (g < -EPS) {
      grossLosses += -g
    }
  }

  let nd = nonDiscountGain
  let d = discountEligibleGain
  let sameYearLossPool = grossLosses
  const t1 = Math.min(sameYearLossPool, nd)
  nd -= t1
  sameYearLossPool -= t1
  const t2 = Math.min(sameYearLossPool, d)
  d -= t2

  const taxableCapitalGainPreview = nd + 0.5 * d
  const discountSavedPreview = 0.5 * d
  const netCurrentYearGainPreview = grossGains - grossLosses

  return {
    matches,
    shortfall,
    grossProceeds: proceeds,
    netCurrentYearGainPreview,
    taxableCapitalGainPreview,
    discountSavedPreview,
    saleDate: dt,
    method: m,
  }
}

/**
 * Firestore parcel doc → engine lot (for preview).
 */
export function firestoreParcelToCgtParcel(doc) {
  const isFs = doc && typeof doc.data === 'function'
  const id = isFs ? doc.id : doc?.id ?? ''
  const x = isFs ? doc.data() : doc
  const acquired =
    x.acquiredAt && typeof x.acquiredAt.toDate === 'function'
      ? x.acquiredAt.toDate()
      : x.acquiredAt instanceof Date
        ? x.acquiredAt
        : new Date(x.acquiredAt ?? x.acquiredDate ?? 0)
  const rq = Number(x.remainingQuantity)
  const tc =
    x.totalCostAud != null
      ? Number(x.totalCostAud)
      : Number(x.unitCostAud ?? 0) * rq
  return {
    id,
    ticker: String(x.ticker ?? ''),
    market: String(x.market ?? ''),
    name: x.name ?? null,
    assetClass: x.assetClass ?? null,
    quoteCurrency: x.quoteCurrency ?? null,
    remainingQuantity: rq,
    originalQuantity: Number(x.originalQuantity ?? rq),
    totalCostAud: Number.isFinite(tc) ? tc : 0,
    acquiredDate: acquired,
  }
}
