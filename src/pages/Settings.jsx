import { isFirebaseConfigured } from '../lib/firebase'

export function Settings() {
  const configured = isFirebaseConfigured()

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="text-lg font-semibold text-white">Settings</h2>
      <p className="mt-2 text-sm text-slate-500">
        Firebase Auth & Firestore rules, broker CSV imports, and tax presets will
        land here.
      </p>
      <div
        className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
          configured
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            : 'border-slate-700 bg-slate-950/60 text-slate-400'
        }`}
      >
        Firebase:{' '}
        {configured
          ? 'Environment variables detected (client can initialise app).'
          : 'Not configured — set VITE_FIREBASE_* variables in `.env.local`.'}
      </div>
    </div>
  )
}
