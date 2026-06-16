import { useState } from 'react'
import {
  createCashAccount,
  updateCashAccount,
} from '../../lib/netWorthService.js'

const inputClass =
  'w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-slate-600 placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40'

const labelClass =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500'

const CURRENCIES = [
  { value: 'AUD', label: 'AUD' },
  { value: 'MYR', label: 'MYR' },
]

const ACCOUNT_TYPES = [
  { value: 'savings', label: 'Savings' },
  { value: 'offset', label: 'Offset' },
  { value: 'checking', label: 'Checking' },
]

const DEFAULTS = {
  name: '',
  provider: '',
  currency: 'AUD',
  balanceAUD: '',
  interestRate: '',
  type: 'savings',
}

function parseNonNegative(value, fieldLabel) {
  const trimmed = String(value).trim()
  if (trimmed === '') return 0
  const num = Number(trimmed)
  if (Number.isNaN(num) || num < 0) {
    throw new Error(`${fieldLabel} must be a number ≥ 0.`)
  }
  return num
}

function parseInterestRate(value) {
  const trimmed = String(value).trim()
  if (trimmed === '') return 0
  const num = Number(trimmed)
  if (Number.isNaN(num) || num < 0 || num > 1) {
    throw new Error('Interest rate must be a number between 0 and 1 (e.g. 0.048 for 4.8%).')
  }
  return num
}

function accountToForm(account) {
  if (!account) return { ...DEFAULTS }
  return {
    name: account.name ?? '',
    provider: account.provider ?? '',
    currency: account.currency ?? 'AUD',
    balanceAUD:
      account.balanceAUD != null ? String(account.balanceAUD) : '',
    interestRate:
      account.interestRate != null ? String(account.interestRate) : '',
    type: account.type ?? 'savings',
  }
}

export function CashAccountForm({ open, account, uid, onClose, onSaved }) {
  if (!open) return null

  return (
    <CashAccountFormDialog
      key={account?.id ?? 'new'}
      account={account}
      uid={uid}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

function CashAccountFormDialog({ account, uid, onClose, onSaved }) {
  const [form, setForm] = useState(() => accountToForm(account))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const isEdit = Boolean(account?.id)

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const name = form.name.trim()
    if (!name) {
      setError('Account name is required.')
      return
    }

    let balanceAUD
    let interestRate
    try {
      balanceAUD = parseNonNegative(form.balanceAUD, 'Balance')
      interestRate = parseInterestRate(form.interestRate)
    } catch (err) {
      setError(err.message)
      return
    }

    if (!uid) {
      setError('You must be signed in to save a cash account.')
      return
    }

    const payload = {
      name,
      provider: form.provider.trim(),
      currency: form.currency,
      balanceAUD,
      interestRate,
      type: form.type,
    }

    setSaving(true)
    try {
      if (isEdit) {
        await updateCashAccount(uid, account.id, payload)
      } else {
        await createCashAccount(uid, payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err?.message ?? 'Failed to save cash account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-account-form-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-800/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30"
      >
        <h3
          id="cash-account-form-title"
          className="text-lg font-semibold tracking-tight text-white"
        >
          {isEdit ? 'Edit cash account' : 'Add cash account'}
        </h3>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="cash-account-name" className={labelClass}>
              Name
            </label>
            <input
              id="cash-account-name"
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
              className={inputClass}
              placeholder="ANZ HISA"
            />
          </div>

          <div>
            <label htmlFor="cash-account-provider" className={labelClass}>
              Provider
            </label>
            <input
              id="cash-account-provider"
              type="text"
              value={form.provider}
              onChange={(e) => setField('provider', e.target.value)}
              className={inputClass}
              placeholder="ANZ"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cash-account-currency" className={labelClass}>
                Currency
              </label>
              <select
                id="cash-account-currency"
                value={form.currency}
                onChange={(e) => setField('currency', e.target.value)}
                className={inputClass}
              >
                {CURRENCIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cash-account-type" className={labelClass}>
                Type
              </label>
              <select
                id="cash-account-type"
                value={form.type}
                onChange={(e) => setField('type', e.target.value)}
                className={inputClass}
              >
                {ACCOUNT_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cash-account-balance" className={labelClass}>
                Balance (AUD-equivalent)
              </label>
              <input
                id="cash-account-balance"
                type="number"
                min="0"
                step="1"
                value={form.balanceAUD}
                onChange={(e) => setField('balanceAUD', e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="cash-account-rate" className={labelClass}>
                Interest rate (0–1)
              </label>
              <input
                id="cash-account-rate"
                type="number"
                min="0"
                max="1"
                step="0.0001"
                value={form.interestRate}
                onChange={(e) => setField('interestRate', e.target.value)}
                className={inputClass}
                placeholder="0.048"
              />
              <p className="mt-1 text-xs text-slate-600">
                e.g. 0.048 for 4.8%
              </p>
            </div>
          </div>

          {error ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-600 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Add cash account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
