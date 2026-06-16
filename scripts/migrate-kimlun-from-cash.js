#!/usr/bin/env node
/**
 * Lists cash accounts that look like the old Kimlun / MY-stocks workaround.
 * Does NOT delete or create records — prints migration steps only.
 *
 * Usage:
 *   node scripts/migrate-kimlun-from-cash.js
 *   node scripts/migrate-kimlun-from-cash.js --uid YOUR_FIREBASE_UID
 *
 * Requires `.env.local` with VITE_FIREBASE_* keys. For Firestore access, also set:
 *   PORTFOLIOPILOT_EMAIL=you@example.com
 *   PORTFOLIOPILOT_PASSWORD=your-app-password
 *
 * Or pass PORTFOLIOPILOT_UID in the environment / --uid flag together with credentials.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, getDocs, getFirestore } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadEnvLocal() {
  const path = resolve(ROOT, '.env.local')
  if (!existsSync(path)) return {}
  /** @type {Record<string, string>} */
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
  let uid = process.env.PORTFOLIOPILOT_UID || ''
  for (const arg of argv) {
    if (arg.startsWith('--uid=')) uid = arg.slice('--uid='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/migrate-kimlun-from-cash.js [--uid=UID]`)
      process.exit(0)
    }
  }
  return { uid }
}

function matchesKimlunWorkaround(name) {
  const n = String(name || '').toLowerCase()
  return n.includes('kimlun') || n.includes('my stocks')
}

function printMigrationGuide(matches) {
  console.log('\n--- Kimlun / MY stocks cash → parcel migration ---\n')

  if (matches.length === 0) {
    console.log('No matching cash accounts found.')
    console.log(
      'If you still track Kimlun as cash, check Net Worth → Cash for names containing "Kimlun" or "MY stocks".',
    )
    return
  }

  console.log(`Found ${matches.length} cash account(s) to migrate:\n`)
  for (const row of matches) {
    console.log(`  • ${row.name}`)
    console.log(`    id: ${row.id}`)
    console.log(`    balance (AUD): ${row.balanceAUD ?? '—'}`)
    console.log(`    currency: ${row.currency ?? '—'}`)
    console.log('')
  }

  console.log('Next steps (manual — this script does not modify data):\n')
  console.log('  1. Import or add portfolio parcels for each KLSE ticker (e.g. 5171.KL for Kimlun).')
  console.log('     Use today\'s AUD market value as a placeholder cost base if purchase history is unknown.')
  console.log('  2. Open /networth and confirm the holding appears under stocks (not cash).')
  console.log('  3. Verify FX exposure shows a MYR portion and geographic split shows MY.')
  console.log('  4. Delete the old cash account row(s) listed above via Net Worth → Cash in the UI.')
  console.log('  5. Re-check total assets — net worth should stay flat if parcel values match the old cash balance.\n')
}

async function main() {
  const env = { ...loadEnvLocal(), ...process.env }
  const { uid: uidArg } = parseArgs(process.argv.slice(2))
  const uid = uidArg || env.PORTFOLIOPILOT_UID || ''

  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.error('Missing VITE_FIREBASE_* in .env.local — cannot query Firestore.')
    process.exit(1)
  }

  if (!uid) {
    console.error(
      'Missing user id. Set PORTFOLIOPILOT_UID or pass --uid=YOUR_FIREBASE_UID',
    )
    process.exit(1)
  }

  const email = env.PORTFOLIOPILOT_EMAIL
  const password = env.PORTFOLIOPILOT_PASSWORD
  if (!email || !password) {
    console.error(
      'Missing PORTFOLIOPILOT_EMAIL / PORTFOLIOPILOT_PASSWORD in .env.local.',
    )
    console.error(
      'Add app credentials so this script can sign in and read your cashAccounts collection.',
    )
    process.exit(1)
  }

  const app = initializeApp(firebaseConfig)
  const auth = getAuth(app)
  const db = getFirestore(app)

  console.log('Signing in…')
  await signInWithEmailAndPassword(auth, email, password)

  const snap = await getDocs(collection(db, 'users', uid, 'cashAccounts'))
  const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const matches = accounts.filter((a) => matchesKimlunWorkaround(a.name))

  printMigrationGuide(matches)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
