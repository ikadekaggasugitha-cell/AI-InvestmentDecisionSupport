import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'

/**
 * The operator's payment queue: declared transfers and gateway rows, read and
 * adjudicated.
 *
 * This is the screen the money flow has been waiting for. `approve` and `deny`
 * have existed in `backend/api/routers/admin/transactions.py` with a full test
 * suite since the payment work landed, and nothing on screen has ever called
 * them — a transfer could arrive, sit in the table, and be invisible to the one
 * person able to act on it.
 *
 * Three shapes this hook deliberately keeps distinct, because collapsing them
 * would be the bug:
 *
 *  - `null` rows means the queue was never successfully read. `[]` means the
 *    server says there is genuinely nothing in this working set. Rendering an
 *    empty table for the first tells an operator whose queue is full that it is
 *    empty (`AdminView.tsx`'s account list already refuses to do this).
 *  - Statuses are the server's words — `pending`, `settlement`, `expire`,
 *    `deny`, `cancel`. `usePayments.ts` states the rule: a client that
 *    translated them would be a second place deciding what they mean.
 *  - An action's failure is a *cause*, not a string. 409, 404, 422, 503 and an
 *    unreachable server need different sentences on screen, because they tell
 *    the operator different things about the money (ADR-0009's one-cause-per-
 *    code rule, aimed here at the response rather than the request).
 */

/** The working sets the queue endpoint accepts. `all` means exactly that. */
export type QueueStatus = 'pending' | 'settlement' | 'expire' | 'deny' | 'cancel' | 'all'

/**
 * Rows per page. The endpoint used to answer with up to 200 and no way to ask
 * for the next hundred, so a queue longer than one page was silently shorter on
 * screen than it was in the table.
 */
export const QUEUE_PAGE_SIZE = 50

/**
 * Rows the export asks for. The server holds the real ceiling and cuts the file
 * short itself, saying so on its last line; asking for more than it will give
 * would just be a request that cannot be honoured.
 */
export const QUEUE_EXPORT_LIMIT = 5000

export const QUEUE_STATUSES: readonly QueueStatus[] = [
  'pending',
  'expire',
  'settlement',
  'deny',
  'cancel',
  'all',
]

/**
 * One row of the admin queue: the server's shape, renamed nowhere.
 *
 * `notes` is the record left on the row — the payer's declaration plus an
 * administrator's refusal reason when one exists. It is the only evidence this
 * install keeps: `proof_image_url` is deliberately never populated (ADR-0011),
 * so there is no receipt to preview and no field for one here.
 */
export interface AdminQueueRow {
  id: string
  invoiceCode: string
  amount: number
  plan: string
  paymentGateway: string
  paymentMethod: string
  status: string
  notes: string | null
  /** The destination a declared transfer says it went to, as the server composed
   *  it. What separates two pending rows that otherwise read identically. */
  destination: string | null
  payerEmail: string | null
  createdAt: string
  updatedAt: string | null
  // When the money was accepted. Only settled rows have one, and the CSV export
  // carries the same column, so the screen reads it too.
  approvedAt: string | null
  subscriptionId: string | null
  expiresAt: string | null
}

/** What an approve actually bought, read back from the server. */
export interface GrantedPeriod {
  subscriptionId: string
  expiresAt: string
}

/**
 * What an adjudication just did, in the operator's terms.
 *
 * Both halves of the decision carry an outcome, and the queue used to say so for
 * only one of them: approving raised a banner naming the date the access ends,
 * denying raised nothing at all. The operator was left reading a row that simply
 * disappeared, which looks identical to a page that reloaded. A refusal is as
 * much a state change as an approval — it writes `deny` and records the reason on
 * the row — so it gets its own sentence.
 *
 * Neither variant claims the payer was told. Whether a queued email went out is
 * the worker's answer, not this screen's.
 */
export type QueueOutcome =
  | { kind: 'approved'; invoiceCode: string; expiresAt: string }
  | { kind: 'denied'; invoiceCode: string; reason: string }

/**
 * Why an adjudication did not happen, in the causes the UI can name.
 *
 * `conflict` is the interesting one and it cuts both ways: approve refuses a row
 * already settled or denied, and deny refuses a settled row because refusing
 * evidence cannot retroactively revoke access the period already granted. Both
 * mean "the row is not in the state you thought", which is a different sentence
 * from "the server is down".
 */
export type QueueActionFailure = 'conflict' | 'gone' | 'refused' | 'unavailable' | 'network'

export type QueueActionResult =
  | { ok: true; granted?: GrantedPeriod }
  | { ok: false; failure: QueueActionFailure; detail: string | null }

type QueueRejection = { ok: false; failure: QueueActionFailure; detail: string | null }

async function failureOf(res: Response): Promise<QueueRejection> {
  // The server's own sentence travels with the code where it sent one; the UI
  // shows it rather than paraphrasing, because it is the authority on why.
  let detail: string | null = null
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
  } catch {
    /* An error body that is not JSON says nothing more than the code does. */
  }
  const failure: QueueActionFailure =
    res.status === 409
      ? 'conflict'
      : res.status === 404
        ? 'gone'
        : res.status === 422
          ? 'refused'
          : 'unavailable'
  return { ok: false, failure, detail }
}

export function usePaymentQueue(status: QueueStatus, offset = 0) {
  const [rows, setRows] = useState<AdminQueueRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Exactly one row may be busy: an operator who clicks twice on two rows must
  // not see both looking like they are working.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<QueueOutcome | null>(null)
  const [failure, setFailure] = useState<{
    failure: QueueActionFailure
    detail: string | null
  } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // A quiet re-read keeps the rows on screen, so `loading` stays false during
  // it and the refresh button would give no answer to the click. This flag is
  // the fact the icon spins on: a read is in flight, whether the table shows
  // rows under it or not.
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  // Mirrors `rows` so an action can name the invoice it decided without `rows`
  // becoming a dependency of the callback. The banner appears after a re-read,
  // by which time the row may have left this filter — the invoice code has to be
  // taken before the read, not after.
  const rowsRef = useRef<AdminQueueRow[] | null>(null)

  const invoiceOf = (id: string): string =>
    (rowsRef.current ?? []).find((r) => r.id === id)?.invoiceCode ?? ''

  /**
   * `quiet` keeps the current rows on screen while the fresh list is fetched —
   * used after an action, where blanking the table would make the row the
   * operator just adjudicated vanish and reappear. A status change is never
   * quiet: the rows on screen belong to a different question.
   */
  const read = useCallback(
    async (quiet = false): Promise<boolean> => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      if (!quiet) setRows(null)
      setRefreshing(true)
      try {
        const res = await apiFetch(
          `${ENDPOINTS.adminTransactions}?status=${status}&limit=${QUEUE_PAGE_SIZE}&offset=${offset}`,
          { signal: controller.signal },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as {
          transactions?: AdminQueueRow[]
          hasMore?: boolean
        }
        if (controller.signal.aborted) return true
        setRows(Array.isArray(body.transactions) ? body.transactions : [])
        rowsRef.current = Array.isArray(body.transactions) ? body.transactions : []
        setHasMore(body.hasMore === true)
        setError(null)
        return true
      } catch {
        if (controller.signal.aborted) return true
        setError('network')
        if (!quiet) setRows(null)
        return false
      } finally {
        // Only the read that still owns the slot may stop the spin: an aborted
        // predecessor would otherwise clear the flag while its replacement is
        // still in flight.
        if (inFlight.current === controller) setRefreshing(false)
      }
    },
    [status, offset],
  )

  useEffect(() => {
    void read()
    return () => inFlight.current?.abort()
  }, [read])

  /**
   * Approve, then re-read. The row on screen after the action is the server's
   * row, not the one this client predicted — the granted period comes from the
   * response, and the expiry from the database, never from a client-side
   * `now + 30 days`.
   */
  const approve = useCallback(
    async (id: string): Promise<QueueActionResult> => {
      setBusyId(id)
      setResult(null)
      setFailure(null)
      try {
        const res = await apiFetch(`${ENDPOINTS.adminTransactions}/${id}/approve`, {
          method: 'POST',
        })
        if (!res.ok) {
          const failed = await failureOf(res)
          setFailure({ failure: failed.failure, detail: failed.detail })
          // Even a refusal may have moved the row (a race with the beat that
          // expires rows), so the table re-reads rather than trusting its copy.
          await read(true)
          return failed
        }
        const body = (await res.json()) as {
          subscriptionId?: string
          subscriptionExpiresAt?: string
        }
        const granted: GrantedPeriod = {
          subscriptionId: body.subscriptionId ?? '',
          expiresAt: body.subscriptionExpiresAt ?? '',
        }
        setResult({
          kind: 'approved',
          invoiceCode: invoiceOf(id),
          expiresAt: granted.expiresAt,
        })
        await read(true)
        return { ok: true, granted }
      } catch {
        setFailure({ failure: 'network', detail: null })
        return { ok: false, failure: 'network', detail: null }
      } finally {
        setBusyId(null)
      }
    },
    [read],
  )

  const deny = useCallback(
    async (id: string, reason: string): Promise<QueueActionResult> => {
      setBusyId(id)
      setResult(null)
      setFailure(null)
      try {
        const res = await apiFetch(`${ENDPOINTS.adminTransactions}/${id}/deny`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        })
        if (!res.ok) {
          const failed = await failureOf(res)
          setFailure({ failure: failed.failure, detail: failed.detail })
          await read(true)
          return failed
        }
        // Taken before the re-read, because the re-read is what removes this row
        // from the pending filter — afterwards there would be no invoice to name.
        const invoiceCode = invoiceOf(id)
        await read(true)
        setResult({ kind: 'denied', invoiceCode, reason })
        return { ok: true }
      } catch {
        setFailure({ failure: 'network', detail: null })
        return { ok: false, failure: 'network', detail: null }
      } finally {
        setBusyId(null)
      }
    },
    [read],
  )

  const clearResult = useCallback(() => {
    setResult(null)
    setFailure(null)
  }, [])

  /**
   * Download the selected working set as CSV.
   *
   * Fetched through `apiFetch` and turned into a blob rather than pointed at
   * with a plain link, because on a 403 or a 503 the server answers with JSON
   * and a link would navigate the operator out of the console into a raw error
   * body. This way the failure can be said where it happened.
   *
   * The whole selected status is exported, not the page on screen: an operator
   * reconciling a month of transfers does not want the fifty rows they can see.
   */
  const exportCsv = useCallback(async (): Promise<boolean> => {
    setExporting(true)
    setExportError(null)
    try {
      const res = await apiFetch(
        `${ENDPOINTS.adminTransactionsExport}?status=${status}&limit=${QUEUE_EXPORT_LIMIT}&offset=0`,
      )
      if (!res.ok) {
        setExportError(String(res.status))
        return false
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `aidss-antrean-${status}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      return true
    } catch {
      setExportError('network')
      return false
    } finally {
      setExporting(false)
    }
  }, [status])

  return {
    /** Null until the first read lands; [] is a fact, null is not yet one. */
    rows,
    loading: rows === null && error === null,
    /** A re-read is in flight, quiet or not. Drives the refresh icon. */
    refreshing,
    error,
    /** Whether rows exist past this page. Without it a full page reads as the
     *  whole queue, which is the mistake this paging exists to stop. */
    hasMore,
    busyId,
    result,
    failure,
    clearResult,
    approve,
    deny,
    exporting,
    exportError,
    clearExportError: () => setExportError(null),
    exportCsv,
    reload: read,
  }
}
