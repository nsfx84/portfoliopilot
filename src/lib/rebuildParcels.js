/**
 * Single source of truth for regenerating users/{uid}/parcels from the full
 * transaction ledger — imported and manual rows together.
 *
 * Called after every mutation that changes the ledger: Sharesight import,
 * manual trade add, edit and delete.
 */

import { collection, getDocs } from 'firebase/firestore'
import { db } from './firebase.js'
import { normalizeFirestoreTransaction, sortTransactionsForReplay } from './cgt.js'
import { buildParcelsFromTransactions } from './sharesightImporter.js'
import { replaceUserParcels } from './userData.js'

/**
 * Read every live transaction for a user, normalised and in replay order.
 * Soft-deleted rows are dropped by `normalizeFirestoreTransaction`.
 *
 * @param {string} uid
 * @returns {Promise<object[]>}
 */
export async function loadTransactionsForReplay(uid) {
  if (!db) throw new Error('Firestore is not configured.')
  if (!uid) throw new Error('Not signed in.')

  // `where('deleted', '!=', true)` would also exclude documents written before
  // the field existed, so the filter happens client-side in the normaliser.
  const snap = await getDocs(collection(db, 'users', uid, 'transactions'))
  const rows = []
  snap.forEach((d) => {
    const n = normalizeFirestoreTransaction(d)
    if (n) rows.push(n)
  })
  return sortTransactionsForReplay(rows)
}

/**
 * Rebuild and persist parcels for a user from their whole ledger.
 *
 * @param {string} uid
 * @returns {Promise<{ parcelCount: number, holdingCount: number, transactionCount: number, warnings: string[] }>}
 */
export async function rebuildParcelsForUser(uid) {
  const transactions = await loadTransactionsForReplay(uid)
  const { parcels, holdings, realisedEvents } =
    buildParcelsFromTransactions(transactions)

  await replaceUserParcels(uid, parcels)

  const warnings = (realisedEvents ?? [])
    .filter((e) => e.type === 'warning')
    .map((e) => e.message)

  return {
    parcelCount: parcels.length,
    holdingCount: holdings.length,
    transactionCount: transactions.length,
    warnings,
  }
}
