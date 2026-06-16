import { useEffect, useState } from 'react'
import {
  createLiability,
  listProperties,
  updateLiability,
} from '../../lib/netWorthService.js'

const inputClass =
  'w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-slate-600 placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40'

const labelClass =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500'

const LIABILITY_TYPES = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'personal', label: 'Personal loan' },
  { value: 'car_loan', label: 'Car loan' },
]

const DEFAULTS = {
  name: '',
  linkedPropertyId: '',
  lender: '',
  balanceAUD: '',
  interestRate: '',
  type: 'mortgage',
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
    throw new Error(
      'Interest rate must be a number between 0 and 1 (e.g. 0.0624 for 6.24%).',
    )
  }
  return num
}

function liabilityToForm(liability) {
  if (!liability) return { ...DEFAULTS }
  return {
    name: liability.name ?? '',
    linkedPropertyId: liability.linkedPropertyId ?? '',
    lender: liability.lender ?? '',
    balanceAUD:
      liability.balanceAUD != null ? String(liability.balanceAUD) : '',
    interestRate:
      liability.interestRate != null ? String(liability.interestRate) : '',
    type: liability.type ?? 'mortgage',
  }
}

export function LiabilityForm({ open, liability, uid, onClose, onSaved }) {
  if (!open) return null

  return (
    <LiabilityFormDialog
      key={liability?.id ?? 'new'}
      liability={liability}
      uid={uid}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

function LiabilityFormDialog({ liability, uid, onClose, onSaved }) {
  const [form, setForm] = useState(() => liabilityToForm(liability))
  const [properties, setProperties] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const isEdit = Boolean(liability?.id)

  useEffect(() => {
    if (!uid) {
      queueMicrotask(() => setProperties([]))
      return undefined
    }

    let cancelled = false
    listProperties(uid)
      .then((list) => {
        if (!cancelled) setProperties(list)
      })
      .catch(() => {
        if (!cancelled) setProperties([])
      })

    return () => {
      cancelled = true
    }
  }, [uid])

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const name = form.name.trim()
    if (!name) {
      setError('Liability name is required.')
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
      setError('You must be signed in to save a liability.')
      return
    }

    const payload = {
      name,
      linkedPropertyId: form.linkedPropertyId || null,
      lender: form.lender.trim(),
      balanceAUD,
      interestRate,
      type: form.type,
    }

    setSaving(true)
    try {
      if (isEdit) {
        await updateLiability(uid, liability.id, payload)
      } else {
        await createLiability(uid, payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err?.message ?? 'Failed to save liability.')
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
        aria-labelledby="liability-form-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-800/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30"
      >
        <h3
          id="liability-form-title"
          className="text-lg font-semibold tracking-tight text-white"
        >
          {isEdit ? 'Edit liability' : 'Add liability'}
        </h3>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="liability-name" className={labelClass}>
              Name
            </label>
            <input
              id="liability-name"
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
              className={inputClass}
              placeholder="Walker St mortgage"
            />
          </div>

          <div>
            <label htmlFor="liability-linked-property" className={labelClass}>
              Linked property
            </label>
            <select
              id="liability-linked-property"
              value={form.linkedPropertyId}
              onChange={(e) => setField('linkedPropertyId', e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="liability-lender" className={labelClass}>
              Lender
            </label>
            <input
              id="liability-lender"
              type="text"
              value={form.lender}
              onChange={(e) => setField('lender', e.target.value)}
              className={inputClass}
              placeholder="CBA"
            />
          </div>

          <div>
            <label htmlFor="liability-type" className={labelClass}>
              Type
            </label>
            <select
              id="liability-type"
              value={form.type}
              onChange={(e) => setField('type', e.target.value)}
              className={inputClass}
            >
              {LIABILITY_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="liability-balance" className={labelClass}>
                Balance (AUD)
              </label>
              <input
                id="liability-balance"
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
              <label htmlFor="liability-rate" className={labelClass}>
                Interest rate (0–1)
              </label>
              <input
                id="liability-rate"
                type="number"
                min="0"
                max="1"
                step="0.0001"
                value={form.interestRate}
                onChange={(e) => setField('interestRate', e.target.value)}
                className={inputClass}
                placeholder="0.0624"
              />
              <p className="mt-1 text-xs text-slate-600">
                e.g. 0.0624 for 6.24%
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
                  : 'Add liability'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
