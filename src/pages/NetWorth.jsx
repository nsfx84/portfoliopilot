import { CashAccountList } from '../components/networth/CashAccountList.jsx'
import { LiabilityList } from '../components/networth/LiabilityList.jsx'
import { PropertyList } from '../components/networth/PropertyList.jsx'
import { useNetWorth } from '../hooks/useNetWorth.js'

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(value, loading) {
  if (loading) return '…'
  if (value == null || Number.isNaN(value)) return '—'
  return aud.format(value)
}

function SummaryCard({ label, primary, primaryClass, hint, loading }) {
  return (
    <div
      className={`rounded-2xl border border-slate-700/80 bg-slate-800/70 p-5 shadow-lg shadow-black/40 ring-1 ring-slate-600/30 ${loading ? 'animate-pulse' : ''}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-3 text-3xl font-semibold tracking-tight tabular-nums ${primaryClass ?? 'text-white'}`}
      >
        {primary}
      </p>
      {hint ? (
        <p className="mt-3 text-xs leading-snug text-slate-600">{hint}</p>
      ) : null}
    </div>
  )
}

export function NetWorth() {
  const { data, loading, error, refetch } = useNetWorth()

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-col gap-1 border-b border-slate-800 pb-6">
          <h2 className="text-xl font-semibold tracking-tight text-white">
            Net worth
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
            {loading
              ? 'Calculating your household net worth…'
              : 'Assets minus liabilities across property, cash, portfolio, and debt — all in AUD.'}
          </p>
          {error ? (
            <p className="text-xs text-rose-400/90">
              Could not load net worth: {error.message}
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Total assets"
            primary={formatAud(data?.totalAssets, loading)}
            hint="Property · cash · stocks · crypto"
            loading={loading}
          />
          <SummaryCard
            label="Total liabilities"
            primary={formatAud(data?.totalLiabilities, loading)}
            primaryClass="text-rose-300"
            hint="Mortgages · loans · credit"
            loading={loading}
          />
          <SummaryCard
            label="Net worth"
            primary={formatAud(data?.netWorth, loading)}
            primaryClass={
              !loading && data?.netWorth != null && data.netWorth >= 0
                ? 'text-emerald-300'
                : 'text-white'
            }
            hint="Total assets − total liabilities"
            loading={loading}
          />
          <SummaryCard
            label="Liquid wealth"
            primary={formatAud(data?.liquid, loading)}
            primaryClass="text-sky-300"
            hint="Cash · listed stocks · crypto"
            loading={loading}
          />
        </div>
      </section>

      <PropertyList onNetWorthChange={refetch} />

      <CashAccountList onNetWorthChange={refetch} />

      <LiabilityList onNetWorthChange={refetch} />
    </div>
  )
}
