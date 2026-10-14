import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  authHeaders, apiFetch, onAuthExpired, signalAuthExpired, ENDPOINTS,
} from './api'

describe('authHeaders', () => {
  it('adds no Authorization header', () => {
    // The session is an HttpOnly cookie. There is no token in JavaScript for a
    // cross-site script to read, which is the entire point of the move.
    expect(authHeaders().has('Authorization')).toBe(false)
  })

  it('preserves caller-supplied headers', () => {
    const h = authHeaders({ 'Content-Type': 'application/json' })
    expect(h.get('Content-Type')).toBe('application/json')
  })

  it('never reads a token that used to live in localStorage', () => {
    localStorage.setItem('aidss_token', 'stale')
    expect(authHeaders().has('Authorization')).toBe(false)
  })
})

describe('apiFetch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends credentials so the session cookie survives a cross-origin request', async () => {
    // Without this the browser silently drops the cookie and the request comes
    // back 401, which reads as a broken backend rather than a missing option.
    fetchMock.mockResolvedValue({ status: 200, ok: true })
    await apiFetch('/v1/signals')
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('preserves caller-supplied options', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true })
    await apiFetch('/v1/x', { method: 'POST', body: '{}' })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('broadcasts one auth-expiry event per outage', async () => {
    const handler = vi.fn()
    const off = onAuthExpired(handler)
    fetchMock.mockResolvedValue({ status: 401, ok: false })

    await apiFetch('/v1/signals')
    await apiFetch('/v1/risk')
    await apiFetch('/v1/news')

    expect(handler).toHaveBeenCalledTimes(1)
    off()
  })

  it('leaves the stored token alone — the server owns the cookie', () => {
    // A revoked session is discarded server-side; the client has nothing to clear,
    // and pretending otherwise would hide a real logout.
    localStorage.setItem('aidss_token', 'stale')
    signalAuthExpired()
    expect(localStorage.getItem('aidss_token')).toBe('stale')
    localStorage.clear()
  })

  it('does not signal expiry on a successful request', () => {
    const handler = vi.fn()
    const off = onAuthExpired(handler)
    fetchMock.mockResolvedValue({ status: 200, ok: true })
    return apiFetch('/v1/signals').then(() => {
      expect(handler).not.toHaveBeenCalled()
      off()
    })
  })
})

/**
 * The paywall signal, in a module registry of its own.
 *
 * Both signals latch at module level so one outage is one broadcast rather than
 * one per concurrent request. That state survives between tests in one file, so a
 * test that needs the latch clear has to get a fresh module — the same reason
 * useLiveMarket.test.ts re-imports per case for the build-time offline switch.
 */
describe('apiFetch — the paywall signal', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  const loadApi = async () => import('./api')

  it('broadcasts one paywall event per outage, not one per request', async () => {
    // Eight hooks ask for paid data on first paint. One refusal is one fact about
    // the account, and eight toasts saying so would be a different lie.
    const { apiFetch, onPaywalled } = await loadApi()
    const handler = vi.fn()
    const off = onPaywalled(handler)
    fetchMock.mockResolvedValue({ status: 402, ok: false })

    await apiFetch('/v1/signals')
    await apiFetch('/v1/risk')
    await apiFetch('/v1/portfolio')
    await apiFetch('/v1/technicals/ohlcv')

    expect(handler).toHaveBeenCalledTimes(1)
    off()
  })

  it('lets the paywall signal fire again after a request succeeds', async () => {
    // Otherwise the latch from one locked period would silence every later one.
    const { apiFetch, onPaywalled } = await loadApi()
    const handler = vi.fn()
    const off = onPaywalled(handler)
    fetchMock.mockResolvedValueOnce({ status: 402, ok: false })
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true })
    fetchMock.mockResolvedValueOnce({ status: 402, ok: false })

    await apiFetch('/v1/signals')
    await apiFetch('/v1/news')
    await apiFetch('/v1/signals')

    expect(handler).toHaveBeenCalledTimes(2)
    off()
  })

  it('keeps the two signals apart: a refusal must not read as an expired session', async () => {
    const { apiFetch, onAuthExpired, onPaywalled } = await loadApi()
    const auth = vi.fn()
    const paywall = vi.fn()
    const offAuth = onAuthExpired(auth)
    const offPaywall = onPaywalled(paywall)

    fetchMock.mockResolvedValue({ status: 402, ok: false })
    await apiFetch('/v1/signals')

    expect(paywall).toHaveBeenCalledTimes(1)
    expect(auth).not.toHaveBeenCalled()

    offAuth()
    offPaywall()
  })

  it('lets the session signal fire again after a request succeeds', async () => {
    // Same latch, opposite direction, for the same reason.
    const { apiFetch, onAuthExpired } = await loadApi()
    const handler = vi.fn()
    const off = onAuthExpired(handler)
    fetchMock.mockResolvedValueOnce({ status: 401, ok: false })
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true })
    fetchMock.mockResolvedValueOnce({ status: 401, ok: false })

    await apiFetch('/v1/signals')
    await apiFetch('/v1/news')
    await apiFetch('/v1/signals')

    expect(handler).toHaveBeenCalledTimes(2)
    off()
  })

  it('returns the refusal untouched so each hook can still react locally', async () => {
    // The event is for the shell. The hook that made the call still needs to know
    // what came back, and rewriting the response would take that from it.
    const { apiFetch, onPaywalled } = await loadApi()
    const off = onPaywalled(vi.fn())
    const response = { status: 402, ok: false, body: 'refused' }
    fetchMock.mockResolvedValue(response)

    expect(await apiFetch('/v1/signals')).toBe(response)
    off()
  })

  it('does not fire the paywall signal for a 403 that is not about payment', async () => {
    // A blocked account and a non-admin are both 403. Firing here told a banned
    // person to check their billing.
    const { apiFetch, onPaywalled } = await loadApi()
    const handler = vi.fn()
    const off = onPaywalled(handler)
    fetchMock.mockResolvedValue({ status: 403, ok: false })

    await apiFetch('/v1/admin/accounts')

    expect(handler).not.toHaveBeenCalled()
    off()
  })

  it('does not signal the paywall on a successful request', async () => {
    const { apiFetch, onPaywalled } = await loadApi()
    const handler = vi.fn()
    const off = onPaywalled(handler)
    fetchMock.mockResolvedValue({ status: 200, ok: true })

    await apiFetch('/v1/signals')

    expect(handler).not.toHaveBeenCalled()
    off()
  })
})

describe('endpoints', () => {
  it('has no websocket token path left in the url', () => {
    expect(ENDPOINTS.marketSocket).not.toContain('token')
  })
})