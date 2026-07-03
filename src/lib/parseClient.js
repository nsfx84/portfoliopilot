import { getAuth } from 'firebase/auth'

/**
 * Call /api/parse-statement after a PDF has been uploaded to Firebase Storage.
 *
 * @param {string} uid
 * @param {string} statementId
 * @param {string} storagePath
 * @returns {Promise<{ transactionCount: number, totalDebits: number, totalCredits: number, costUsd: number }>}
 */
export async function triggerParse(uid, statementId, storagePath) {
  const currentUser = getAuth().currentUser
  if (!currentUser) throw new Error('Not authenticated')

  const idToken = await currentUser.getIdToken()

  const res = await fetch('/api/parse-statement', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uid, statementId, storagePath }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Parse failed (HTTP ${res.status})`)
  }
  return data
}
