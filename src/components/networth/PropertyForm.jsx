import { useState } from 'react'
import {
  createProperty,
  updateProperty,
} from '../../lib/netWorthService.js'

const inputClass =
  'w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-slate-600 placeholder:text-slate-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/40'

const labelClass =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500'

const PROPERTY_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
]

const COUNTRIES = [
  { value: 'AU', label: 'Australia (AU)' },
  { value: 'MY', label: 'Malaysia (MY)' },
]

const OWNERSHIP_OPTIONS = [
  { value: 'Matterhorn Trust', label: 'Matterhorn Trust' },
  { value: 'joint', label: 'Joint' },
  { value: 'wife', label: 'Wife' },
  { value: 'personal', label: 'Personal' },
]

const DEFAULTS = {
  name: '',
  type: 'residential',
  country: 'AU',
  ownership: 'personal',
  currentValueAUD: '',
  grossRentAUD: '',
  annualCostsAUD: '',
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

function propertyToForm(property) {
  if (!property) return { ...DEFAULTS }
  return {
    name: property.name ?? '',
    type: property.type ?? 'residential',
    country: property.country ?? 'AU',
    ownership: property.ownership ?? 'personal',
    currentValueAUD:
      property.currentValueAUD != null ? String(property.currentValueAUD) : '',
    grossRentAUD:
      property.grossRentAUD != null ? String(property.grossRentAUD) : '',
    annualCostsAUD:
      property.annualCostsAUD != null ? String(property.annualCostsAUD) : '',
  }
}

export function PropertyForm({ open, property, uid, onClose, onSaved }) {
  if (!open) return null

  return (
    <PropertyFormDialog
      key={property?.id ?? 'new'}
      property={property}
      uid={uid}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

function PropertyFormDialog({ property, uid, onClose, onSaved }) {
  const [form, setForm] = useState(() => propertyToForm(property))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const isEdit = Boolean(property?.id)

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const name = form.name.trim()
    if (!name) {
      setError('Property name is required.')
      return
    }

    let currentValueAUD
    let grossRentAUD
    let annualCostsAUD
    try {
      currentValueAUD = parseNonNegative(form.currentValueAUD, 'Current value')
      grossRentAUD = parseNonNegative(form.grossRentAUD, 'Gross rent')
      annualCostsAUD = parseNonNegative(form.annualCostsAUD, 'Annual costs')
    } catch (err) {
      setError(err.message)
      return
    }

    if (!uid) {
      setError('You must be signed in to save a property.')
      return
    }

    const payload = {
      name,
      type: form.type,
      country: form.country,
      ownership: form.ownership,
      currentValueAUD,
      grossRentAUD,
      annualCostsAUD,
    }

    setSaving(true)
    try {
      if (isEdit) {
        await updateProperty(uid, property.id, payload)
      } else {
        await createProperty(uid, payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err?.message ?? 'Failed to save property.')
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
        aria-labelledby="property-form-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-800/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30"
      >
        <h3
          id="property-form-title"
          className="text-lg font-semibold tracking-tight text-white"
        >
          {isEdit ? 'Edit property' : 'Add property'}
        </h3>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="property-name" className={labelClass}>
              Name
            </label>
            <input
              id="property-name"
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
              className={inputClass}
              placeholder="Walker St"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="property-type" className={labelClass}>
                Type
              </label>
              <select
                id="property-type"
                value={form.type}
                onChange={(e) => setField('type', e.target.value)}
                className={inputClass}
              >
                {PROPERTY_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="property-country" className={labelClass}>
                Country
              </label>
              <select
                id="property-country"
                value={form.country}
                onChange={(e) => setField('country', e.target.value)}
                className={inputClass}
              >
                {COUNTRIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="property-ownership" className={labelClass}>
              Ownership
            </label>
            <select
              id="property-ownership"
              value={form.ownership}
              onChange={(e) => setField('ownership', e.target.value)}
              className={inputClass}
            >
              {OWNERSHIP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="property-value" className={labelClass}>
                Current value (AUD)
              </label>
              <input
                id="property-value"
                type="number"
                min="0"
                step="1"
                value={form.currentValueAUD}
                onChange={(e) => setField('currentValueAUD', e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="property-rent" className={labelClass}>
                Gross rent (annual)
              </label>
              <input
                id="property-rent"
                type="number"
                min="0"
                step="1"
                value={form.grossRentAUD}
                onChange={(e) => setField('grossRentAUD', e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="property-costs" className={labelClass}>
                Annual costs
              </label>
              <input
                id="property-costs"
                type="number"
                min="0"
                step="1"
                value={form.annualCostsAUD}
                onChange={(e) => setField('annualCostsAUD', e.target.value)}
                className={inputClass}
                placeholder="0"
              />
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
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add property'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
