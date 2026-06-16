import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getNetWorthSummary } from '../lib/netWorthService.js'

/**
 * Fetches aggregated net worth for the signed-in user.
 *
 * @returns {{ data: object | null, loading: boolean, error: Error | null, refetch: () => void }}
 */
export function useNetWorth() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      queueMicrotask(() => {
        setData(null)
        setLoading(false)
        setError(null)
      })
      return undefined
    }

    let cancelled = false
    queueMicrotask(() => {
      setLoading(true)
      setError(null)
    })

    getNetWorthSummary(user.uid)
      .then((summary) => {
        if (!cancelled) {
          setData(summary)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user?.uid, refreshKey])

  return { data, loading, error, refetch }
}
