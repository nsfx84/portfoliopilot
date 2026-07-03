import { useAuth } from '../contexts/AuthContext.jsx'
import { StatementList } from '../components/statements/StatementList.jsx'
import { StatementUpload } from '../components/statements/StatementUpload.jsx'

export function Statements() {
  const { user } = useAuth()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Statements
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Upload PDF bank or credit card statements. Transactions are extracted
          and auto-categorised — limit 50 statements per month.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/80 bg-slate-800/35 p-6 shadow-xl ring-1 ring-slate-700/40">
        <h3 className="mb-4 text-sm font-semibold text-slate-100">
          Upload new statement
        </h3>
        <StatementUpload uid={user.uid} />
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold text-slate-100">
          Uploaded statements
        </h3>
        <StatementList uid={user.uid} />
      </div>
    </div>
  )
}
