// M1.x — OBV Intelligence Engine. Frozen M0 score + indicator-LOCAL
// intelligence (see the M1 spec's Architectural Rule). Pure, deterministic,
// one computeObv() call per evaluation. Spec:
// docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { Candle } from '../../types';
import { computeObv } from '../../indicators/obv';
import {
  labelOf, verdictOf,
  type IndicatorDiagnostics, type IndicatorEvaluation, type IndicatorSignal,
} from '../types';
import { EPS, clamp, conv, finiteVals, lastVal } from './shared';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: OBV bars compared for the frozen trend (M0 value). Tuned later against BTC data; API stable. */
export const OBV_LOOKBACK = 15;
/** Conservative default: half-window for the acceleration comparison. Tuned later against BTC data; API stable. */
export const OBV_ACCEL_HALF = 7;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const OBV_CONFIDENCE_WEIGHTS = { trend: 0.5, consistency: 0.3, acceleration: 0.2 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const OBV_STRENGTH_WEIGHTS = { consistency: 0.6, trend: 0.4 } as const;

/** OBV-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface ObvDiagnostics extends IndicatorDiagnostics {
  trend: number;        // directional ≡ frozen comparison (100/0/50)
  consistency: number;  // magnitude: one-sidedness of recent OBV diffs
  acceleration: number; // directional: recent flow vs prior flow (100/0/50)
}

function consistencyDim(vals: number[]): number {
  const diffs: number[] = [];
  for (let i = Math.max(1, vals.length - OBV_LOOKBACK); i < vals.length; i++) {
    diffs.push(vals[i] - vals[i - 1]);
  }
  if (diffs.length < 2) return 0;
  const relTol = (d: number) => Math.abs(d) <= EPS * Math.max(1, Math.abs(vals[vals.length - 1]));
  const mean = diffs.reduce((s, d) => s + (relTol(d) ? 0.5 : d > 0 ? 1 : 0), 0) / diffs.length;
  return Math.round(Math.abs(mean - 0.5) * 200);
}

function accelerationDim(vals: number[]): number {
  const L = vals.length - 1;
  if (L < 2 * OBV_ACCEL_HALF + 1) return 50;
  const recent = vals[L] - vals[L - OBV_ACCEL_HALF];
  const prior = vals[L - OBV_ACCEL_HALF] - vals[L - 2 * OBV_ACCEL_HALF - 1];
  const tol = EPS * Math.max(1, Math.abs(recent), Math.abs(prior));
  if (Math.abs(recent - prior) <= tol) return 50;
  return recent > prior ? 100 : 0;
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildObvConfidence(d: ObvDiagnostics): number {
  const W = OBV_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.trend * conv(d.trend) + W.consistency * d.consistency + W.acceleration * conv(d.acceleration), 0, 100));
}

/** Indicator Strength (0–100): flow quality, direction-independent. */
export function buildObvStrength(d: ObvDiagnostics): number {
  const S = OBV_STRENGTH_WEIGHTS;
  return Math.round(clamp(S.consistency * d.consistency + S.trend * conv(d.trend), 0, 100));
}

function buildSignals(d: ObvDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.trend === 100) out.push({ code: 'OBV_RISING', message: 'OBV Rising', severity: 'strong' });
  if (d.trend === 0) out.push({ code: 'OBV_FALLING', message: 'OBV Falling', severity: 'strong' });
  if (d.consistency >= 70) out.push({ code: 'OBV_ONE_SIDED_FLOW', message: 'Consistent Volume Flow', severity: 'info' });
  if (d.acceleration === 100) out.push({ code: 'OBV_ACCELERATING', message: 'Volume Flow Accelerating', severity: 'info' });
  return out;
}

function buildWarnings(d: ObvDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.consistency <= 30) out.push({ code: 'OBV_CHOPPY_FLOW', message: 'Choppy Volume Flow', severity: 'warning' });
  if (d.acceleration === 0 && d.trend !== 50)
    out.push({ code: 'OBV_DECELERATING', message: 'Volume Flow Slowing', severity: 'warning' });
  return out;
}

/** Pure, deterministic OBV evaluation: frozen score + indicator-local intelligence. */
export function evaluateObv(candles: Candle[]): IndicatorEvaluation {
  const obv = computeObv(candles).plots.find((p) => p.id === 'obv')?.data ?? [];
  const last = lastVal(obv);
  // Frozen M0 prev lookup — DO NOT CHANGE (raw `typeof === 'number'` check, observable behavior).
  const prevIdx = Math.max(0, obv.length - OBV_LOOKBACK);
  const prev = typeof obv[prevIdx] === 'number' ? (obv[prevIdx] as number) : null;
  const score = last == null || prev == null ? 50 : last > prev ? 100 : last < prev ? 0 : 50;
  const display = labelOf(verdictOf(score));

  const vals = finiteVals(obv);
  const diagnostics: ObvDiagnostics = {
    trend: score, // frozen comparison IS the trend dim (100/0/50)
    consistency: consistencyDim(vals),
    acceleration: accelerationDim(vals),
  };
  return {
    score, display,
    confidence: buildObvConfidence(diagnostics),
    strength: buildObvStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(diagnostics),
    warnings: buildWarnings(diagnostics),
  };
}
