import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { deleteStatement } from '../../lib/statementService.js'

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 2,
})

function Spinner() {
  return (
    <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function StatusBadge({ status, errorMessage }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25">
        Pending
      </span>
    )
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/25">
        <Spinner />
        Processing
      </span>
    )
  }
  if (status === 'parsed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/25">
        Parsed
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span
        title={errorMessage}
        className="inline-flex max-w-[160px] cursor-help items-center truncate rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/25"
      >
        Error{errorMessage ? `: ${errorMessage}` : ''}
      </span>
    )
  }
  return <span className="text-slate-500">—</span>
}

export function StatementList({ uid }) {
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(new Set())
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    if (!uid || !db) return
    const q = query(
      collection(db, 'users', uid, 'statements'),
      orderBy('uploadedAt', 'desc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      setStatements(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [uid])

  async function handleDelete(statementId) {
    setDeleteError(null)
    setDeleting((prev) => new Set(prev).add(statementId))
    try {
      await deleteStatement(uid, statementId)
    } catch (err) {
      setDeleteError(err?.message || 'Delete failed')
      setDeleting((prev) => {
        const next = new Set(prev)
        next.delete(statementId)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner />
        Loading statements…
      </div>
    )
  }

  if (!statements.length) {
    return (
      <p className="text-sm text-slate-500">
        No statements uploaded yet. Drop a PDF above to get started.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {deleteError}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/35 ring-1 ring-slate-700/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-900/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">File</th>
                <th className="px-5 py-3 text-left">Uploaded</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Statement date</th>
                <th className="px-5 py-3 text-right">Transactions</th>
                <th className="px-5 py-3 text-right">Debits</th>
                <th className="px-5 py-3 text-right">Credits</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {statements.map((stmt) => {
                const uploadedAt = stmt.uploadedAt?.toDate?.()
                const uploadedStr = uploadedAt
                  ? uploadedAt.toLocaleDateString('en-AU', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'
                const isDeleting = deleting.has(stmt.id)

                return (
                  <tr key={stmt.id} className="hover:bg-slate-700/20">
                    <td className="max-w-[200px] px-5 py-3">
                      <span
                        className="block truncate font-medium text-slate-100"
                        title={stmt.filename}
                      >
                        {stmt.filename ?? '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">
                      {uploadedStr}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge
                        status={stmt.status}
                        errorMessage={stmt.errorMessage}
                      />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">
                      {stmt.statementDate ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-200">
                      {stmt.status === 'parsed' ? (stmt.transactionCount ?? 0) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-200">
                      {stmt.status === 'parsed' && stmt.totalDebits != null
                        ? aud.format(stmt.totalDebits)
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-200">
                      {stmt.status === 'parsed' && stmt.totalCredits != null
                        ? aud.format(stmt.totalCredits)
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => handleDelete(stmt.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-400 transition-colors hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isDeleting ? (
                          <>
                            <Spinner />
                            Deleting…
                          </>
                        ) : (
                          'Delete'
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
