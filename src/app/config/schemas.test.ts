import { describe, it, expect, vi } from 'vitest'
import {
  signalsResponseSchema,
  riskResponseSchema,
  portfolioResponseSchema,
  parseOrThrow,
} from './schemas'

const signal = {
  symbol: 'BBCA',
  uprob: 62,
  confidence: 62,
  targetPrice: 10500,
  currentPrice: 9800,
  upside: 7.1,
}

const riskMetrics = {
  overallRisk: 45, marketRisk: 50, concentrationRisk: 40, liquidityRisk: 30,
  currencyRisk: 20, creditRisk: 15,
  var95: -3.2, cvar95: -4.1, volatility: 18.5, maxDrawdown: -12.0,
  beta: 1.1, sharpe: 0.9, sortino: 1.2, alpha: 2.1, informationRatio: 0.5,
}

const riskPayload = {
  risk: riskMetrics,
  stressTests: [{ scenario: 'x', scenarioEn: 'x', impact: -5, probability: 10 }],
  sectorExposure: [{ sector: 'Keuangan', sectorEn: 'Financials', weight: 40, benchmark: 35, overUnder: 5 }],
}

const portfolioPayload = {
  weights: [
    { symbol: 'BBCA', name: 'BBCA', weight: 0.4, weightPct: 40, expectedReturn: 12, currentValue: 1e6, lots: 10 },
  ],
  metrics: { expectedReturn: 12, expectedVolatility: 18, sharpeRatio: 0.9, diversificationRatio: 1.3, method: 'black-litterman' },
  source: 'live',
  disclaimer: 'demo',
}

describe('signalsResponseSchema', () => {
  it('accepts the envelope shape and passes through extra fields', () => {
    const out = parseOrThrow(signalsResponseSchema, { signals: [{ ...signal, shap: [], tradePlan: null }], source: 'live' }, 'signals')
    expect(Array.isArray(out) ? out : out.signals).toHaveLength(1)
  })

  it('accepts the bare-array (seed) shape', () => {
    const out = parseOrThrow(signalsResponseSchema, [signal], 'signals')
    expect(out).toHaveLength(1)
  })

  it('rejects a signal missing a core numeric field', () => {
    const bad = { signals: [{ symbol: 'BBCA', uprob: 62 }] }
    expect(() => parseOrThrow(signalsResponseSchema, bad, 'signals')).toThrow(/validation/)
  })

  it('rejects a core field of the wrong type', () => {
    const bad = { signals: [{ ...signal, currentPrice: 'oops' }] }
    expect(() => parseOrThrow(signalsResponseSchema, bad, 'signals')).toThrow(/validation/)
  })
})

describe('riskResponseSchema', () => {
  it('accepts a well-formed risk payload', () => {
    expect(() => parseOrThrow(riskResponseSchema, riskPayload, 'risk')).not.toThrow()
  })

  it('passes through unknown extra fields (forward-compatible)', () => {
    const withExtra = { ...riskPayload, risk: { ...riskMetrics, futureField: 123 }, newTopLevel: true }
    const out = parseOrThrow(riskResponseSchema, withExtra, 'risk')
    expect(out.risk.var95).toBe(-3.2)
  })

  it('rejects when a required metric is missing', () => {
    const { sharpe, ...missingSharpe } = riskMetrics
    void sharpe
    expect(() => parseOrThrow(riskResponseSchema, { ...riskPayload, risk: missingSharpe }, 'risk')).toThrow(/validation/)
  })

  it('rejects when the risk block is absent', () => {
    expect(() => parseOrThrow(riskResponseSchema, { stressTests: [], sectorExposure: [] }, 'risk')).toThrow(/validation/)
  })
})

describe('portfolioResponseSchema', () => {
  it('accepts a well-formed allocation', () => {
    expect(() => parseOrThrow(portfolioResponseSchema, portfolioPayload, 'portfolio')).not.toThrow()
  })

  it('rejects a weight missing lots', () => {
    const bad = { ...portfolioPayload, weights: [{ symbol: 'BBCA', name: 'BBCA', weight: 0.4, weightPct: 40, expectedReturn: 12, currentValue: 1e6 }] }
    expect(() => parseOrThrow(portfolioResponseSchema, bad, 'portfolio')).toThrow(/validation/)
  })
})

describe('parseOrThrow', () => {
  it('logs the issues on failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => parseOrThrow(riskResponseSchema, {}, 'risk')).toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
