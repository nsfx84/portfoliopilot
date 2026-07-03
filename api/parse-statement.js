import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getAuth } from 'firebase-admin/auth'
import Anthropic from '@anthropic-ai/sdk'

const MAX_STATEMENTS_PER_MONTH = 50
const BATCH_SIZE = 400

// claude-haiku-4-5 pricing: $0.80 / $4.00 per M tokens (input / output)
const COST_PER_M_INPUT = 0.80
const COST_PER_M_OUTPUT = 4.00

let _adminApp = null

function getAdminApp() {
  if (_adminApp) return _adminApp
  const existing = getApps()
  if (existing.length > 0) {
    _adminApp = existing[0]
    return _adminApp
  }
  const raw = process.env.FIREBASE_ADMIN_KEY || ''
  if (!raw) throw new Error('FIREBASE_ADMIN_KEY env var is not set')
  let sa
  try {
    sa = JSON.parse(raw)
  } catch {
    // Try base64-encoded fallback
    sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  }
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET || `${sa.project_id}.appspot.com`
  _adminApp = initializeApp({ credential: cert(sa), storageBucket })
  return _adminApp
}

function db() {
  return getFirestore(getAdminApp())
}

function storage() {
  return getStorage(getAdminApp())
}

function auth() {
  return getAuth(getAdminApp())
}

function currentYYYYMM() {
  return new Date().toISOString().slice(0, 7)
}

async function fetchMonthlyUsage(uid, yyyymm) {
  const snap = await db().doc(`users/${uid}/usage/${yyyymm}`).get()
  if (!snap.exists) return { statementsProcessed: 0, totalCostUsd: 0 }
  return snap.data()
}

function normaliseMerchant(raw) {
  if (!raw) return ''
  let s = raw.trim()
  s = s.replace(/\s+\d{4,}.*$/, '')
  s = s.replace(/\s+[A-Z]{2,3}$/, '').trim()
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

const CATEGORISATION_PROMPT = `You are a financial statement parser. Extract every transaction from this credit card or bank statement.

Return ONLY valid JSON in this exact schema, no markdown:
{
  "provider": "amex" | "cba" | "nab" | "westpac" | "bom" | "anz" | "other",
  "statementDate": "YYYY-MM-DD" or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "merchant": "raw merchant string as it appears",
      "amount": positive number for spend, negative for refund/credit,
      "category": one of: "Groceries", "Dining", "Utilities", "Subscriptions", "Insurance", "Childcare & Kids", "Travel", "Transport", "Home & Hardware", "Pharmacy & Health", "Clothing & Retail", "Entertainment", "Tax & Fees", "Education", "Other"
    }
  ]
}

Categorisation rules:
- Woolworths/Coles/Aldi/IGA/local fresh markets → Groceries
- Restaurants, cafes, takeaway, food delivery → Dining
- Electricity, water, gas, internet, mobile → Utilities
- Netflix, Spotify, streaming, software subs, gym memberships → Subscriptions
- AAMI, RACV, health cover → Insurance
- Childcare providers, school fees, kids' activities → Childcare & Kids
- Airlines, hotels, accommodations, overseas spend → Travel
- Fuel, tolls, parking, ride-share → Transport
- Bunnings, IKEA, hardware, home goods → Home & Hardware
- Chemist Warehouse, doctors, medical → Pharmacy & Health
- Clothing stores, retail non-grocery → Clothing & Retail
- Cinemas, games, hobbies, sports → Entertainment
- ATO, government fees, card annual fees → Tax & Fees
- Books, courses, educational materials → Education
- Everything else → Other

PDF text follows:
---
`

function jsonResponse(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST')
    return res.end()
  }

  // 1. Verify Firebase Auth token
  const authHeader = req.headers['authorization'] || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return jsonResponse(res, 401, { error: 'Missing Authorization: Bearer <token> header' })
  }

  let decoded
  try {
    decoded = await auth().verifyIdToken(idToken)
  } catch {
    return jsonResponse(res, 401, { error: 'Invalid or expired Firebase ID token' })
  }

  // 2. Parse body
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return jsonResponse(res, 400, { error: 'Invalid JSON body' })
  }

  const { uid, statementId, storagePath } = body ?? {}
  if (!uid || !statementId || !storagePath) {
    return jsonResponse(res, 400, { error: 'Missing required fields: uid, statementId, storagePath' })
  }

  // 3. Confirm uid matches token
  if (decoded.uid !== uid) {
    return jsonResponse(res, 403, { error: 'uid does not match authenticated user' })
  }

  const statementRef = db().doc(`users/${uid}/statements/${statementId}`)
  const yyyymm = currentYYYYMM()

  // 4. Enforce cost cap
  const usage = await fetchMonthlyUsage(uid, yyyymm)
  if (usage.statementsProcessed >= MAX_STATEMENTS_PER_MONTH) {
    return jsonResponse(res, 429, {
      error: `Monthly limit of ${MAX_STATEMENTS_PER_MONTH} statements reached`,
    })
  }

  await statementRef.update({ status: 'processing' })

  try {
    // 5. Download PDF from Firebase Storage
    const bucket = storage().bucket()
    const [pdfBuffer] = await bucket.file(storagePath).download()

    // 6. Extract text with pdf-parse
    let pdfText
    try {
      const { default: pdfParse } = await import('pdf-parse')
      const pdfData = await pdfParse(pdfBuffer)
      pdfText = pdfData.text?.trim() ?? ''
    } catch (err) {
      const msg = `PDF text extraction failed: ${err?.message ?? 'unknown error'}`
      await statementRef.update({ status: 'error', errorMessage: msg })
      return jsonResponse(res, 422, { error: msg })
    }

    if (!pdfText) {
      const msg = 'PDF contains no extractable text (may be a scanned image)'
      await statementRef.update({ status: 'error', errorMessage: msg })
      return jsonResponse(res, 422, { error: msg })
    }

    // 7. Send to Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${CATEGORISATION_PROMPT}${pdfText}\n---`,
        },
      ],
    })

    // 8. Parse Claude's JSON response
    const rawText = message.content?.[0]?.text ?? ''
    // Strip markdown fences if Claude added them despite instructions
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      const msg = 'Claude returned non-JSON response'
      await statementRef.update({ status: 'error', errorMessage: msg })
      return jsonResponse(res, 502, { error: msg })
    }

    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions : []

    // Calculate totals
    let totalDebits = 0
    let totalCredits = 0
    for (const tx of transactions) {
      const amt = Number(tx.amount) || 0
      if (amt > 0) totalDebits += amt
      else if (amt < 0) totalCredits += Math.abs(amt)
    }
    totalDebits = Math.round(totalDebits * 100) / 100
    totalCredits = Math.round(totalCredits * 100) / 100

    // Estimate Claude API cost
    const inputTokens = message.usage?.input_tokens ?? 0
    const outputTokens = message.usage?.output_tokens ?? 0
    const costUsd =
      Math.round(
        ((inputTokens * COST_PER_M_INPUT + outputTokens * COST_PER_M_OUTPUT) / 1_000_000) *
          10_000,
      ) / 10_000

    // 9. Batch-write transactions to spendingTransactions subcollection
    const txCol = db().collection(`users/${uid}/spendingTransactions`)
    const now = FieldValue.serverTimestamp()
    const provider = String(parsed.provider ?? 'unknown')

    const txDocs = transactions.map((tx) => ({
      date: String(tx.date ?? ''),
      merchant: String(tx.merchant ?? ''),
      merchantNormalised: normaliseMerchant(String(tx.merchant ?? '')),
      amount: Number(tx.amount) || 0,
      category: String(tx.category ?? 'Other'),
      source: { statementId, account: provider },
      createdAt: now,
      updatedAt: now,
      userCategorised: false,
    }))

    for (let i = 0; i < txDocs.length; i += BATCH_SIZE) {
      const chunk = txDocs.slice(i, i + BATCH_SIZE)
      const batch = db().batch()
      for (const txDoc of chunk) {
        batch.set(txCol.doc(), txDoc)
      }
      await batch.commit()
    }

    // 10. Update statement doc status
    await statementRef.update({
      status: 'parsed',
      provider,
      statementDate: parsed.statementDate ?? null,
      transactionCount: transactions.length,
      totalDebits,
      totalCredits,
      costUsd,
      errorMessage: null,
    })

    // 11. Increment usage counter (merge so it creates doc if absent)
    await db()
      .doc(`users/${uid}/usage/${yyyymm}`)
      .set(
        {
          month: yyyymm,
          statementsProcessed: FieldValue.increment(1),
          totalCostUsd: FieldValue.increment(costUsd),
        },
        { merge: true },
      )

    return jsonResponse(res, 200, {
      transactionCount: transactions.length,
      totalDebits,
      totalCredits,
      costUsd,
    })
  } catch (err) {
    console.error('[parse-statement]', err)
    const errorMessage = err?.message || 'Internal server error'
    try {
      await statementRef.update({ status: 'error', errorMessage })
    } catch {
      // best-effort — don't shadow the original error
    }
    return jsonResponse(res, 500, { error: errorMessage })
  }
}
