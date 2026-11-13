import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

const CHUNK = 400

async function batchDeleteRefs(refs) {
  let batch = writeBatch(db)
  let n = 0
  const commits = []
  for (const ref of refs) {
    batch.delete(ref)
    n++
    if (n >= CHUNK) {
      commits.push(batch.commit())
      batch = writeBatch(db)
      n = 0
    }
  }
  if (n > 0) commits.push(batch.commit())
  await Promise.all(commits)
}

async function batchDeleteQuery(collRef) {
  const snap = await getDocs(collRef)
  await batchDeleteRefs(snap.docs.map((d) => d.ref))
}

function isManualDoc(data) {
  return (
    String(data?.sourceBroker ?? data?.source ?? '').toLowerCase() === 'manual'
  )
}

/**
 * Replace every Sharesight-imported transaction for a user, leaving manually
 * entered trades untouched. Parcels are not touched here — call
 * `rebuildParcelsForUser` afterwards so parcels reflect the merged ledger.
 *
 * @param {string} uid
 * @param {object[]} transactions Normalised rows from parseSharesightAllTradesReport.
 */
export async function replaceSharesightTransactions(uid, transactions) {
  if (!db) throw new Error('Firestore is not configured.')

  const txColl = collection(db, 'users', uid, 'transactions')

  const existing = await getDocs(txColl)
  const stale = existing.docs
    .filter((d) => !isManualDoc(d.data()))
    .map((d) => d.ref)
  await batchDeleteRefs(stale)

  let batch = writeBatch(db)
  let ops = 0
  const commits = []

  for (const tx of transactions) {
    const ref = doc(txColl)
    const kind =
      tx.type === 'buy'
        ? 'BUY'
        : tx.type === 'sell'
          ? 'SELL'
          : 'OTHER'

    batch.set(ref, {
      kind,
      sharesightType: tx.type,
      ticker: tx.ticker ?? null,
      market: tx.market ?? null,
      name: tx.name ?? null,
      assetClass: tx.assetClass ?? null,
      quoteCurrency: tx.quoteCurrency ?? null,
      quantity: tx.quantity ?? null,
      quantityDelta: tx.quantityDelta ?? null,
      totalCostAud: tx.totalCostAud ?? null,
      netProceedsAud: tx.netProceedsAud ?? null,
      amountAud: tx.amountAud ?? null,
      subtype: tx.subtype ?? null,
      rowIndex: tx._rowIndex ?? null,
      rawType: tx.rawType ?? null,
      executedAt: Timestamp.fromDate(tx.date),
      source: 'sharesight',
      sourceBroker: 'sharesight',
      deleted: false,
      createdAt: serverTimestamp(),
    })
    ops++
    if (ops >= CHUNK) {
      commits.push(batch.commit())
      batch = writeBatch(db)
      ops = 0
    }
  }

  if (ops > 0) commits.push(batch.commit())
  await Promise.all(commits)
}

/**
 * Wipe users/{uid}/parcels and write the supplied parcel states.
 *
 * @param {string} uid
 * @param {object[]} parcelStates Output of buildParcelsFromTransactions().parcels.
 * @returns {Promise<number>} number of parcels written
 */
export async function replaceUserParcels(uid, parcelStates) {
  if (!db) throw new Error('Firestore is not configured.')

  const pColl = collection(db, 'users', uid, 'parcels')
  await batchDeleteQuery(pColl)

  let batch = writeBatch(db)
  let ops = 0
  const commits = []

  for (const p of parcelStates) {
    const ref = doc(pColl)
    const unitCostAud =
      p.remainingQuantity > 0 ? p.totalCostAud / p.remainingQuantity : 0
    batch.set(ref, {
      ticker: p.ticker,
      market: p.market ?? null,
      name: p.name ?? null,
      assetClass: p.assetClass ?? null,
      quoteCurrency: p.quoteCurrency ?? null,
      remainingQuantity: p.remainingQuantity,
      originalQuantity: p.originalQuantity,
      unitCostAud,
      totalCostAud: p.totalCostAud,
      acquiredAt: Timestamp.fromDate(new Date(p.acquiredDate)),
      localId: p.id,
      source: 'derived',
      createdAt: serverTimestamp(),
    })
    ops++
    if (ops >= CHUNK) {
      commits.push(batch.commit())
      batch = writeBatch(db)
      ops = 0
    }
  }

  if (ops > 0) commits.push(batch.commit())
  await Promise.all(commits)

  return parcelStates.length
}
