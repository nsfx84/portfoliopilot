# PortfolioPilot — Sprint 1: Net Worth Module

**Goal:** Add a Net Worth dashboard to PortfolioPilot that aggregates existing portfolio data (stocks/ETFs/crypto from the CGT engine) with new manually-entered Properties, Cash Accounts, and Liabilities. User sees one number: their household net worth, broken down by asset class, currency, geography, and liquidity.

**Why now:** Stop maintaining `Household_Finance_Dashboard.html` separately. PortfolioPilot becomes the single source of truth.

---

## Acceptance Criteria

- [ ] `/networth` route exists, gated by Firebase Auth
- [ ] User can CRUD properties, cash accounts, liabilities
- [ ] Net worth calculates live: `assets − liabilities`
- [ ] Four charts render: asset allocation donut, FX exposure, geographic split, liquidity tiers
- [ ] Headline cards: Total Assets, Total Liabilities, Net Worth, Liquid Wealth
- [ ] Existing portfolio totals (stocks, crypto) auto-pull from CGT engine
- [ ] Mobile responsive (sm/md/lg breakpoints work)
- [ ] All data persists in Firestore under `users/{uid}/...`
- [ ] No regression in existing portfolio views

---

## Firestore Schema

```
users/{uid}/properties/{propertyId}
{
  name: "Walker St",
  type: "residential" | "commercial",
  country: "AU" | "MY",
  ownership: "Matterhorn Trust" | "joint" | "wife" | "personal",
  currentValueAUD: 1600000,
  grossRentAUD: 36400,         // annual
  annualCostsAUD: 6500,        // rates, insurance, mgmt, repairs
  createdAt: timestamp,
  updatedAt: timestamp
}

users/{uid}/cashAccounts/{accountId}
{
  name: "ANZ HISA",
  provider: "ANZ",
  currency: "AUD" | "MYR",
  balanceAUD: 1000000,         // always stored in AUD-equivalent
  interestRate: 0.048,
  type: "savings" | "offset" | "checking",
  createdAt: timestamp,
  updatedAt: timestamp
}

users/{uid}/liabilities/{liabilityId}
{
  name: "Walker St mortgage",
  linkedPropertyId: "...",     // optional FK
  lender: "CBA",
  balanceAUD: 900000,
  interestRate: 0.0624,
  type: "mortgage" | "credit_card" | "personal" | "car_loan",
  createdAt: timestamp,
  updatedAt: timestamp
}

users/{uid}/netWorthSnapshots/{date}
{
  date: "2026-06-15",
  totalAssets: 8500000,
  totalLiabilities: 1955000,
  netWorth: 6545000,
  breakdown: { property, cash, stocks, crypto, super, other }
}
```

`netWorthSnapshots` is a daily/weekly snapshot for the historical trend chart (Sprint 2).

---

## New React Components

```
src/pages/NetWorth.jsx                  // Main route page
src/components/networth/
  ├── NetWorthHeader.jsx                // 4 stat cards
  ├── AssetAllocationChart.jsx          // Donut: property/cash/stocks/crypto/super/other
  ├── FXExposureChart.jsx               // Donut: AUD/MYR/crypto
  ├── GeographicSplitChart.jsx          // Bar: AU/MY/borderless
  ├── LiquidityTiersChart.jsx           // Bar: instant/2-3d/locked/slow
  ├── PropertyList.jsx                  // Table + add/edit modal
  ├── PropertyForm.jsx                  // Modal form for CRUD
  ├── CashAccountList.jsx               // Table + add/edit modal
  ├── CashAccountForm.jsx               // Modal form for CRUD
  ├── LiabilityList.jsx                 // Table + add/edit modal
  └── LiabilityForm.jsx                 // Modal form for CRUD

src/services/netWorthService.js         // Firestore CRUD + aggregation
src/hooks/useNetWorth.js                // React Query hook returning computed totals
```

---

## Integration Points

```
src/services/portfolioService.js  ← EXISTING: pull stock/ETF/crypto current values
src/services/netWorthService.js   ← NEW: combine with property/cash/liabilities
src/contexts/AuthContext.jsx      ← EXISTING: reuse for user.uid
src/components/charts/*.jsx       ← EXISTING: reuse Chart.js wrapper components
src/router.jsx                    ← Add /networth route
src/components/Sidebar.jsx        ← Add "Net Worth" nav item
```

**Key function in `netWorthService.js`:**

```js
async function getNetWorthSummary(uid) {
  const [portfolio, properties, cashAccounts, liabilities] = await Promise.all([
    portfolioService.getTotalValueByCategory(uid),  // existing
    getCollection(`users/${uid}/properties`),
    getCollection(`users/${uid}/cashAccounts`),
    getCollection(`users/${uid}/liabilities`),
  ]);

  const property = sum(properties.map(p => p.currentValueAUD));
  const cash = sum(cashAccounts.map(c => c.balanceAUD));
  const stocks = portfolio.stocks + portfolio.etfs;
  const crypto = portfolio.crypto;
  const totalAssets = property + cash + stocks + crypto + portfolio.super;
  const totalLiab = sum(liabilities.map(l => l.balanceAUD));

  return {
    totalAssets,
    totalLiabilities: totalLiab,
    netWorth: totalAssets - totalLiab,
    liquid: cash + stocks + crypto,
    breakdown: { property, cash, stocks, crypto, super: portfolio.super },
    fxExposure: computeFX(properties, cashAccounts, portfolio),
    geographic: computeGeo(properties, cashAccounts, portfolio),
  };
}
```

---

## Sprint Tasks (in order, one per Cursor Plan session)

1. **Firestore schema + service layer**
   `netWorthService.js` with CRUD for properties, cashAccounts, liabilities + the `getNetWorthSummary` aggregator. Add Firebase security rules. Unit test the aggregator.

2. **NetWorth page shell + route**
   Add `/networth` route, sidebar nav item, page header, four placeholder stat cards. Verify auth gating works.

3. **CRUD forms — properties first, then cash, then liabilities**
   Modal forms, validation (Yup or Zod), TanStack Query for cache invalidation. Reuse existing modal component pattern if it exists.

4. **Charts**
   Wire up the four charts using your existing Chart.js wrapper. Copy chart configs from `Household_Finance_Dashboard.html` lines ~750–870 as a starting point.

5. **Daily snapshot job**
   Firebase Function on schedule (or client-side on first login of the day) writes `netWorthSnapshots/{date}`. Sets up Sprint 2's historical chart.

6. **Mobile polish + deploy**
   `npm run dev` test all breakpoints. `vercel --prod` (per CLAUDE.md, auto-deploy unreliable).

---

## Suggested Cursor Plan-mode prompts

**Task 1:**
> Create `src/services/netWorthService.js` implementing CRUD for three Firestore collections (`properties`, `cashAccounts`, `liabilities`) under `users/{uid}/`. Use the existing `db` import from `firebase.js`. Include `getNetWorthSummary(uid)` that combines these with the existing portfolio service totals. Match the existing service file conventions in this codebase.

**Task 2:**
> Add `/networth` route to the router with auth gating. Create `src/pages/NetWorth.jsx` that calls `useNetWorth()` and renders 4 stat cards: Total Assets, Total Liabilities, Net Worth, Liquid Wealth. Match the existing page layout pattern. Add a "Net Worth" item to the sidebar nav.

**Task 3:**
> Create `PropertyForm.jsx` and `PropertyList.jsx`. Fields: name, type (residential/commercial), country (AU/MY), ownership, currentValueAUD, grossRentAUD, annualCostsAUD. Use the existing modal component and form validation pattern. Wire to `netWorthService.createProperty/updateProperty/deleteProperty`. TanStack Query for cache.

---

## Out of scope for this sprint

- Statement PDF ingestion (Sprint 4)
- Income/Cashflow view (Sprint 3)
- Subscription tracker (Sprint 5)
- Historical net worth chart (needs Sprint 5's snapshot data first)
- Multi-currency display toggle (default everything to AUD)
- Trust/entity structure modelling (Sprint 6+, conversation with Steven first)

---

## When you're done

Delete `Household_Finance_Dashboard.html` from your Desktop. Update CLAUDE.md to note PortfolioPilot now contains Net Worth tracking. Bookmark `portfoliopilot.com.au/networth` (or your URL) as your daily check.

---

**Files referenced as design spec:**
- `Household_Finance_Dashboard.html` — chart configs, input fields, calculations to mirror
- `Checking_Account_Analysis.html` — subscription detection patterns (Sprint 5)
- `CC Statement/CC_Dashboard.html` — transaction categorisation patterns (Sprint 4)
