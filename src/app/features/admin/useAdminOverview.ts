import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'

/**
 * The console's overview read, in one place.
 *
 * It lives here rather than inside `AdminDashboardView` because two surfaces need
 * the same numbers: the overview panel shows all of them, and the shell's
 * notification badge shows only `pendingQueue`. One fetch, one state, so the badge
 * can never drift from the panel it summarizes. The shell calls it once and passes
 * the result down.
 *
 * The three states are kept apart on purpose: a refused read (403), a read that
 * failed (503 / unreachable), and a real answer of zeros mean opposite things, and
 * collapsing them is how a broken database hides behind a calm-looking dashboard.
 */

export interface OverviewFigures {
  revenueToday: number
  revenueLast30Days: number
  revenueTotal: number
  mrrRunRate: number
  settledLast30Days: number
  pendingQueue: number
  expiredQueue: number
  activeSubscribers: number
  churnedSubscribers: number
}

export type OverviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; figures: OverviewFigures }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

export function useAdminOverview(pollMs = 0) {
  const [state, setState] = useState<OverviewState>({ kind: 'loading' })
  const inFlight = useRef<AbortController | null>(null)
  // A read in flight, silent or not. `state` cannot say this: during a quiet
  // refresh it stays `ready` on purpose, and the reload button needs the fact
  // the icon spins on even then.
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    // A silent refresh keeps the old figures on screen while the new ones are
    // in flight. The shell polls on a timer; flashing the whole dashboard back
    // to a skeleton every minute is not a refresh, it is a flicker.
    if (!opts?.silent) setState({ kind: 'loading' })
    setRefreshing(true)
    try {
      const res = await apiFetch(ENDPOINTS.adminOverview, { signal: controller.signal })
      if (res.status === 403) {
        setState({ kind: 'forbidden' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const figures = (await res.json()) as OverviewFigures
      if (controller.signal.aborted) return
      setState({ kind: 'ready', figures })
    } catch {
      if (controller.signal.aborted) return
      setState({ kind: 'unavailable' })
    } finally {
      // Only the read that still owns the slot may stop the spin, so an
      // aborted predecessor cannot clear the flag of its replacement.
      if (inFlight.current === controller) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => inFlight.current?.abort()
  }, [load])

  useEffect(() => {
    if (pollMs <= 0) return
    const id = window.setInterval(() => {
      // A hidden tab is not an operator waiting for news; do not spend the
      // rate limit on a screen nobody is looking at.
      if (document.hidden) return
      void load({ silent: true })
    }, pollMs)
    return () => window.clearInterval(id)
  }, [pollMs, load])

  return {
    state,
    reload: load,
    /** A read is in flight, quiet or not. Drives the refresh icon. */
    refreshing,
  }
}
