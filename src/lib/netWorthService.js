import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { COLLECTIONS } from '../data/schemas.js'
import { db } from '../lib/firebase.js'
import { getTotalValueByCategory } from './portfolioService.js'

/** @param {number[]} values */
export function sumAud(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0)
}

/**
 * @param {Array<{ currentValueAUD?: number }>} properties
 * @param {Array<{ currency?: string, balanceAUD?: number }>} cashAccounts
 * @param {Array<{ assetClass?: string, marketValueAud?: number }>} holdings
 */
export function computeFXExposure(properties, cashAccounts, holdings) {
  let aud = 0
  let myr = 0
  let crypto = 0

  for (const property of properties) {
    aud += Number(property.currentValueAUD) || 0
  }

  for (const account of cashAccounts) {
    const balance = Number(account.balanceAUD) || 0
    if (account.currency === 'MYR') myr += balance
    else aud += balance
  }

  for (const holding of holdings) {
    const value = Number(holding.marketValueAud) || 0
    if (String(holding.assetClass || '').toUpperCase() === 'CRYPTO') {
      crypto += value
    } else {
      aud += value
    }
  }

  return { aud, myr, crypto }
}

/**
 * @param {Array<{ country?: string, currentValueAUD?: number }>} properties
 * @param {Array<{ currency?: string, balanceAUD?: number }>} cashAccounts
 * @param {Array<{ marketValueAud?: number }>} holdings
 */
export function computeGeographicSplit(properties, cashAccounts, holdings) {
  let au = 0
  let my = 0
  let borderless = 0

  for (const property of properties) {
    const value = Number(property.currentValueAUD) || 0
    if (property.country === 'MY') my += value
    else au += value
  }

  for (const account of cashAccounts) {
    const balance = Number(account.balanceAUD) || 0
    if (account.currency === 'MYR') my += balance
    else au += balance
  }

  for (const holding of holdings) {
    borderless += Number(holding.marketValueAud) || 0
  }

  return { au, my, borderless }
}

/**
 * Pure aggregation used by getNetWorthSummary and unit tests.
 *
 * @param {{
 *   stocks: number,
 *   etfs: number,
 *   crypto: number,
 *   super: number,
 *   holdings?: Array<{ assetClass?: string, quoteCurrency?: string, marketValueAud?: number }>,
 * }} portfolio
 * @param {Array<{ country?: string, currentValueAUD?: number }>} properties
 * @param {Array<{ currency?: string, balanceAUD?: number }>} cashAccounts
 * @param {Array<{ balanceAUD?: number }>} liabilities
 */
export function aggregateNetWorthSummary(
  portfolio,
  properties,
  cashAccounts,
  liabilities,
) {
  const property = sumAud(properties.map((p) => p.currentValueAUD))
  const cash = sumAud(cashAccounts.map((c) => c.balanceAUD))
  const stocks = (Number(portfolio.stocks) || 0) + (Number(portfolio.etfs) || 0)
  const crypto = Number(portfolio.crypto) || 0
  const superBalance = Number(portfolio.super) || 0
  const totalAssets = property + cash + stocks + crypto + superBalance
  const totalLiabilities = sumAud(liabilities.map((l) => l.balanceAUD))
  const holdings = portfolio.holdings ?? []

  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    liquid: cash + stocks + crypto,
    breakdown: {
      property,
      cash,
      stocks,
      crypto,
      super: superBalance,
    },
    fxExposure: computeFXExposure(properties, cashAccounts, holdings),
    geographic: computeGeographicSplit(properties, cashAccounts, holdings),
  }
}

function assertDb() {
  if (!db) throw new Error('Firestore is not configured.')
}

function userCollection(uid, name) {
  return collection(db, 'users', uid, name)
}

async function listCollection(uid, name) {
  assertDb()
  const snap = await getDocs(userCollection(uid, name))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

async function getDocument(uid, name, id) {
  assertDb()
  const ref = doc(db, 'users', uid, name, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

async function createDocument(uid, name, data) {
  assertDb()
  const ref = doc(userCollection(uid, name))
  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await setDoc(ref, payload)
  return ref.id
}

async function updateDocument(uid, name, id, data) {
  assertDb()
  const ref = doc(db, 'users', uid, name, id)
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

async function removeDocument(uid, name, id) {
  assertDb()
  await deleteDoc(doc(db, 'users', uid, name, id))
}

// --- Properties ---

export function listProperties(uid) {
  return listCollection(uid, COLLECTIONS.properties)
}

export function getProperty(uid, propertyId) {
  return getDocument(uid, COLLECTIONS.properties, propertyId)
}

export function createProperty(uid, data) {
  return createDocument(uid, COLLECTIONS.properties, data)
}

export function updateProperty(uid, propertyId, data) {
  return updateDocument(uid, COLLECTIONS.properties, propertyId, data)
}

export function deleteProperty(uid, propertyId) {
  return removeDocument(uid, COLLECTIONS.properties, propertyId)
}

// --- Cash accounts ---

export function listCashAccounts(uid) {
  return listCollection(uid, COLLECTIONS.cashAccounts)
}

export function getCashAccount(uid, accountId) {
  return getDocument(uid, COLLECTIONS.cashAccounts, accountId)
}

export function createCashAccount(uid, data) {
  return createDocument(uid, COLLECTIONS.cashAccounts, data)
}

export function updateCashAccount(uid, accountId, data) {
  return updateDocument(uid, COLLECTIONS.cashAccounts, accountId, data)
}

export function deleteCashAccount(uid, accountId) {
  return removeDocument(uid, COLLECTIONS.cashAccounts, accountId)
}

// --- Liabilities ---

export function listLiabilities(uid) {
  return listCollection(uid, COLLECTIONS.liabilities)
}

export function getLiability(uid, liabilityId) {
  return getDocument(uid, COLLECTIONS.liabilities, liabilityId)
}

export function createLiability(uid, data) {
  return createDocument(uid, COLLECTIONS.liabilities, data)
}

export function updateLiability(uid, liabilityId, data) {
  return updateDocument(uid, COLLECTIONS.liabilities, liabilityId, data)
}

export function deleteLiability(uid, liabilityId) {
  return removeDocument(uid, COLLECTIONS.liabilities, liabilityId)
}

// --- Summary ---

export async function getNetWorthSummary(uid) {
  const [portfolio, properties, cashAccounts, liabilities] = await Promise.all([
    getTotalValueByCategory(uid),
    listProperties(uid),
    listCashAccounts(uid),
    listLiabilities(uid),
  ])

  return aggregateNetWorthSummary(
    portfolio,
    properties,
    cashAccounts,
    liabilities,
  )
}
