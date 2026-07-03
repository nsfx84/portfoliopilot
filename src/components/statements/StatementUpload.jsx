import { useCallback, useRef, useState } from 'react'
import { uploadStatement, validateStatementPdf } from '../../lib/statementService.js'
import { triggerParse } from '../../lib/parseClient.js'

function PhaseIcon({ phase }) {
  if (phase === 'uploading' || phase === 'parsing') {
    return (
      <svg
        className="h-4 w-4 animate-spin text-sky-400"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    )
  }
  if (phase === 'done') {
    return (
      <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  return (
    <svg className="h-4 w-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

const PHASE_LABEL = {
  uploading: 'Uploading…',
  parsing: 'Parsing…',
  done: 'Done',
  error: 'Failed',
}

export function StatementUpload({ uid }) {
  const [dragActive, setDragActive] = useState(false)
  const [jobs, setJobs] = useState([])
  const inputRef = useRef(null)

  function addJob(filename) {
    const id = crypto.randomUUID()
    setJobs((prev) => [...prev, { id, filename, phase: 'uploading', error: null }])
    return id
  }

  function updateJob(id, patch) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  function dismissJob(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }

  function clearFinished() {
    setJobs((prev) => prev.filter((j) => j.phase === 'uploading' || j.phase === 'parsing'))
  }

  const processFiles = useCallback(
    async (files) => {
      const pdfs = files.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      )
      if (!pdfs.length) return

      await Promise.all(
        pdfs.map(async (file) => {
          const jobId = addJob(file.name)
          try {
            validateStatementPdf(file)
            const { statementId, storagePath } = await uploadStatement(uid, file)
            updateJob(jobId, { phase: 'parsing' })
            await triggerParse(uid, statementId, storagePath)
            updateJob(jobId, { phase: 'done' })
          } catch (err) {
            updateJob(jobId, {
              phase: 'error',
              error: err?.message || 'Upload failed',
            })
          }
        }),
      )
    },
    [uid],
  )

  function handleDrop(e) {
    e.preventDefault()
    setDragActive(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  function handleDragOver(e) {
    e.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false)
  }

  function handleInputChange(e) {
    processFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  const finishedCount = jobs.filter(
    (j) => j.phase === 'done' || j.phase === 'error',
  ).length

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
          dragActive
            ? 'border-sky-500 bg-sky-500/10 text-sky-300'
            : 'border-slate-700 bg-slate-800/35 text-slate-400 hover:border-slate-600 hover:text-slate-300',
        ].join(' ')}
        aria-label="Upload PDF statements"
      >
        <svg
          className="h-10 w-10 opacity-60"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <div>
          <p className="text-sm font-medium">
            Drop PDF statements here or{' '}
            <span className="text-sky-400 underline underline-offset-2">browse</span>
          </p>
          <p className="mt-1 text-xs opacity-60">PDF only · 10 MB max per file · multiple files supported</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="sr-only"
        onChange={handleInputChange}
        tabIndex={-1}
      />

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-800/35 px-4 py-3"
            >
              <PhaseIcon phase={job.phase} />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                {job.filename}
              </span>
              <span
                className={[
                  'shrink-0 text-xs font-medium',
                  job.phase === 'done' ? 'text-emerald-400' : '',
                  job.phase === 'error' ? 'text-rose-400' : '',
                  job.phase === 'uploading' || job.phase === 'parsing'
                    ? 'text-sky-400'
                    : '',
                ].join(' ')}
              >
                {PHASE_LABEL[job.phase]}
              </span>
              {job.error && (
                <span
                  className="max-w-[200px] truncate text-xs text-rose-300"
                  title={job.error}
                >
                  {job.error}
                </span>
              )}
              {(job.phase === 'done' || job.phase === 'error') && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    dismissJob(job.id)
                  }}
                  className="ml-1 shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-300"
                  aria-label="Dismiss"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {finishedCount > 1 && (
            <button
              type="button"
              onClick={clearFinished}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  )
}
