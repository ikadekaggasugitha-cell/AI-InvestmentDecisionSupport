import { describe, it, expect } from 'vitest'
import { fmtIdr, fmtAmount } from './formatting'

describe('fmtIdr', () => {
  it('uses trillion (T) suffix at and above 1e12', () => {
    expect(fmtIdr(1e12)).toBe('Rp 1.00T')
    expect(fmtIdr(2.5e12)).toBe('Rp 2.50T')
  })

  it('uses billion (M) suffix between 1e9 and 1e12', () => {
    expect(fmtIdr(1e9)).toBe('Rp 1.0M')
    expect(fmtIdr(9.99e11)).toBe('Rp 999.0M')
  })

  it('uses million (Jt) suffix between 1e6 and 1e9', () => {
    expect(fmtIdr(1e6)).toBe('Rp 1Jt')
    expect(fmtIdr(5_400_000)).toBe('Rp 5Jt')
  })

  it('uses thousand (Rb) suffix between 1e3 and 1e6', () => {
    expect(fmtIdr(1_000)).toBe('Rp 1Rb')
    expect(fmtIdr(12_300)).toBe('Rp 12Rb')
  })

  it('shows the raw rupiah amount below 1e3', () => {
    expect(fmtIdr(500)).toBe('Rp 500')
    expect(fmtIdr(0)).toBe('Rp 0')
  })
})

describe('fmtAmount', () => {
  const usdIdr = 16_000

  it('formats as IDR when showUsd is false', () => {
    expect(fmtAmount(1e9, false, usdIdr)).toBe('Rp 1.0M')
  })

  it('converts to USD billions when showUsd is true', () => {
    // 32e12 IDR / 16000 = 2e9 USD -> $2.00B
    expect(fmtAmount(32e12, true, usdIdr)).toBe('$2.00B')
  })

  it('converts to USD millions', () => {
    // 16e9 IDR / 16000 = 1e6 USD -> $1.00M
    expect(fmtAmount(16e9, true, usdIdr)).toBe('$1.00M')
  })

  it('converts to USD thousands', () => {
    // 16e6 IDR / 16000 = 1e3 USD -> $1.0K
    expect(fmtAmount(16e6, true, usdIdr)).toBe('$1.0K')
  })
})
