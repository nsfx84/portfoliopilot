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

async function batchDeleteQuery(collRef) {
  const snap = await getDocs(collRef)
  let batch = writeBatch(db)
  let n = 0
  const commits = []
  for (const d of snap.docs) {
    batch.delete(d.ref)
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

/**
 * Replace all documents in users/{uid}/transactions and users/{uid}/parcels.
 */
export async function replaceUserTransactionsAndParcels(uid, transactions, parcelStates) {
  if (!db) throw new Error('Firestore is not configured.')

  const txColl = collection(db, 'users', uid, 'transactions')
  const pColl = collection(db, 'users', uid, 'parcels')

  await batchDeleteQuery(txColl)
  await batchDeleteQuery(pColl)

  let batch = writeBatch(db)
  let ops = 0
  const commits = []

  const pushCommit = () => {
    commits.push(batch.commit())
    batch = writeBatch(db)
    ops = 0
  }

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
      createdAt: serverTimestamp(),
    })
    ops++
    if (ops >= CHUNK) pushCommit()
  }

  for (const p of parcelStates) {
    const ref = doc(pColl)
    const unitCostAud =
      p.remainingQuantity > 0 ? p.totalCostAud / p.remainingQuantity : 0
    batch.set(ref, {
      ticker: p.ticker,
      market: p.market,
      name: p.name,
      assetClass: p.assetClass,
      quoteCurrency: p.quoteCurrency,
      remainingQuantity: p.remainingQuantity,
      originalQuantity: p.originalQuantity,
      unitCostAud,
      totalCostAud: p.totalCostAud,
      acquiredAt: Timestamp.fromDate(p.acquiredDate),
      localId: p.id,
      source: 'sharesight',
      createdAt: serverTimestamp(),
    })
    ops++
    if (ops >= CHUNK) pushCommit()
  }

  if (ops > 0) commits.push(batch.commit())
  await Promise.all(commits)
}
