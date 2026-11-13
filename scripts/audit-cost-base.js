#!/usr/bin/env node
/**
 * READ-ONLY cost-base audit for a single ticker.
 *
 * Writes nothing. Every Firestore call is a read; there is no set/update/delete
 * anywhere in this file.
 *
 * It deliberately drives the REAL engine (src/lib/cgt.js and
 * src/lib/sharesightImporter.js) rather than reimplementing FIFO, so the output
 * reflects what the app actually computes — a second implementation would only
 * prove it agrees with itself.
 *
 * Usage:
 *   node scripts/audit-cost-base.js --uid=UID --ticker=NVDA
 *   node scripts/audit-cost-base.js --uid=UID --ticker=NVDA --cutoff=2026-02-02 --fy=2026
 *   node scripts/audit-cost-base.js --uid=UID --ticker=NVDA --method=MIN_GAIN
 *
 * Credentials, in order of preference:
 *   1. FIREBASE_ADMIN_KEY  — service-account JSON (one line) in .env.local
 *   2. PORTFOLIOPILOT_EMAIL + PORTFOLIOPILOT_PASSWORD — app login, in .env.local
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calculateCgtForFY,
  getFinancialYearBounds,
  normalizeCgtMethod,
  normalizeFirestoreTransaction,
  sortTransactionsForReplay,
} from '../src/lib/cgt.js'
import { buildParcelsFromTransactions } from '../src/lib/sharesightImporter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const aud = (n) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-AU', {
        style: 'currency',
        currency: 'AUD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

const qty = (n) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-AU', { maximumFractionDigits: 8 })

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : '—')

function loadEnvLocal() {
  const path = resolve(ROOT, '.env.local')
  if (!existsSync(path)) return {}
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function parseArgs(argv) {
  const out = {
    uid: '',
    ticker: '',
    cutoff: '',
    fy: 0,
    method: 'FIFO',
  }
  for (const arg of argv) {
    const [k, v] = arg.startsWith('--') ? arg.slice(2).split('=') : ['', '']
    if (k === 'uid') out.uid = v
    else if (k === 'ticker') out.ticker = String(v || '').toUpperCase()
    else if (k === 'cutoff') out.cutoff = v
    else if (k === 'fy') out.fy = Number(v)
    else if (k === 'method') out.method = v
    else if (k === 'help' || k === 'h') {
      console.log(readFileSync(new URL(import.meta.url)).toString().slice(0, 1200))
      process.exit(0)
    }
  }
  return out
}

/** Service-account JSON, or null when the env var is missing/placeholder. */
function parseAdminKey(raw) {
  if (!raw || !raw.trim().startsWith('{')) return null
  let sa
  try {
    sa = JSON.parse(raw)
  } catch {
    return null
  }
  if (!sa.private_key || !sa.client_email || !sa.project_id) return null
  return sa
}

/**
 * @returns {Promise<{ readCollection: (path: string[]) => Promise<Array<{id: string, data: object}>>, label: string, close: () => Promise<void> }>}
 */
async function connect(env) {
  const sa = parseAdminKey(env.FIREBASE_ADMIN_KEY || process.env.FIREBASE_ADMIN_KEY)

  if (sa) {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app')
    const { getFirestore } = await import('firebase-admin/firestore')
    if (getApps().length === 0) initializeApp({ credential: cert(sa) })
    const db = getFirestore()
    return {
      label: `admin SDK (service account ${sa.client_email})`,
      readCollection: async (path) => {
        let ref = db.collection(path[0])
        for (let i = 1; i < path.length; i += 2) {
          ref = ref.doc(path[i]).collection(path[i + 1])
        }
        const snap = await ref.get()
        return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
      },
      close: async () => {},
    }
  }

  const email = env.PORTFOLIOPILOT_EMAIL || process.env.PORTFOLIOPILOT_EMAIL
  const password = env.PORTFOLIOPILOT_PASSWORD || process.env.PORTFOLIOPILOT_PASSWORD
  if (!email || !password) {
    throw new Error(
      'No usable Firestore credential.\n\n' +
        'Set ONE of the following in .env.local, then re-run:\n' +
        '  FIREBASE_ADMIN_KEY={"type":"service_account",...}   (one line, from\n' +
        '    Firebase console > Project settings > Service accounts > Generate new key)\n' +
        '  PORTFOLIOPILOT_EMAIL=you@example.com\n' +
        '  PORTFOLIOPILOT_PASSWORD=your-password\n\n' +
        'Note: FIREBASE_ADMIN_KEY is currently the literal placeholder text, so\n' +
        '/api/parse-statement cannot be working locally either.',
    )
  }

  const { initializeApp } = await import('firebase/app')
  const { getAuth, signInWithEmailAndPassword, signOut } = await import('firebase/auth')
  const { collection, getDocs, getFirestore } = await import('firebase/firestore')

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  })
  const auth = getAuth(app)
  const cred = await signInWithEmailAndPassword(auth, email, password)
  const db = getFirestore(app)

  return {
    label: `client SDK (signed in as ${cred.user.email}, uid ${cred.user.uid})`,
    uid: cred.user.uid,
    readCollection: async (path) => {
      const snap = await getDocs(collection(db, ...path))
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
    },
    close: async () => signOut(auth),
  }
}

function toDate(v) {
  if (!v) return null
  if (typeof v.toDate === 'function') return v.toDate()
  if (v instanceof Date) return v
  if (v._seconds != null) return new Date(v._seconds * 1000)
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function rule(char = '-') {
  return char.repeat(100)
}

function section(title) {
  console.log(`\n${rule('=')}\n${title}\n${rule('=')}`)
}

async function main() {
  const env = { ...loadEnvLocal() }
  const args = parseArgs(process.argv.slice(2))

  if (!args.ticker) {
    console.error('Missing --ticker=NVDA')
    process.exit(1)
  }

  const conn = await connect(env)
  const uid = args.uid || conn.uid || env.PORTFOLIOPILOT_UID
  if (!uid) {
    console.error('Missing --uid=... (and the credential did not imply one)')
    await conn.close()
    process.exit(1)
  }

  console.log(`PortfolioPilot cost-base audit  —  READ ONLY (writes nothing)`)
  console.log(`Connected via ${conn.label}`)
  console.log(`uid=${uid}  ticker=${args.ticker}  method=${normalizeCgtMethod(args.method)}`)

  const txDocs = await conn.readCollection(['users', uid, 'transactions'])
  const parcelDocs = await conn.readCollection(['users', uid, 'parcels'])

  // ---- 1. Raw transactions for this ticker -------------------------------
  const mine = txDocs
    .filter((d) => String(d.data.ticker ?? '').toUpperCase() === args.ticker)
    .map((d) => ({ id: d.id, ...d.data, _date: toDate(d.data.executedAt) }))
    .sort((a, b) => (a._date?.getTime() ?? 0) - (b._date?.getTime() ?? 0))

  section(`1. ALL ${args.ticker} TRANSACTIONS IN FIRESTORE (${mine.length} docs)`)
  if (mine.length === 0) {
    console.log('None found. Check the ticker spelling — parcels use the Yahoo')
    console.log('symbol convention (CBA.AX, AAPL, BTC-USD).')
  } else {
    console.log(
      ['DATE'.padEnd(11), 'TYPE'.padEnd(17), 'MKT'.padEnd(7), 'QTY'.padStart(12),
       'PRICE'.padStart(11), 'CCY'.padEnd(5), 'FX'.padStart(9),
       'TOTAL AUD'.padStart(14), 'SOURCE'.padEnd(11), 'DEL'].join(' '),
    )
    console.log(rule())
    for (const t of mine) {
      const total =
        t.totalCostAud ?? t.netProceedsAud ?? t.amountAud ?? null
      console.log(
        [
          iso(t._date).padEnd(11),
          `${t.sharesightType ?? '?'}${t.subtype ? `/${t.subtype}` : ''}`.padEnd(17),
          String(t.market ?? '').padEnd(7),
          qty(t.quantity ?? t.quantityDelta).padStart(12),
          (t.pricePerUnit != null ? String(t.pricePerUnit) : '—').padStart(11),
          String(t.priceCurrency ?? t.quoteCurrency ?? '').padEnd(5),
          (t.fxRate != null ? String(t.fxRate) : '—').padStart(9),
          aud(total).padStart(14),
          String(t.sourceBroker ?? t.source ?? '').padEnd(11),
          t.deleted === true ? 'YES' : '',
        ].join(' '),
      )
      if (t.notes) console.log(`            notes: ${t.notes}`)
    }
  }

  // ---- 2. Ticker/market key consistency ----------------------------------
  // buildParcelsFromTransactions keys parcels by ticker ALONE, while the CGT
  // engine keys by ticker+market. Mixed market codes make the two disagree.
  const markets = new Map()
  for (const t of mine) {
    if (t.deleted === true) continue
    const m = String(t.market ?? '')
    markets.set(m, (markets.get(m) ?? 0) + 1)
  }
  section('2. TICKER / MARKET KEY CONSISTENCY')
  console.log('Parcels are keyed by ticker alone; the CGT engine keys by ticker+market.')
  console.log('More than one market code below means the two WILL disagree.\n')
  for (const [m, n] of markets) {
    console.log(`  market="${m}"  ${n} transaction(s)`)
  }
  console.log(
    markets.size > 1
      ? '\n  *** MISMATCH: multiple market codes for one ticker. This splits the\n' +
        '      CGT pool while leaving the parcel pool merged. ***'
      : '\n  OK — single market code.',
  )

  // ---- 3. Replay ---------------------------------------------------------
  const allNormalised = sortTransactionsForReplay(
    txDocs
      .map((d) => normalizeFirestoreTransaction({ id: d.id, ...d.data }))
      .filter(Boolean),
  )
  const forTicker = allNormalised.filter((t) => t.ticker === args.ticker)

  const cutoff = args.cutoff ? new Date(`${args.cutoff}T23:59:59`) : null
  const upToCutoff = cutoff
    ? forTicker.filter((t) => t.date <= cutoff)
    : forTicker

  section(
    `3. PARCEL STATE${args.cutoff ? ` AS AT ${args.cutoff}` : ' (all transactions)'}`,
  )
  const replayed = buildParcelsFromTransactions(upToCutoff)
  if (replayed.parcels.length === 0) {
    console.log('No open parcels.')
  } else {
    console.log(
      ['ACQUIRED'.padEnd(11), 'REMAINING'.padStart(14), 'COST BASE AUD'.padStart(16),
       'PER SHARE'.padStart(13)].join(' '),
    )
    console.log(rule())
    let totQ = 0
    let totC = 0
    for (const p of [...replayed.parcels].sort(
      (a, b) => a.acquiredDate - b.acquiredDate,
    )) {
      totQ += p.remainingQuantity
      totC += p.totalCostAud
      console.log(
        [
          iso(p.acquiredDate).padEnd(11),
          qty(p.remainingQuantity).padStart(14),
          aud(p.totalCostAud).padStart(16),
          aud(p.totalCostAud / p.remainingQuantity).padStart(13),
        ].join(' '),
      )
    }
    console.log(rule())
    console.log(
      ['TOTAL'.padEnd(11), qty(totQ).padStart(14), aud(totC).padStart(16),
       aud(totQ > 0 ? totC / totQ : 0).padStart(13)].join(' '),
    )
  }
  for (const w of replayed.realisedEvents.filter((e) => e.type === 'warning')) {
    console.log(`  WARNING: ${w.message}`)
  }

  // ---- 4. Stored parcels vs replay --------------------------------------
  const stored = parcelDocs
    .filter((d) => String(d.data.ticker ?? '').toUpperCase() === args.ticker)
    .map((d) => ({
      remainingQuantity: Number(d.data.remainingQuantity),
      totalCostAud:
        d.data.totalCostAud != null
          ? Number(d.data.totalCostAud)
          : Number(d.data.unitCostAud) * Number(d.data.remainingQuantity),
      acquiredAt: toDate(d.data.acquiredAt),
    }))

  section('4. STORED parcels COLLECTION vs FRESH REPLAY (all transactions)')
  const freshAll = buildParcelsFromTransactions(forTicker)
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)
  const sQ = sum(stored, (p) => p.remainingQuantity)
  const sC = sum(stored, (p) => p.totalCostAud)
  const fQ = sum(freshAll.parcels, (p) => p.remainingQuantity)
  const fC = sum(freshAll.parcels, (p) => p.totalCostAud)

  console.log(`  stored : ${qty(sQ).padStart(14)} units   ${aud(sC).padStart(16)}  (${stored.length} parcels)`)
  console.log(`  replay : ${qty(fQ).padStart(14)} units   ${aud(fC).padStart(16)}  (${freshAll.parcels.length} parcels)`)
  const drift = Math.abs(sQ - fQ) > 1e-6 || Math.abs(sC - fC) > 0.01
  console.log(
    drift
      ? '\n  *** DRIFT: the stored parcels are stale. Re-run a rebuild. ***'
      : '\n  OK — stored parcels match a fresh replay.',
  )

  // ---- 5. FIFO allocation for disposals in the FY -----------------------
  const method = normalizeCgtMethod(args.method)
  const fy =
    args.fy ||
    (() => {
      const lastSell = [...forTicker].reverse().find((t) => t.type === 'sell')
      if (!lastSell) return 0
      return lastSell.date.getMonth() >= 6
        ? lastSell.date.getFullYear() + 1
        : lastSell.date.getFullYear()
    })()

  if (!fy) {
    section('5. DISPOSALS')
    console.log('No sells found for this ticker.')
  } else {
    const { fyStart, fyEnd } = getFinancialYearBounds(fy)
    section(
      `5. DISPOSAL MATCHING — FY${fy} (${iso(fyStart)} to ${iso(fyEnd)}), method ${method}`,
    )
    // Run the engine over the WHOLE ledger (parcel state depends on every
    // ticker's history being replayed the same way the app does it).
    const result = calculateCgtForFY(allNormalised, null, fy, method, 0)
    const sales = result.sales.filter((s) => s.ticker === args.ticker)

    if (sales.length === 0) {
      console.log(`No ${args.ticker} disposals in FY${fy}.`)
    }
    for (const s of sales) {
      console.log(`\nSALE ${iso(s.date)}  ${qty(s.quantitySold)} units  proceeds ${aud(s.netProceedsAud)}`)
      console.log(rule())
      console.log(
        ['  ACQUIRED'.padEnd(13), 'QTY'.padStart(12), 'COST BASE'.padStart(14),
         'PROCEEDS'.padStart(14), 'GAIN'.padStart(14), 'DAYS'.padStart(7), 'DISC'].join(' '),
      )
      let cb = 0
      for (const m of s.matches) {
        cb += m.costBaseProRata
        console.log(
          [
            `  ${iso(m.acquiredDate)}`.padEnd(13),
            qty(m.quantity).padStart(12),
            aud(m.costBaseProRata).padStart(14),
            aud(m.proceedsProRata).padStart(14),
            aud(m.gain).padStart(14),
            String(m.daysHeld).padStart(7),
            m.discountEligible ? 'yes' : 'no',
          ].join(' '),
        )
      }
      console.log(rule())
      console.log(`  TOTAL COST BASE FOR THIS SALE: ${aud(cb)}`)
      console.log(`  parcels drained: ${s.matches.length}`)
      if (s.shortfall > 1e-8) {
        console.log(
          `  *** SHORTFALL ${qty(s.shortfall)} units had NO parcel to match.\n` +
            '      Those units contribute ZERO cost base, inflating the gain. ***',
        )
      }
    }

    console.log(`\nFY${fy} totals (all tickers, method ${method}):`)
    console.log(`  gross gains      ${aud(result.grossGains)}`)
    console.log(`  gross losses     ${aud(result.grossLosses)}`)
    console.log(`  taxable gain     ${aud(result.taxableCapitalGain)}`)
  }

  await conn.close()
  console.log('\nAudit complete. Nothing was written.')
}

main().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
