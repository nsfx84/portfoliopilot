# PortfolioPilot — Sprint 4: Statement Ingestion + Spending Dashboard

**Goal:** Users can upload PDF credit card and bank statements. The system extracts transactions, categorises them via Claude API, stores in Firestore, and renders a spending dashboard. Ship this as an invite-only preview to 5 friends.

**Why this sprint:** The most valuable feature in your original HTML dashboard was the auto-categorised spending analysis. Porting it to PortfolioPilot makes the app genuinely useful for friends who don't self-manage portfolios but do want to understand their spending.

**Size:** Medium-large. 5 tasks + 1 gating step. ~1 week of agent sessions.

---

## Prerequisites

- Anthropic API key (get from https://console.anthropic.com)
- Firebase Blaze plan (free Spark plan blocks Cloud Functions if you use them; Vercel API routes work on Hobby)
- ~$5/month budget for Claude API calls (assume 5 users × 12 statements = 60/mo × ~$0.05 each = $3/mo)

---

## Acceptance Criteria

- [ ] Only invited emails can create accounts (allowlist enforced in Firestore rules)
- [ ] Users can upload PDF statements via drag-and-drop
- [ ] Backend parses PDF text and sends to Claude for structured extraction
- [ ] Extracted transactions stored in Firestore under `users/{uid}/transactions/`
- [ ] Each transaction has: date, merchant, amount, category, source_statement_id
- [ ] Spending dashboard shows monthly trend, category breakdown, top merchants
- [ ] Recurring subscription detection (merchant appears 3+ months in a row)
- [ ] Per-user cost cap prevents API abuse (max 50 statements/user/month)
- [ ] Original PDFs stored in Firebase Storage under user's folder (deletable)
- [ ] Mobile responsive

---

## Task 0 — Invite-Only Allowlist (do this FIRST, before anything else ships)

**Why first:** Once you deploy Sprint 4, the URL becomes worth attacking. Lock signups down before you post anything.

**Files to modify:**
- `firestore.rules`
- New: `docs/how-to-invite-users.md`

**Firestore rule additions:**

```
match /allowlist/{email} {
  allow read: if request.auth != null && request.auth.token.email == email;
  allow write: if false;  // only via console
}

match /users/{userId} {
  allow create: if request.auth != null 
                   && request.auth.uid == userId
                   && exists(/databases/$(database)/documents/allowlist/$(request.auth.token.email));
  allow read, update, delete: if request.auth != null && request.auth.uid == userId;
  // ...existing subcollection rules
}
```

**Client-side handling:**

In `src/lib/authService.js` (or wherever signup happens):
1. After successful signup, attempt to create `users/{uid}` doc
2. If it fails (rule blocks), sign the user out and show "not on allowlist — email sinfui@... to request access"

**Add allowlist entries manually via Firebase Console:**
- Firestore → allowlist collection → new doc with ID = friend's email → any field content

**Deploy the rules:**

```powershell
firebase deploy --only firestore:rules
```

Manual test:
1. Sign up with an email NOT on allowlist → should fail cleanly
2. Add that email to allowlist → sign up succeeds

---

## Task 1 — Firebase Storage + Firestore Schema

**Files to create/modify:**
- `storage.rules` (new)
- `firebase.json` — add storage config
- `src/lib/statementService.js` — CRUD for statements + transactions

**Storage rules:**

```
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/statements/{statementId}/{filename} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow write: if request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('application/pdf');
    }
  }
}
```

**Firestore schema:**

```
users/{uid}/statements/{statementId}
{
  filename: "2026-06-04.pdf",
  uploadedAt: timestamp,
  storagePath: "users/{uid}/statements/{statementId}/2026-06-04.pdf",
  status: "pending" | "processing" | "parsed" | "error",
  errorMessage: string?,
  provider: "amex" | "cba" | "bom" | "auto" | "unknown",
  statementDate: string?,  // e.g. "2026-06-04"
  transactionCount: number,
  totalDebits: number,
  totalCredits: number,
  costUsd: number,  // API cost for this statement
}

users/{uid}/transactions/{transactionId}
{
  date: string,           // "2026-05-15"
  merchant: string,       // "WOOLWORTHS 3317 DONCASTER"
  merchantNormalised: string,  // "Woolworths"
  amount: number,         // in AUD, positive = spend, negative = refund
  category: string,       // "Groceries", "Dining", etc.
  source: {
    statementId: string,
    account: "amex" | "checking" | "..." 
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  userCategorised: boolean,  // true if user edited category post-import
}

users/{uid}/usage/{yyyymm}
{
  month: "2026-06",
  statementsProcessed: number,
  totalCostUsd: number,
  lastReset: timestamp,
}
```

**Service functions:**
- `uploadStatement(uid, file)` → Storage + create pending statement doc
- `listStatements(uid)`
- `deleteStatement(uid, statementId)` → also cascade delete linked transactions
- `listTransactions(uid, filters)` — filters: date range, category, merchant
- `updateTransactionCategory(uid, transactionId, newCategory)` → mark userCategorised: true
- `getMonthlyUsage(uid, yyyymm)` → for cost cap check

Manual test: from browser console, upload a PDF via the service and verify it lands in Storage + Firestore with `status: 'pending'`.

---

## Task 2 — Parsing Pipeline (Vercel API route)

**Files to create:**
- `api/parse-statement.js` (Vercel serverless function)
- `src/lib/parseClient.js` — client wrapper to trigger parse

**Dependencies to install:**
```powershell
npm install --save @anthropic-ai/sdk pdf-parse firebase-admin
```

**Vercel env vars to add** (in Vercel dashboard):
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `FIREBASE_ADMIN_KEY` — service account JSON as env var (base64-encoded)

**Endpoint `POST /api/parse-statement`:**

Body:
```json
{
  "uid": "user-firebase-uid",
  "statementId": "abc123",
  "storagePath": "users/{uid}/statements/{statementId}/2026-06-04.pdf"
}
```

Flow:
1. Verify Firebase Auth token from request header (`Authorization: Bearer ...`)
2. Confirm `uid` matches token
3. Check user's monthly usage cap (`getMonthlyUsage` — reject if > 50)
4. Download PDF from Storage using firebase-admin
5. Extract text with `pdf-parse`
6. Send to Claude with structured extraction prompt (see below)
7. Parse Claude's JSON response
8. Write transactions to Firestore in a batch
9. Update statement doc: `status: 'parsed'`, `transactionCount`, `totalDebits`, `totalCredits`, `costUsd`
10. Increment usage counter
11. Return `{ transactionCount, totalDebits, totalCredits }`

**Claude prompt (use claude-3-5-sonnet-latest for cost, or claude-sonnet-4-6 for accuracy):**

```
You are a financial statement parser. Extract every transaction from this credit card or bank statement.

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
[PDF TEXT HERE]
---
```

**Test the endpoint locally:**
```powershell
# From browser console after upload:
await fetch('/api/parse-statement', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${await firebase.auth().currentUser.getIdToken()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ uid, statementId, storagePath })
})
```

---

## Task 3 — Upload UI + Statement List

**Files to create:**
- `src/pages/Statements.jsx` — new route `/statements`
- `src/components/statements/StatementUpload.jsx` — drag-drop zone
- `src/components/statements/StatementList.jsx` — table of past uploads

**Upload UI:**
- Drop zone that accepts PDF files
- Multi-file drag-drop supported (queue them)
- Progress indicator per file: uploading → parsing → done
- Uses the client wrapper: `uploadStatement()` → `triggerParse()`

**Statement list:**
- Columns: Filename, Uploaded, Status, Statement date, Transactions, Total debits, Total credits, Actions (Delete)
- Click a row → drills into that statement's transactions
- Status badges: pending (yellow), processing (blue spinner), parsed (green), error (red — show error message)

**Add "Statements" to sidebar nav** after "Net Worth".

Manual test:
1. Upload 2026-06-04.pdf (your existing Amex statement)
2. Watch status → "processing" → "parsed"
3. Row shows ~50 transactions, correct totals
4. Delete → row and transactions both removed

---

## Task 4 — Spending Dashboard

**Files to create:**
- `src/pages/Spending.jsx` — new route `/spending`
- `src/components/spending/MonthlyTrendChart.jsx`
- `src/components/spending/CategoryDonutChart.jsx`
- `src/components/spending/TopMerchantsChart.jsx`
- `src/components/spending/RecurringDetector.jsx`
- `src/components/spending/TransactionsTable.jsx` (filterable)

**Views:**
- 4 stat cards: Total spend (last 12 mo), Avg/mo, Largest category, Recurring/yr
- Monthly trend bar chart
- Category donut
- Top 15 merchants bar
- Recurring subscriptions detected (merchant appears in 3+ consecutive months)
- Transactions table (all transactions from parsed statements, filterable by month/category/merchant)

**Filters:**
- Date range
- Category (multi-select)
- Merchant (search)
- Account/source (from statement metadata)

Everything reads from `users/{uid}/transactions/` — indexed by date + category for query speed.

**Add "Spending" to sidebar nav** after "Statements".

---

## Task 5 — Ship + Invite Friends

**Deploy:**
```powershell
vercel --prod
```

**Add friends to allowlist via Firebase Console:**
- Firestore → `allowlist` collection
- Create doc per friend: doc ID = email address, empty content or optional `{ name, addedAt }`
- 5 friends → 5 docs

**Send them:**
- The Vercel URL
- Sign up with the email you added
- Upload a statement PDF (Amex/CBA/NAB/Westpac/BOM tested)

**Watch usage:**
- Check `users/{uid}/usage/` collections after they use it
- If any user hits 50/month, they'll be blocked (good — it means the cap works)
- Monitor Anthropic API spend in the console at least weekly for the first month

---

## Cursor Prompts (ready to paste)

### Task 0 prompt
```
@docs/PortfolioPilot_Sprint4_StatementIngestion_Spec.md

Implement Task 0 only: Invite-only allowlist.

Read the current firestore.rules first to understand the existing security model. Then:
1. Add allowlist collection rules per the spec
2. Update users/{userId} rules to require allowlist entry on create
3. Update the client signup flow to detect allowlist rejection and show a friendly "not invited" message
4. Add docs/how-to-invite-users.md explaining the console workflow

Deploy: firebase deploy --only firestore:rules

Manual test:
1. Signed-out state: try to sign up with an email NOT on allowlist → gets rejected
2. Add that email to allowlist via Firebase Console
3. Sign up succeeds and creates users/{uid} doc

Pause before Task 1.
```

### Task 1 prompt
```
@docs/PortfolioPilot_Sprint4_StatementIngestion_Spec.md

Implement Task 1 only: Firebase Storage setup + Firestore schema for statements/transactions.

1. Create storage.rules per the spec — per-user isolation, PDF-only, 10MB max
2. Update firebase.json to include storage
3. Create src/lib/statementService.js with the CRUD functions listed in the spec
4. Update src/data/schemas.js to document the new collections
5. Add vitest coverage for the service aggregation logic

Do NOT implement PDF parsing yet — that's Task 2.

Manual test: from browser console, upload a PDF via uploadStatement() and verify it appears in both Storage and Firestore with status: 'pending'.

Pause before Task 2.
```

### Task 2 prompt
```
@docs/PortfolioPilot_Sprint4_StatementIngestion_Spec.md

Implement Task 2 only: PDF parsing pipeline via Vercel API route.

1. Install dependencies: @anthropic-ai/sdk, pdf-parse, firebase-admin
2. Create api/parse-statement.js — Vercel serverless function per the spec
3. Verify Firebase Auth token, enforce cost cap (50 statements/user/month)
4. Use claude-sonnet-4-5 model with the categorisation prompt from the spec
5. Batch-write transactions to Firestore, update statement doc status, increment usage
6. Create src/lib/parseClient.js — client wrapper that calls the endpoint after upload

Do NOT build the UI yet — that's Task 3.

Manual test from browser console:
1. Upload a statement PDF (any provider)
2. Call parseClient.triggerParse()
3. Watch Firestore: statement.status transitions pending → processing → parsed
4. Transactions collection populated with correct categories

Pause before Task 3.
```

### Task 3 prompt
```
@docs/PortfolioPilot_Sprint4_StatementIngestion_Spec.md

Implement Task 3 only: Upload UI + Statement list page.

1. Create /statements route with auth gating
2. Create StatementUpload component with drag-drop zone (multi-file support, per-file progress)
3. Create StatementList component with the table + status badges
4. Add "Statements" to sidebar nav after "Net Worth"

Match existing PortfolioPilot styling (Login.jsx, Import.jsx, Dashboard.jsx patterns).

Manual test: upload multiple PDFs, watch status transitions, verify totals.

Do NOT build spending charts yet — that's Task 4.

Pause before Task 4.
```

### Task 4 prompt
```
@docs/PortfolioPilot_Sprint4_StatementIngestion_Spec.md

Implement Task 4 only: Spending dashboard.

1. Create /spending route with 4 stat cards
2. Build the 4 charts listed in the spec (monthly trend, category donut, top merchants, recurring detector)
3. Add filterable transactions table
4. Add "Spending" to sidebar nav after "Statements"

Reference the chart configs from the standalone HTML dashboard I built earlier (Household_Finance_Dashboard.html) as visual reference — but use PortfolioPilot's Chart.js wrapper.

Manual test: with statements from Task 3 uploaded, verify all charts render and filters work.

This completes Sprint 4 core. Task 5 (ship + invite) is manual work — no code needed.
```

---

## Out of Scope for Sprint 4

- Splitting a joint account by cardholder (like the SFN/YP split in the HTML dashboard)
- Editable categories via drag-drop
- Merchant renaming (`WOOLWORTHS 3317 DONCAST` → `Woolworths`) via user rules
- Multi-currency handling (assumes AUD-denominated statements)
- Auto-import via bank connections (Basiq/Frollo) — later
- Export to CSV/XLSX
- Budget setting + alerts
- Amex Explorer joint cardholder splitting

Each of these could be Sprint 5+ work.

---

## Cost Governance

**Anthropic API monitoring:**
- Log per-request `costUsd` in `users/{uid}/usage/`
- Firebase Function or cron job: daily sum, alert if any user > $2/day
- Hard cap: 50 statements/user/month = ~$2.50 max per user

**Firebase Blaze concerns:**
- Free Firestore = 50K reads/day, 20K writes/day per project
- 5 users × ~200 transactions/statement × 5 statements/mo = 5,000 writes/mo — well under
- Reads for dashboard: negligible with proper indexing
- Storage: 5GB free, PDFs are small (~200KB)

**Total expected monthly cost with 5 users:** $3-5 (Anthropic) + $0 (Firebase Spark still fits) + $0 (Vercel Hobby) = **~$5/month**

Manageable. If it grows, either charge users or move to Blaze pay-as-you-go.

---

## Sprint 1.6 — Manual Parcel Entry (mini-spec, side quest)

**Goal:** Fill the Transactions page with real functionality — a form to add BUY/SELL/DIVIDEND transactions manually. Unblocks Kimlun migration, IG.com SpaceX + Firefly, and any non-Sharesight buys.

**Size:** Small. One agent session, ~1 hour.

**Files to create/modify:**
- `src/pages/Transactions.jsx` — replace the scaffold with a real list + add button
- `src/components/transactions/TransactionForm.jsx` — modal for BUY/SELL/DIVIDEND
- `src/lib/transactionService.js` — write to same parcels collection Sharesight import uses

**Form fields:**
- Type: BUY / SELL / DIVIDEND
- Ticker (free text with suffix hint: `.AX`, `.KL`, `-USD`, or blank for US)
- Quantity (numeric)
- Price per share (in ticker's native currency)
- Currency (auto-derived from ticker suffix, editable)
- Trade date
- Brokerage (optional)
- Notes (optional)

**On save:** write to the same Firestore collection Sharesight import writes to, using the same schema. The Dashboard + Net Worth will pick it up automatically via existing services.

**Cursor prompt:**
```
Implement Sprint 1.6: Manual Parcel Entry.

Replace src/pages/Transactions.jsx scaffold with:
1. A list of existing parcels/transactions from Firestore
2. An "Add transaction" button that opens TransactionForm modal
3. TransactionForm fields: type (BUY/SELL/DIVIDEND), ticker, quantity, price per share, currency (auto-derived from suffix, editable), trade date, brokerage, notes
4. On save, writes to the same collection used by src/lib/sharesightImporter.js — check that file first for the schema

After save, Dashboard and Net Worth should reflect the new parcel automatically since they read from the same collection.

Match existing styling patterns from PropertyForm.jsx, CashAccountForm.jsx, LiabilityForm.jsx.
```

Do this whenever you want. Independent of Sprint 4.

---

## When done

After Sprint 4 ships and 5 friends are actively using it:

1. Watch analytics for a week — which features do people actually use?
2. If statement upload gets used and Net Worth doesn't → double down on spending
3. If everyone signs up but nobody comes back → landing page + onboarding is the gap
4. If cost governance holds → open sign-ups more broadly with a pricing model
