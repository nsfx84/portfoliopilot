# PortfolioPilot — Sprint 1.5: Malaysian Stocks Support

**Goal:** Add KLSE (Bursa Malaysia) ticker support to PortfolioPilot's existing portfolio service so Kimlun and other Malaysian holdings appear as proper stock parcels instead of the cash-account workaround. After this ships, the Kimlun cash account record is migrated to a real portfolio parcel.

**Why now:** Kimlun is ~$2.5M of net worth. Tracking it as cash misclassifies the asset, mislabels the dividend as "interest", and will pollute Sprint 3's income reporting if not fixed first.

**Size:** Small. 2 agent sessions, ~3 hours total.

---

## Acceptance Criteria

- [ ] Yahoo Finance ticker resolution accepts `.KL` suffix (e.g. `5171.KL` for Kimlun)
- [ ] Price quotes return in MYR, then convert to AUD via existing FX logic
- [ ] Adding a parcel with ticker `5171.KL` works end-to-end (Import or Transactions page)
- [ ] Net Worth aggregator counts MY stocks correctly under `stocks` breakdown (not crypto, not super)
- [ ] FX exposure chart attribution: MY stocks → MYR currency
- [ ] Geographic split chart attribution: MY stocks → Malaysia
- [ ] No regression in ASX/US/ETF/crypto price fetching
- [ ] CGT engine treats MYR-purchased shares correctly (cost base in AUD using the FX rate on purchase date)

---

## Current State Audit (read these files first)

Before writing code, the agent should read and understand:

```
src/lib/prices.js          → how tickers are normalised and fetched
src/lib/valuation.js       → convertQuoteToAud — currency handling
src/lib/fx.js              → AUD spot conversion (currently USD→AUD)
src/lib/cgt.js             → cost base + CGT calculations
src/lib/sharesightImporter.js → how parcel rows are parsed
src/pages/Import.jsx       → how users add new holdings
api/prices.js (if exists)  → server-side price fetching wrapper
```

Specifically check:
- Does `prices.js` already pass tickers verbatim to yahoo-finance2, or does it normalise (e.g. strip `.AX`)?
- Does `valuation.js` handle non-USD currencies, or only USD/AUD?
- Does `fx.js` cache only USD→AUD, or is it extensible to MYR→AUD?

---

## Architecture

```
User adds parcel "5171.KL"
        ↓
Import.jsx / Transactions.jsx
        ↓
prices.js → yahoo-finance2 quote(5171.KL)
        ↓ returns { regularMarketPrice: 0.98, currency: "MYR" }
valuation.js → convertQuoteToAud
        ↓ calls fx.js
fx.js → { MYR: 0.33 } spot rate (AUD per MYR or MYR per AUD, match existing convention)
        ↓ returns marketValueAud
portfolioService.getTotalValueByCategory
        ↓ categorises as { stocks } (not crypto, not super)
netWorthService aggregator
        ↓ MY stocks → fx exposure: MYR, geographic: MY
```

---

## Sprint Tasks (one per agent session)

### Task 1 — MY ticker + FX support in the price/valuation layer

**Files to modify:**
- `src/lib/prices.js`
- `src/lib/fx.js`
- `src/lib/valuation.js`
- `src/lib/prices.test.js` if exists (add tests)
- `src/lib/fx.test.js` if exists

**Changes:**

1. **`prices.js`** — ensure KLSE tickers (suffix `.KL`) pass through to yahoo-finance2 unchanged. If the file currently strips/normalises suffixes, exempt `.KL` (and `.AX`, `.NZ`, etc.). Test: `quote("5171.KL")` returns a price.

2. **`fx.js`** — extend to support multiple base currencies. Replace any hardcoded `USD→AUD` logic with a generic `getSpot(fromCurrency, toCurrency)`. Use yahoo-finance2's FX quote feature (`MYRAUD=X` ticker) or an open API. Cache results for the session.

3. **`valuation.js`** — `convertQuoteToAud(quote)` should branch on `quote.currency`:
   - `AUD` → return as-is
   - `USD` → use existing USD→AUD logic
   - `MYR` → multiply by MYR→AUD spot
   - Other → log warning, return 0 (or throw, depending on existing pattern)

4. **Tests:** at minimum, verify `convertQuoteToAud({ price: 100, currency: 'MYR' })` returns a sensible AUD amount with a mocked FX rate.

**Manual test:**
- Browser console: `await window.portfolioService.fetchQuote('5171.KL')` should return a Kimlun price.

**Pause for review before Task 2.**

---

### Task 2 — Categorisation, attribution, and migration helper

**Files to modify:**
- `src/lib/portfolioService.js` (or wherever `getTotalValueByCategory` lives)
- `src/lib/netWorthService.js` (FX exposure + geographic split logic)
- `src/data/schemas.js` (document the new ticker suffix convention)

**Files to create:**
- `scripts/migrate-kimlun-from-cash.js` — one-off Node script

**Changes:**

1. **`portfolioService.getTotalValueByCategory`** — currently buckets by `assetClass` field. Add logic so KLSE parcels (currency MYR OR ticker ending `.KL`) are still classified as `stocks`, not a new bucket.

2. **`netWorthService.computeFXExposure`** — for each portfolio parcel, attribute by `quote.currency` (not by user input). KLSE parcels → MYR bucket. Existing USD parcels → USD bucket (or stays AUD if already converted at parcel level; check existing logic).

3. **`netWorthService.computeGeographicSplit`** — KLSE tickers → `MY`. ASX → `AU`. US tickers → `US`. Crypto → `borderless`.

4. **Migration script** — Node script that reads the user's current `cashAccounts` collection, finds entries where name contains "Kimlun" or "MY stocks", deletes them, and emits a console message telling the user to re-add as portfolio parcels. Don't auto-create the parcels — too risky without knowing exact purchase dates/cost basis. Run with:

```powershell
node scripts/migrate-kimlun-from-cash.js
```

**Manual test:**
- Add a parcel via Import: ticker `5171.KL`, qty `7774000`, cost base (your call — placeholder if family-allocated), purchase date.
- Open `/networth`. Total Assets should include Kimlun under stocks, not cash.
- FX exposure chart should show MYR portion.
- Geographic chart should show MY portion.
- Delete the old Kimlun cash account record via the UI.

---

## Specific Considerations

### Kimlun cost base for CGT

Since Kimlun is family-allocated (per our earlier conversation), the cost base for CGT purposes is contentious:

- **If gifted/inherited:** AUD market value at date of acquisition becomes cost base
- **If purchased:** original MYR cost converted at exchange rate on purchase date

Talk to Steven before entering a cost base. For interim purposes, use a placeholder (e.g., AUD market value as of Sprint 1 ship date) and flag the parcel as "review with accountant". Don't realise any CGT off this placeholder.

### Dividend handling

Sprint 1.5 does NOT need to track dividends — that's Sprint 3 (Income & Cashflow). For now, the dividend yield shown in Kimlun's cash-account hack just disappears (it was informational anyway).

### Other MY stocks

Same migration applies. If you tracked them as a single `Other MY stocks` cash entry, migrate by adding each KLSE ticker individually as a parcel. If you don't know individual ticker breakdowns, leave the consolidated cash entry until you have a list.

---

## Cursor Prompts (ready to paste)

### Task 1 prompt

```
@docs/PortfolioPilot_Sprint1_5_MalaysianStocks_Spec.md

Implement Task 1 only: MY ticker + FX support in price/valuation layer.

Read src/lib/prices.js, src/lib/fx.js, and src/lib/valuation.js first to understand the existing pattern. Then:

1. Ensure KLSE tickers (suffix .KL) pass through to yahoo-finance2 without modification
2. Extend fx.js to support a generic getSpot(fromCurrency, toCurrency) — start with adding MYR→AUD. Cache rates for the session.
3. Update convertQuoteToAud in valuation.js to branch on quote.currency: AUD passthrough, USD existing logic, MYR new logic, others warn.
4. Add minimal vitest coverage for the MYR conversion path with mocked FX

Do NOT change categorisation or FX exposure logic yet — that's Task 2.

Manual test: window.portfolioService.fetchQuote('5171.KL') should return a Kimlun price.

Pause before Task 2.
```

### Task 2 prompt

```
@docs/PortfolioPilot_Sprint1_5_MalaysianStocks_Spec.md

Implement Task 2 only: Categorisation, FX/Geo attribution, and migration helper.

Building on Task 1 (which ensures KLSE prices work):

1. Update portfolioService.getTotalValueByCategory so KLSE parcels still bucket as `stocks` (not a new category)
2. Update netWorthService.computeFXExposure to attribute by quote.currency — KLSE → MYR
3. Update netWorthService.computeGeographicSplit — KLSE → MY, ASX → AU, US tickers → US, crypto → borderless
4. Create scripts/migrate-kimlun-from-cash.js — Node script that lists cash accounts where name contains "Kimlun" or "MY stocks", and prints instructions for re-entering as parcels (do NOT auto-delete or auto-create — just inform)

Update src/data/schemas.js to document the ticker suffix convention.

Manual test sequence:
1. Add parcel 5171.KL via Import with placeholder cost base
2. Verify Net Worth page: Kimlun appears under stocks, not cash
3. Delete the old Kimlun cash account record via the UI
4. FX exposure shows MYR portion correctly
5. Geographic split shows MY portion correctly

This finishes Sprint 1.5.
```

---

## Out of Scope

- Dividend income tracking (Sprint 3)
- Singapore stocks (`.SI`), Hong Kong (`.HK`) — same pattern would extend if needed later
- KLSE-specific tax treatment (Sprint 3 will handle foreign dividend tax)
- Currency hedging analytics (Sprint 2/3)

---

## When done

```powershell
git add . ; git commit -m "feat: KLSE ticker support + Kimlun migration from cash hack"
vercel --prod
```

Update CLAUDE.md to note PortfolioPilot now covers ASX, US, ETFs, crypto, **and KLSE**.

Then take a moment before starting Sprint 2 or Sprint 3 — populate your other MY stocks via Import, verify they're attributed correctly, and confirm your Net Worth headline is stable at the right number.
