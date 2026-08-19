import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { authToken, authHeaders, apiFetch, onAuthExpired, signalAuthExpired, AUTH_EXPIRED_EVENT, ENDPOINTS } from './api'

describe('authToken', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no token is configured', () => {
    expect(authToken()).toBeNull()
  })

  it('reads a token from localStorage', () => {
    localStorage.setItem('aidss_token', 'abc123')
    expect(authToken()).toBe('abc123')
  })
})

describe('authHeaders', () => {
  beforeEach(() => localStorage.clear())

  it('omits Authorization when there is no token', () => {
    expect(authHeaders().has('Authorization')).toBe(false)
  })

  it('attaches a bearer token when present', () => {
    localStorage.setItem('aidss_token', 'tok')
    expect(authHeaders().get('Authorization')).toBe('Bearer tok')
  })

  it('preserves caller-supplied headers', () => {
    localStorage.setItem('aidss_token', 'tok')
    const h = authHeaders({ 'Content-Type': 'application/json' })
    expect(h.get('Content-Type')).toBe('application/json')
    expect(h.get('Authorization')).toBe('Bearer tok')
  })
})

describe('apiFetch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends no Authorization header in bypass-mode dev (no token)', async () => {
    await apiFetch(ENDPOINTS.signals)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Headers).has('Authorization')).toBe(false)
  })

  it('injects the bearer token when one is stored', async () => {
    localStorage.setItem('aidss_token', 'live-token')
    await apiFetch(ENDPOINTS.signals)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer live-token')
  })

  it('passes through method and body', async () => {
    await apiFetch(ENDPOINTS.advisorChat, { method: 'POST', body: '{"a":1}' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
  })
})

describe('ENDPOINTS', () => {
  it('builds parameterised URLs', () => {
    expect(ENDPOINTS.broksum('BBCA')).toContain('/v1/broksum/BBCA')
    expect(ENDPOINTS.news(5, 3)).toContain('limit=5')
    expect(ENDPOINTS.news(5, 3)).toContain('daysBack=3')
  })
})

describe('apiFetch — 401 handling', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('clears the stored token and fires auth-expired once on 401', async () => {
    localStorage.setItem('aidss_token', 'expired')
    const handler = vi.fn()
    const off = onAuthExpired(handler)

    // A recovering 200 first releases the dedupe latch from any prior test.
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await apiFetch(ENDPOINTS.signals)

    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }))
    await apiFetch(ENDPOINTS.signals)
    await apiFetch(ENDPOINTS.signals) // concurrent-style second 401

    expect(localStorage.getItem('aidss_token')).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1) // deduped
    off()
  })

  it('returns the response unchanged so hooks keep their fallback path', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    const res = await apiFetch(ENDPOINTS.signals)
    expect(res.status).toBe(401)
    expect(AUTH_EXPIRED_EVENT).toBe('aidss:auth-expired')
  })

  it('signalAuthExpired clears the token and fires the event (WS 1008 path)', async () => {
    // Recover the dedupe latch first so this assertion is order-independent.
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await apiFetch(ENDPOINTS.signals)

    localStorage.setItem('aidss_token', 'ws-token')
    const handler = vi.fn()
    const off = onAuthExpired(handler)
    signalAuthExpired()
    expect(localStorage.getItem('aidss_token')).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
    off()
  })
})
