// M1.1 — EMA Intelligence Engine. First per-indicator module under
// lib/mtf/indicators/ (each M1.x milestone adds its own). Produces the frozen
// M0 score plus indicator-LOCAL intelligence (Indicator Confidence / Indicator
// Strength — evidence, not market conclusions; see the M1 spec's Architectural
// Rule). Pure and deterministic; formulas are conservative v1 defaults —
// tunable via the exported constants without touching the API. Each EMA series
// is computed exactly once per evaluation and reused across all dimensions.

import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import {
  labelOf, verdictOf,
  type IndicatorDiagnostics, type IndicatorEvaluation, type IndicatorSignal,
} from '../types';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: % combined separation that saturates the dim. Tuned later against BTC data; API stable. */
export const EMA_SEP_SAT = 6;
/** Conservative default: bars for slope measurement. Tuned later against BTC data; API stable. */
export const EMA_SLOPE_LOOKBACK = 10;
/** Conservative default: % mean slope → points around 50. Tuned later against BTC data; API stable. */
export const EMA_SLOPE_GAIN = 8;
/** Conservative default: freshness points lost per bar since cross. Tuned later against BTC data; API stable. */
export const EMA_FRESH_DECAY = 4;
/** Conservative default: old-cross floor (M1Enhance: old cross → 20). Tuned later against BTC data; API stable. */
export const EMA_FRESH_FLOOR = 20;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const EMA_CONFIDENCE_WEIGHTS = { alignment: 0.4, slope: 0.2, separation: 0.2, pricePosition: 0.1, freshness: 0.1 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const EMA_STRENGTH_WEIGHTS = { alignment: 0.5, separation: 0.25, slope: 0.25 } as const;

/** EMA-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface EmaDiagnostics extends IndicatorDiagnostics {
  alignment: number;      // directional 0–100 (100 bull stack, 0 bear stack)
  separation: number;     // magnitude 0–100
  slope: number;          // directional 0–100 around 50
  pricePosition: number;  // directional 0 / 33 / 67 / 100
  freshness: number;      // magnitude; 50 = no crossover in history (neutral)
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Conviction magnitude of a directional dim: 50→0, 0 or 100→100. */
const conv = (x: number) => Math.abs(x - 50) * 2;

function lastFinite(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/** Frozen M0 score bucket — DO NOT CHANGE (observable behavior). */
function frozenScore(e20: number | null, e50: number | null, e200: number | null): number {
  if (e20 == null || e50 == null) return 50;
  const longTerm = e200 ?? e50;
  if (e20 > e50 && e50 >= longTerm) return 100;
  if (e20 < e50 && e50 <= longTerm) return 0;
  return e20 > e50 ? 65 : 35;
}

/** Diagnostic alignment: strict stacking; exact equalities are neutral. */
function alignmentDim(e20: number | null, e50: number | null, e200: number | null): number {
  if (e20 == null || e50 == null || e200 == null) return 50;
  if (e20 > e50 && e50 > e200) return 100;
  if (e20 < e50 && e50 < e200) return 0;
  if (e20 > e50) return 65;
  if (e20 < e50) return 35;
  return 50;
}

/** Sub-epsilon differences are EMA float residue (e.g. flat series), not signal. */
const EPS = 1e-9;

function separationDim(e20: number | null, e50: number | null, e200: number | null): number {
  if (e20 == null || e50 == null || e200 == null || e200 === 0) return 0;
  const sepPct = ((Math.abs(e20 - e50) + Math.abs(e50 - e200)) / e200) * 100;
  if (sepPct < EPS) return 0;
  return clamp((sepPct / EMA_SEP_SAT) * 100, 0, 100);
}

function slopeDim(arrs: Array<(number | null)[]>): number {
  const pcts: number[] = [];
  for (const arr of arrs) {
    const lastIdx = arr.length - 1;
    const prevIdx = lastIdx - EMA_SLOPE_LOOKBACK;
    const a = prevIdx >= 0 ? arr[prevIdx] : null;
    const b = lastIdx >= 0 ? arr[lastIdx] : null;
    if (a != null && b != null && a !== 0) pcts.push(((b - a) / a) * 100);
  }
  if (pcts.length === 0) return 50;
  const mean = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  if (Math.abs(mean) < EPS) return 50;
  return clamp(50 + mean * EMA_SLOPE_GAIN, 0, 100);
}

function pricePositionDim(price: number | null, e20: number | null, e50: number | null, e200: number | null): number {
  if (price == null || e20 == null || e50 == null || e200 == null) return 50;
  const above = [e20, e50, e200].filter((e) => price > e).length;
  return Math.round((above / 3) * 100); // 0 / 33 / 67 / 100
}

/** Bars since the last e20/e50 sign flip; null = no crossover in history. */
export function barsSinceCross(e20Arr: (number | null)[], e50Arr: (number | null)[]): number | null {
  const last = Math.min(e20Arr.length, e50Arr.length) - 1;
  const signAt = (i: number): number => {
    const a = e20Arr[i], b = e50Arr[i];
    return a == null || b == null ? 0 : Math.sign(a - b);
  };
  const cur = last >= 0 ? signAt(last) : 0;
  if (cur === 0) return null;
  for (let i = last - 1; i >= 0; i--) {
    const s = signAt(i);
    if (s !== 0 && s !== cur) return last - i;
  }
  return null;
}

function freshnessDim(e20Arr: (number | null)[], e50Arr: (number | null)[]): number {
  const bars = barsSinceCross(e20Arr, e50Arr);
  if (bars == null) return 50; // no crossover ≠ bad — mature trends stay neutral
  return clamp(100 - bars * EMA_FRESH_DECAY, EMA_FRESH_FLOOR, 100);
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildConfidence(d: EmaDiagnostics): number {
  const W = EMA_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.alignment * conv(d.alignment) + W.slope * conv(d.slope) + W.separation * d.separation +
    W.pricePosition * conv(d.pricePosition) + W.freshness * d.freshness, 0, 100));
}

/** Indicator Strength (0–100): trend quality, direction-independent. */
export function buildStrength(d: EmaDiagnostics): number {
  const S = EMA_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.alignment * conv(d.alignment) + S.separation * d.separation + S.slope * conv(d.slope), 0, 100));
}

function buildSignals(d: EmaDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.alignment === 100 || d.alignment === 0)
    out.push({ code: 'EMA_ALIGNMENT_STRONG', message: 'Strong EMA Alignment', severity: 'strong' });
  if (d.pricePosition === 100) out.push({ code: 'EMA_PRICE_ABOVE_ALL', message: 'Price Above All EMAs', severity: 'strong' });
  if (d.pricePosition === 0) out.push({ code: 'EMA_PRICE_BELOW_ALL', message: 'Price Below All EMAs', severity: 'strong' });
  if (d.freshness >= 70) out.push({ code: 'EMA_FRESH_CROSS', message: 'Fresh EMA Cross', severity: 'info' });
  if (d.separation >= 70) out.push({ code: 'EMA_WIDE_SEPARATION', message: 'Wide EMA Separation', severity: 'info' });
  if (d.slope >= 70) out.push({ code: 'EMA_RISING', message: 'Rising EMAs', severity: 'info' });
  if (d.slope <= 30) out.push({ code: 'EMA_FALLING', message: 'Falling EMAs', severity: 'info' });
  return out;
}

function buildWarnings(d: EmaDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.separation <= 30) out.push({ code: 'EMA_COMPRESSION', message: 'Weak Separation', severity: 'warning' });
  if (d.freshness <= 25) out.push({ code: 'EMA_AGING', message: 'Aging Trend', severity: 'warning' });
  if (d.slope >= 40 && d.slope <= 60) out.push({ code: 'EMA_FLAT_SLOPE', message: 'Flat EMA Slope', severity: 'warning' });
  if (d.alignment === 35 || d.alignment === 65)
    out.push({ code: 'EMA_MIXED_ALIGNMENT', message: 'Mixed Alignment', severity: 'warning' });
  return out;
}

/** Pure, deterministic EMA evaluation: frozen score + indicator-local intelligence. */
export function evaluateEma(candles: Candle[]): IndicatorEvaluation {
  const closes = candles.map((c) => c.close);
  const e20Arr = pm.emaPine(closes, 20);
  const e50Arr = pm.emaPine(closes, 50);
  const e200Arr = pm.emaPine(closes, 200);
  const e20 = lastFinite(e20Arr);
  const e50 = lastFinite(e50Arr);
  const e200 = lastFinite(e200Arr);
  const price = closes.length ? closes[closes.length - 1] : null;

  const score = frozenScore(e20, e50, e200);
  const diagnostics: EmaDiagnostics = {
    alignment: alignmentDim(e20, e50, e200),
    separation: separationDim(e20, e50, e200),
    slope: slopeDim([e20Arr, e50Arr, e200Arr]),
    pricePosition: pricePositionDim(price, e20, e50, e200),
    freshness: freshnessDim(e20Arr, e50Arr),
  };
  return {
    score,
    display: labelOf(verdictOf(score)),
    confidence: buildConfidence(diagnostics),
    strength: buildStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(diagnostics),
    warnings: buildWarnings(diagnostics),
  };
}
