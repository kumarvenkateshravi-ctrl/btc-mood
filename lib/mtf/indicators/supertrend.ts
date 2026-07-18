// M1.x — Supertrend Intelligence Engine. Frozen M0 score + indicator-LOCAL
// intelligence (see the M1 spec's Architectural Rule). Pure, deterministic,
// one computeSuperTrend() call per evaluation. Spec:
// docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { Candle } from '../../types';
import type { IndicatorSettings } from '../../indicatorFramework';
import { computeSuperTrend } from '../../indicators/superTrend';
import {
  labelOf, verdictOf,
  type IndicatorDiagnostics, type IndicatorEvaluation, type IndicatorSignal,
} from '../types';
import { EPS, clamp, conv, lastVal, val, type PlotData } from './shared';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: % distance to the line that saturates the dim. Tuned later against BTC data; API stable. */
export const ST_DIST_SAT = 3;
/** Conservative default: freshness points lost per bar since flip. Tuned later against BTC data; API stable. */
export const ST_FRESH_DECAY = 4;
/** Conservative default: old-flip freshness floor. Tuned later against BTC data; API stable. */
export const ST_FRESH_FLOOR = 20;
/** Conservative default: bars scanned for side persistence. Tuned later against BTC data; API stable. */
export const ST_PERSIST_LOOKBACK = 20;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const ST_CONFIDENCE_WEIGHTS = { side: 0.35, distance: 0.25, persistence: 0.25, flipFreshness: 0.15 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const ST_STRENGTH_WEIGHTS = { distance: 0.4, persistence: 0.4, side: 0.2 } as const;

/** Supertrend-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface SupertrendDiagnostics extends IndicatorDiagnostics {
  side: number;          // directional: close vs line (100/0/50)
  distance: number;      // magnitude: % buffer to the line
  flipFreshness: number; // magnitude: recent flip 100 … old 20; no flip → 50
  persistence: number;   // magnitude: share of recent bars on the current side
}

/** Per-bar side of price vs line: 1 above, −1 below, 0 unknown/equal. */
function sideSeries(candles: Candle[], lineData: PlotData): number[] {
  const n = Math.min(candles.length, lineData.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const line = val(lineData[i]);
    const close = candles[i]?.close;
    out.push(line == null || close == null ? 0 : Math.sign(close - line));
  }
  return out;
}

function flipFreshnessDim(sides: number[]): number {
  const last = sides.length - 1;
  const cur = last >= 0 ? sides[last] : 0;
  if (cur === 0) return 50;
  for (let i = last - 1; i >= 0; i--) {
    if (sides[i] !== 0 && sides[i] !== cur) {
      return clamp(100 - (last - i) * ST_FRESH_DECAY, ST_FRESH_FLOOR, 100);
    }
  }
  return 50; // never flipped → mature side, neutral (not penalized)
}

function persistenceDim(sides: number[]): number {
  const last = sides.length - 1;
  const cur = last >= 0 ? sides[last] : 0;
  if (cur === 0) return 50;
  let onSide = 0;
  let counted = 0;
  for (let i = last; i >= 0 && counted < ST_PERSIST_LOOKBACK; i--) {
    if (sides[i] === 0) continue;
    counted++;
    if (sides[i] === cur) onSide++;
  }
  if (counted === 0) return 50;
  return Math.round((onSide / counted) * 100);
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildStConfidence(d: SupertrendDiagnostics): number {
  const W = ST_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.side * conv(d.side) + W.distance * d.distance + W.persistence * d.persistence +
    W.flipFreshness * d.flipFreshness, 0, 100));
}

/** Indicator Strength (0–100): trend quality, direction-independent. */
export function buildStStrength(d: SupertrendDiagnostics): number {
  const S = ST_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.distance * d.distance + S.persistence * d.persistence + S.side * conv(d.side), 0, 100));
}

function buildSignals(d: SupertrendDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.side === 100) out.push({ code: 'ST_BULLISH', message: 'Price Above Supertrend', severity: 'strong' });
  if (d.side === 0) out.push({ code: 'ST_BEARISH', message: 'Price Below Supertrend', severity: 'strong' });
  if (d.flipFreshness >= 70) out.push({ code: 'ST_FRESH_FLIP', message: 'Fresh Supertrend Flip', severity: 'info' });
  if (d.distance >= 70) out.push({ code: 'ST_WIDE_BUFFER', message: 'Wide Buffer To Supertrend', severity: 'info' });
  if (d.persistence >= 85) out.push({ code: 'ST_PERSISTENT', message: 'Sustained Supertrend Side', severity: 'info' });
  return out;
}

function buildWarnings(linePresent: boolean, d: SupertrendDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (linePresent && d.distance <= 15)
    out.push({ code: 'ST_NEAR_FLIP', message: 'Price Near Supertrend Line', severity: 'warning' });
  if (d.persistence <= 60) out.push({ code: 'ST_CHOPPY', message: 'Frequent Supertrend Flips', severity: 'warning' });
  return out;
}

/** Pure, deterministic Supertrend evaluation: frozen score + indicator-local intelligence. */
export function evaluateSupertrend(candles: Candle[], settings?: IndicatorSettings): IndicatorEvaluation {
  const plots = computeSuperTrend(candles, settings && { id: 'supertrend', settings }).plots;
  const lineData = plots.find((p) => p.id === 'supertrend')?.data ?? [];
  const stLine = lastVal(lineData);
  const lastClose = candles[candles.length - 1]?.close ?? 0;

  // Frozen M0 score/display — DO NOT CHANGE (equality → 0, observable behavior).
  const score = stLine == null ? 50 : lastClose > stLine ? 100 : 0;
  const display = labelOf(verdictOf(score));

  const sides = sideSeries(candles, lineData);
  const distPct = stLine == null || lastClose <= 0 ? 0 : (Math.abs(lastClose - stLine) / lastClose) * 100;
  const diagnostics: SupertrendDiagnostics = {
    side: stLine == null ? 50 : lastClose > stLine ? 100 : lastClose < stLine ? 0 : 50,
    distance: distPct < EPS ? 0 : clamp((distPct / ST_DIST_SAT) * 100, 0, 100),
    flipFreshness: flipFreshnessDim(sides),
    persistence: persistenceDim(sides),
  };
  return {
    score, display,
    confidence: buildStConfidence(diagnostics),
    strength: buildStStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(diagnostics),
    warnings: buildWarnings(stLine != null, diagnostics),
  };
}
