import { useCallback, useEffect, useRef, useState } from 'react'
import {
  computeTradeTotals,
  defaultCurrencyForMarket,
  fetchLiveAudPerUnit,
  formatTradeBreakdown,
  TRADE_CURRENCIES,
  TRADE_MARKETS,
  validateTrade,
} from '../../lib/manualTrades.js'

const inputClass =
  'w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-slate-600 placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40'

const inputErrorClass =
  'w-full rounded-lg border border-rose-500/70 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/40'

const labelClass =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500'

function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs font-medium text-rose-300">{message}</p>
}

/**
 * Add / edit form for a manual trade.
 *
 * @param {{
 *   value: object,
 *   onChange: (next: object) => void,
 *   onSubmit: (values: object) => void | Promise<void>,
 *   onReset?: () => void,
 *   submitLabel?: string,
 *   submitting?: boolean,
 *   idPrefix?: string,
 *   footer?: import('react').ReactNode,
 * }} props
 */
export function TradeForm({
  value,
  onChange,
  onSubmit,
  onReset,
  submitLabel = 'Add trade',
  submitting = false,
  idPrefix = 'trade',
  footer = null,
}) {
  const [errors, setErrors] = useState({})
  const [fxStatus, setFxStatus] = useState('')
  const [fxLoading, setFxLoading] = useState(false)
  // Tracks the currency whose live rate we have already auto-filled, so a user
  // override is never clobbered by a re-render.
  const autoFilledFor = useRef(null)

  const setField = useCallback(
    (field, next) => {
      onChange({ ...value, [field]: next })
    },
    [onChange, value],
  )

  const totals = computeTradeTotals({
    type: value.type,
    quantity: value.quantity,
    price: value.price,
    currency: value.currency,
    fxRate: value.fxRate,
    brokerage: value.brokerage,
  })
  const breakdown = formatTradeBreakdown(totals)

  const loadLiveFx = useCallback(
    async (currency, { overwrite }) => {
      if (currency === 'AUD') return
      setFxLoading(true)
      setFxStatus('Fetching live rate…')
      try {
        const live = await fetchLiveAudPerUnit(currency)
        if (!live) {
          setFxStatus(`Could not fetch a live AUD/${currency} rate — enter it manually.`)
          return
        }
        const rounded = String(Number(live.rate.toFixed(6)))
        setFxStatus(
          `Live rate ${rounded} AUD per ${currency}. Override for backdated trades.`,
        )
        if (overwrite) {
          onChange((prev) => ({ ...prev, fxRate: rounded }))
        }
      } catch (err) {
        setFxStatus(err?.message ?? 'Live rate lookup failed.')
      } finally {
        setFxLoading(false)
      }
    },
    [onChange],
  )

  // Auto-populate the FX rate the first time a non-AUD currency is selected.
  // The status line is only rendered for non-AUD, so there is nothing to clear
  // when switching back to AUD.
  useEffect(() => {
    const ccy = value.currency
    if (ccy === 'AUD') {
      autoFilledFor.current = null
      return
    }
    if (autoFilledFor.current === ccy) return
    autoFilledFor.current = ccy
    const blank = String(value.fxRate ?? '').trim() === ''
    loadLiveFx(ccy, { overwrite: blank })
  }, [value.currency, value.fxRate, loadLiveFx])

  function handleMarketChange(market) {
    const nextCurrency = defaultCurrencyForMarket(market)
    onChange({ ...value, market, currency: nextCurrency })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const { errors: next, values } = validateTrade(value)
    setErrors(next)
    if (!values) return
    onSubmit(values)
  }

  function handleReset() {
    setErrors({})
    setFxStatus('')
    autoFilledFor.current = null
    onReset?.()
  }

  const isAud = value.currency === 'AUD'
  const id = (suffix) => `${idPrefix}-${suffix}`

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <span className={labelClass}>Type</span>
          <div
            role="radiogroup"
            aria-label="Trade type"
            className="inline-flex rounded-lg border border-slate-600 bg-slate-900/80 p-1"
          >
            {['buy', 'sell'].map((t) => {
              const active = value.type === t
              const activeClass =
                t === 'buy'
                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40'
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setField('type', t)}
                  className={[
                    'rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-colors',
                    active ? activeClass : 'text-slate-400 hover:text-white',
                  ].join(' ')}
                >
                  {t}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label htmlFor={id('date')} className={labelClass}>
            Date
          </label>
          <input
            id={id('date')}
            type="date"
            value={value.tradeDate}
            onChange={(e) => setField('tradeDate', e.target.value)}
            className={errors.tradeDate ? inputErrorClass : inputClass}
          />
          <FieldError message={errors.tradeDate} />
        </div>

        <div>
          <label htmlFor={id('ticker')} className={labelClass}>
            Ticker
          </label>
          <input
            id={id('ticker')}
            type="text"
            value={value.ticker}
            onChange={(e) => setField('ticker', e.target.value.toUpperCase())}
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="STRC"
            className={errors.ticker ? inputErrorClass : inputClass}
          />
          <FieldError message={errors.ticker} />
        </div>

        <div>
          <label htmlFor={id('market')} className={labelClass}>
            Market
          </label>
          <select
            id={id('market')}
            value={value.market}
            onChange={(e) => handleMarketChange(e.target.value)}
            className={errors.market ? inputErrorClass : inputClass}
          >
            {TRADE_MARKETS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <FieldError message={errors.market} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={id('name')} className={labelClass}>
            Name <span className="normal-case text-slate-600">(recommended)</span>
          </label>
          <input
            id={id('name')}
            type="text"
            value={value.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="Strategy Inc."
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={id('quantity')} className={labelClass}>
            Quantity
          </label>
          <input
            id={id('quantity')}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={value.quantity}
            onChange={(e) => setField('quantity', e.target.value)}
            placeholder="50"
            className={errors.quantity ? inputErrorClass : inputClass}
          />
          <FieldError message={errors.quantity} />
        </div>

        <div>
          <label htmlFor={id('price')} className={labelClass}>
            Price per unit
          </label>
          <input
            id={id('price')}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={value.price}
            onChange={(e) => setField('price', e.target.value)}
            placeholder="78.99"
            className={errors.price ? inputErrorClass : inputClass}
          />
          <FieldError message={errors.price} />
        </div>

        <div>
          <label htmlFor={id('currency')} className={labelClass}>
            Currency
          </label>
          <select
            id={id('currency')}
            value={value.currency}
            onChange={(e) => setField('currency', e.target.value)}
            className={errors.currency ? inputErrorClass : inputClass}
          >
            {TRADE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <FieldError message={errors.currency} />
        </div>

        <div>
          <label htmlFor={id('brokerage')} className={labelClass}>
            Brokerage (AUD)
          </label>
          <input
            id={id('brokerage')}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={value.brokerage}
            onChange={(e) => setField('brokerage', e.target.value)}
            placeholder="0"
            className={errors.brokerage ? inputErrorClass : inputClass}
          />
          <FieldError message={errors.brokerage} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={id('fx')} className={labelClass}>
            FX rate{' '}
            <span className="normal-case text-slate-600">
              (AUD per 1 {isAud ? 'AUD' : value.currency})
            </span>
          </label>
          <div className="flex gap-2">
            <input
              id={id('fx')}
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              value={isAud ? '1' : value.fxRate}
              disabled={isAud}
              onChange={(e) => setField('fxRate', e.target.value)}
              placeholder="1.4611"
              className={[
                errors.fxRate ? inputErrorClass : inputClass,
                isAud ? 'cursor-not-allowed opacity-50' : '',
              ].join(' ')}
            />
            <button
              type="button"
              onClick={() => loadLiveFx(value.currency, { overwrite: true })}
              disabled={isAud || fxLoading}
              className="shrink-0 rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fxLoading ? 'Loading…' : 'Use live'}
            </button>
          </div>
          <FieldError message={errors.fxRate} />
          {!isAud && fxStatus ? (
            <p className="mt-1 text-xs text-slate-500">{fxStatus}</p>
          ) : null}
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor={id('notes')} className={labelClass}>
            Notes <span className="normal-case text-slate-600">(optional)</span>
          </label>
          <input
            id={id('notes')}
            type="text"
            value={value.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="IG order X78PL: filled in two tranches"
            className={inputClass}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-700/70 bg-slate-900/50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {value.type === 'buy' ? 'Total cost' : 'Net proceeds'} (AUD)
        </p>
        {breakdown ? (
          <>
            <p className="mt-1 font-mono text-lg tabular-nums text-white">
              {totals.totalAud != null
                ? new Intl.NumberFormat('en-AU', {
                    style: 'currency',
                    currency: 'AUD',
                  }).format(totals.totalAud)
                : '—'}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500">{breakdown}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            Enter quantity, price{isAud ? '' : ' and FX rate'} to see the AUD total.
          </p>
        )}
      </div>

      {footer}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
        {onReset ? (
          <button
            type="button"
            onClick={handleReset}
            disabled={submitting}
            className="rounded-lg border border-slate-600 bg-slate-800/90 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reset
          </button>
        ) : null}
      </div>
    </form>
  )
}
