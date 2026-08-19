/**
 * Runtime validation for the high-value API responses.
 *
 * The data hooks type `res.json()` straight into their return shape with no
 * runtime check, so a malformed field reached the UI and rendered as
 * `Rp undefined` — worst on the three endpoints whose numbers an investor acts
 * on: signals, risk, and portfolio. These schemas validate the *core* fields
 * (the ones a component reads for a price, a weight, a metric) and deliberately
 * `passthrough()` everything else:
 *
 *   - Optional Phase-10 display blocks (tradePlan, trend, shap, broker summary)
 *     are omitted by the backend whenever the underlying analysis is absent, so
 *     requiring them would force a needless seed fallback.
 *   - A future additive field must not fail validation on an old client.
 *
 * On a validation failure the hook's existing catch runs — it surfaces the
 * error and falls back to clearly-labelled seed data, which is the correct
 * behaviour: better a labelled simulation than a real-looking `undefined`.
 */
import { z } from "zod";

/* ── Signals ──────────────────────────────────────────────────────────────── */

const signalItemSchema = z
  .object({
    symbol: z.string(),
    uprob: z.number(),
    confidence: z.number(),
    targetPrice: z.number(),
    currentPrice: z.number(),
    upside: z.number(),
  })
  .passthrough();

// GET /v1/signals returns the envelope {signals: [...], ...}; the offline seed
// path is a bare array. Accept both, exactly as the hook already does.
export const signalsResponseSchema = z.union([
  z.array(signalItemSchema),
  z.object({ signals: z.array(signalItemSchema) }).passthrough(),
]);

/* ── Risk ─────────────────────────────────────────────────────────────────── */

// Every field is required in the backend RiskMetrics model (a Pydantic
// construction would fail otherwise), so validating all of them is accurate,
// not over-strict — and it means the parsed value is a RiskMetrics without an
// unsafe double cast.
const riskMetricsSchema = z
  .object({
    overallRisk: z.number(),
    marketRisk: z.number(),
    concentrationRisk: z.number(),
    liquidityRisk: z.number(),
    currencyRisk: z.number(),
    creditRisk: z.number(),
    var95: z.number(),
    cvar95: z.number(),
    volatility: z.number(),
    maxDrawdown: z.number(),
    beta: z.number(),
    sharpe: z.number(),
    sortino: z.number(),
    alpha: z.number(),
    informationRatio: z.number(),
  })
  .passthrough();

export const riskResponseSchema = z
  .object({
    risk: riskMetricsSchema,
    stressTests: z.array(
      z
        .object({
          scenario: z.string(),
          scenarioEn: z.string(),
          impact: z.number(),
          probability: z.number(),
        })
        .passthrough(),
    ),
    sectorExposure: z.array(
      z
        .object({
          sector: z.string(),
          sectorEn: z.string(),
          weight: z.number(),
          benchmark: z.number(),
          overUnder: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/* ── Portfolio optimisation ─────────────────────────────────────────────────── */

const allocationWeightSchema = z
  .object({
    symbol: z.string(),
    name: z.string(),
    weight: z.number(),
    weightPct: z.number(),
    expectedReturn: z.number(),
    currentValue: z.number(),
    lots: z.number(),
  })
  .passthrough();

const optimisationMetricsSchema = z
  .object({
    expectedReturn: z.number(),
    expectedVolatility: z.number(),
    sharpeRatio: z.number(),
    diversificationRatio: z.number(),
    // Lenient on the method label: a new optimiser variant should render, not
    // trip validation and drop the whole allocation to seed.
    method: z.string(),
  })
  .passthrough();

export const portfolioResponseSchema = z
  .object({
    weights: z.array(allocationWeightSchema),
    metrics: optimisationMetricsSchema,
    source: z.enum(["live", "mock"]).nullish(),
    disclaimer: z.string().optional(),
  })
  .passthrough();

/* ── Helper ───────────────────────────────────────────────────────────────── */

/**
 * Validate `data` against `schema`, returning the parsed value or throwing a
 * descriptive Error the caller's catch turns into a seed fallback. Logs the
 * concrete issues so a shape mismatch is diagnosable rather than a silent
 * fallback.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(`[api] ${label} response failed validation:`, result.error.issues);
    throw new Error(`${label} response failed validation`);
  }
  return result.data;
}
