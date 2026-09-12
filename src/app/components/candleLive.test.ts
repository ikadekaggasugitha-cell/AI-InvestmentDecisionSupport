import { describe, it, expect } from 'vitest'
import { mergeLiveBar, wibDateString } from './candleLive'
import type { OHLCVCandle } from '../hooks/useTechnicals'

const TODAY = '2026-08-21'

function bar(overrides: Partial<OHLCVCandle> = {}): OHLCVCandle {
  return { time: TODAY, open: 100, high: 110, low: 90, close: 105, volume: 1000, ...overrides }
}

describe('mergeLiveBar', () => {
  it("moves close and extends the high when the tick prints above the day's high", () => {
    const merged = mergeLiveBar(bar(), 115, TODAY)
    expect(merged).toEqual(bar({ high: 115, close: 115 }))
  })

  it("extends the low when the tick prints below the day's low", () => {
    const merged = mergeLiveBar(bar(), 85, TODAY)
    expect(merged).toEqual(bar({ low: 85, close: 85 }))
  })

  it('leaves high/low untouched for an in-range tick, moving only the close', () => {
    const merged = mergeLiveBar(bar(), 102, TODAY)
    expect(merged).toEqual(bar({ close: 102 }))
  })

  it('never mutates the open — the session open is fixed once set', () => {
    expect(mergeLiveBar(bar(), 130, TODAY)?.open).toBe(100)
  })

  it("returns null when the last bar is a prior session — a closed bar must not move", () => {
    expect(mergeLiveBar(bar({ time: '2026-08-20' }), 115, TODAY)).toBeNull()
  })

  it('returns null for a missing bar or a non-positive / non-finite price', () => {
    expect(mergeLiveBar(undefined, 115, TODAY)).toBeNull()
    expect(mergeLiveBar(bar(), 0, TODAY)).toBeNull()
    expect(mergeLiveBar(bar(), -5, TODAY)).toBeNull()
    expect(mergeLiveBar(bar(), Number.NaN, TODAY)).toBeNull()
  })
})

describe('wibDateString', () => {
  it('formats a fixed instant as the WIB (UTC+7) calendar day', () => {
    // 2026-08-21 00:30 UTC is 07:30 WIB — the same day.
    expect(wibDateString(new Date('2026-08-21T00:30:00Z'))).toBe('2026-08-21')
  })

  it('rolls to the next day for a late-UTC instant that is already tomorrow in WIB', () => {
    // 2026-08-20 18:00 UTC is 2026-08-21 01:00 WIB.
    expect(wibDateString(new Date('2026-08-20T18:00:00Z'))).toBe('2026-08-21')
  })
})
