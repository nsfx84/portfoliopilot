import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import {
  COLLECTIONS,
  DEFAULT_MONTHLY_USAGE,
  STATEMENT_PROVIDERS,
} from '../data/schemas.js'
import { db, storage } from './firebase.js'

const MAX_PDF_BYTES = 10 * 1024 * 1024
const BATCH_LIMIT = 400

function assertDb() {
  if (!db) throw new Error('Firestore is not configured.')
}

function assertStorage() {
  if (!storage) throw new Error('Firebase Storage is not configured.')
}

function statementsCollection(uid) {
  return collection(db, 'users', uid, COLLECTIONS.statements)
}

function spendingTransactionsCollection(uid) {
  return collection(db, 'users', uid, COLLECTIONS.spendingTransactions)
}

/**
 * @param {string} filename
 */
export function sanitizeStatementFilename(filename) {
  const base = String(filename ?? 'statement.pdf').split(/[/\\]/).pop() ?? 'statement.pdf'
  const cleaned = base.replace(/[^\w.\-() ]+/g, '_').trim()
  return cleaned || 'statement.pdf'
}

/**
 * @param {string} uid
 * @param {string} statementId
 * @param {string} filename
 */
export function buildStatementStoragePath(uid, statementId, filename) {
  return `users/${uid}/statements/${statementId}/${sanitizeStatementFilename(filename)}`
}

/**
 * @param {Array<Record<string, unknown>>} transactions
 * @param {{ startDate?: string, endDate?: string, categories?: string[], merchant?: string }} [filters]
 */
export function filterSpendingTransactions(transactions, filters = {}) {
  const { startDate, endDate, categories, merchant } = filters
  const merchantQuery = merchant?.trim().toLowerCase()

  return transactions.filter((tx) => {
    const date = String(tx.date ?? '')
    if (startDate && date < startDate) return false
    if (endDate && date > endDate) return false
    if (categories?.length && !categories.includes(tx.category)) return false
    if (merchantQuery) {
      const haystack = `${tx.merchant ?? ''} ${tx.merchantNormalised ?? ''}`.toLowerCase()
      if (!haystack.includes(merchantQuery)) return false
    }
    return true
  })
}

/**
 * @param {Array<{ amount?: number }>} transactions
 */
export function aggregateSpendingTotals(transactions) {
  let totalDebits = 0
  let totalCredits = 0

  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0
    if (amount > 0) totalDebits += amount
    else if (amount < 0) totalCredits += Math.abs(amount)
  }

  return {
    transactionCount: transactions.length,
    totalDebits,
    totalCredits,
  }
}

/**
 * @param {Array<Record<string, unknown>>} transactions
 * @param {{ startDate?: string, endDate?: string, categories?: string[], merchant?: string }} [filters]
 */
export function summarizeSpendingTransactions(transactions, filters = {}) {
  const filtered = filterSpendingTransactions(transactions, filters)
  return {
    transactions: filtered,
    ...aggregateSpendingTotals(filtered),
  }
}

/**
 * @param {string} yyyymm — e.g. "2026-06"
 */
export function defaultMonthlyUsage(yyyymm) {
  return { ...DEFAULT_MONTHLY_USAGE, month: yyyymm }
}

/**
 * @param {File} file
 */
export function validateStatementPdf(file) {
  if (!file) throw new Error('No file provided.')
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('Only PDF statements are supported.')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error('PDF must be 10 MB or smaller.')
  }
}

function buildPendingStatementDoc(filename, storagePath) {
  return {
    filename: sanitizeStatementFilename(filename),
    uploadedAt: serverTimestamp(),
    storagePath,
    status: 'pending',
    provider: STATEMENT_PROVIDERS.unknown,
    transactionCount: 0,
    totalDebits: 0,
    totalCredits: 0,
    costUsd: 0,
  }
}

/**
 * Upload a PDF to Storage and create a pending statement document.
 *
 * @param {string} uid
 * @param {File} file
 * @returns {Promise<{ statementId: string, storagePath: string }>}
 */
export async function uploadStatement(uid, file) {
  assertDb()
  assertStorage()
  validateStatementPdf(file)

  const statementRef = doc(statementsCollection(uid))
  const statementId = statementRef.id
  const storagePath = buildStatementStoragePath(uid, statementId, file.name)

  await uploadBytes(ref(storage, storagePath), file, {
    contentType: 'application/pdf',
  })

  await setDoc(statementRef, buildPendingStatementDoc(file.name, storagePath))

  return { statementId, storagePath }
}

/**
 * @param {string} uid
 */
export async function listStatements(uid) {
  assertDb()
  const snap = await getDocs(statementsCollection(uid))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aMs = a.uploadedAt?.toMillis?.() ?? 0
      const bMs = b.uploadedAt?.toMillis?.() ?? 0
      return bMs - aMs
    })
}

/**
 * Delete a statement, its Storage object, and linked spending transactions.
 *
 * @param {string} uid
 * @param {string} statementId
 */
export async function deleteStatement(uid, statementId) {
  assertDb()
  assertStorage()

  const statementRef = doc(db, 'users', uid, COLLECTIONS.statements, statementId)
  const statementSnap = await getDoc(statementRef)
  if (!statementSnap.exists()) return

  const { storagePath } = statementSnap.data()
  if (storagePath) {
    try {
      await deleteObject(ref(storage, storagePath))
    } catch (err) {
      if (err?.code !== 'storage/object-not-found') throw err
    }
  }

  const linkedSnap = await getDocs(
    query(
      spendingTransactionsCollection(uid),
      where('source.statementId', '==', statementId),
    ),
  )

  let batch = writeBatch(db)
  let ops = 0
  const commits = []

  for (const txDoc of linkedSnap.docs) {
    batch.delete(txDoc.ref)
    ops++
    if (ops >= BATCH_LIMIT) {
      commits.push(batch.commit())
      batch = writeBatch(db)
      ops = 0
    }
  }

  batch.delete(statementRef)
  ops++
  if (ops > 0) commits.push(batch.commit())
  await Promise.all(commits)
}

/**
 * @param {string} uid
 * @param {{ startDate?: string, endDate?: string, categories?: string[], merchant?: string }} [filters]
 */
export async function listTransactions(uid, filters = {}) {
  assertDb()
  const snap = await getDocs(spendingTransactionsCollection(uid))
  const transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return filterSpendingTransactions(transactions, filters)
}

/**
 * @param {string} uid
 * @param {string} transactionId
 * @param {string} newCategory
 */
export async function updateTransactionCategory(uid, transactionId, newCategory) {
  assertDb()
  const txRef = doc(db, 'users', uid, COLLECTIONS.spendingTransactions, transactionId)
  await updateDoc(txRef, {
    category: newCategory,
    userCategorised: true,
    updatedAt: serverTimestamp(),
  })
}

/**
 * @param {string} uid
 * @param {string} yyyymm — e.g. "2026-06"
 */
export async function getMonthlyUsage(uid, yyyymm) {
  assertDb()
  const usageRef = doc(db, 'users', uid, COLLECTIONS.usage, yyyymm)
  const snap = await getDoc(usageRef)
  if (!snap.exists()) return defaultMonthlyUsage(yyyymm)
  return { id: snap.id, ...snap.data() }
}
