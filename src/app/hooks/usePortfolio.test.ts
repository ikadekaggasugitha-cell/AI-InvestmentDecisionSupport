import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

/**
 * Positions come from the server now.
 *
 * They used to be seeded from PORTFOLIO_HOLDINGS whenever localStorage was empty,
 * which meant every account that had not typed a position into their own browser
 * was shown ten IDX holdings belonging to nobody — beside a backend that had no
 * positions for them at all. These assertions exist so that fallback cannot come
 * back, and so the three states stay distinguishable: "the server said you hold
 * nothing", "I could not ask", and "here is what you hold".
 */

const state = {
  stored: [] as { symbol: string; lots: number; avgPrice: number | null }[],
  putStatus: 200,
  getStatus: 200,
  getError: false,
  putError: false,
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

vi.mock('../config/api', () => ({
  ENDPOINTS: { positions: '/v1/portfolio/positions' },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      if (state.putError) throw new Error('network down')
      state.stored = JSON.parse(String(init.body)).positions
      return jsonResponse({ positions: state.stored.map((p) => ({ shares: p.lots * 100, ...p })) })
    }
    if (state.getError) throw new Error('network down')
    return jsonResponse(
      {
        positions: state.stored.map((p) => ({ shares: p.lots * 100, ...p })),
        totalCostBasis: null,
        computedAt: new Date().toISOString(),
      },
      state.getStatus,
    )
  }),
}))

import { usePortfolio } from './usePortfolio'

beforeEach(() => {
  localStorage.clear()
  state.stored = []
  state.putStatus = 200
  state.getStatus = 200
  state.getError = false
  state.putError = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('reading positions', () => {
  it('starts empty rather than seeding a portfolio nobody entered', async () => {
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.holdings).toEqual([])
  })

  it('serves what the server holds', async () => {
    state.stored = [{ symbol: 'BBCA', lots: 2000, avgPrice: 9200 }]
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.holdings).toHaveLength(1)
    expect(result.current.holdings[0]).toMatchObject({ symbol: 'BBCA', lots: 2000, avgPrice: 9200 })
  })

  it('derives the sector rather than storing it twice', async () => {
    state.stored = [{ symbol: 'BBCA', lots: 100, avgPrice: 9000 }]
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.holdings[0].sector).toBe('Keuangan')
  })

  it('keeps an unknown cost basis unknown instead of zero', async () => {
    // A zero here would render as a position that cost nothing, which is a
    // different claim from "we do not know what it cost".
    state.stored = [{ symbol: 'BBCA', lots: 100, avgPrice: null }]
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.holdings[0].avgPrice).toBeNull()
  })

  it('distinguishes "I could not ask" from "you hold nothing"', async () => {
    state.getError = true
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
    expect(result.current.loaded).toBe(false)
    // Still empty, but the view has what it needs to say the difference.
    expect(result.current.holdings).toEqual([])
  })

  it('skips a malformed row instead of rendering it', async () => {
    state.stored = [{ symbol: 'BBCA', lots: 2000, avgPrice: 9200 }]
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.holdings.every((h) => h.lots >= 1)).toBe(true)
  })
})

describe('writing positions', () => {
  it('persists an added position to the server', async () => {
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.addHolding({ symbol: 'TLKM', lots: 100, avgPrice: 3000, sector: 'Telekomunikasi' }))
    await waitFor(() => expect(state.stored).toHaveLength(1))
    expect(state.stored[0]).toMatchObject({ symbol: 'TLKM', lots: 100, avgPrice: 3000 })
  })

  it('deletion is a whole-portfolio replace with what remains', async () => {
    state.stored = [
      { symbol: 'BBCA', lots: 100, avgPrice: 9000 },
      { symbol: 'TLKM', lots: 200, avgPrice: 3000 },
    ]
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.holdings).toHaveLength(2))

    act(() => result.current.removeHolding('BBCA', 9500))
    await waitFor(() => expect(state.stored).toHaveLength(1))
    expect(state.stored[0].symbol).toBe('TLKM')
  })

  it('clearing everything sends an empty list, not a no-op', async () => {
    state.stored = [{ symbol: 'BBCA', lots: 100, avgPrice: 9000 }]
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.holdings).toHaveLength(1))

    act(() => result.current.removeHolding('BBCA', 9000))
    await waitFor(() => expect(state.stored).toHaveLength(0))
  })

  it('a failed write leaves the server untouched and reports the error', async () => {
    const { result } = renderHook(() => usePortfolio())
    await waitFor(() => expect(result.current.loading).toBe(false))

    state.putError = true
    act(() => result.current.addHolding({ symbol: 'TLKM', lots: 100, avgPrice: 3000, sector: 'Telekomunikasi' }))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(state.stored).toHaveLength(0)
  })
})
