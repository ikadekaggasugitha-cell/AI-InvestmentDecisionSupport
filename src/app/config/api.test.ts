import { describe, it, expect, beforeEach, vi } from 'vitest'
import { authHeaders, apiFetch, onAuthExpired, signalAuthExpired, ENDPOINTS } from './api'

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

describe('endpoints', () => {
  it('has no websocket token path left in the url', () => {
    expect(ENDPOINTS.marketSocket).not.toContain('token')
  })
})