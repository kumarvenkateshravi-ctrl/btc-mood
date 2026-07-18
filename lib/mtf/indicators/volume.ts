// M1.x — Volume Intelligence Engine. Frozen M0 score + indicator-LOCAL
// intelligence (see the M1 spec's Architectural Rule). Pure, deterministic,
// two SMA passes over the volume array per evaluation. Spec:
// docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import type { IndicatorDiagnostics, IndicatorEvaluation, IndicatorSignal } from '../types';
import { EPS, clamp, conv, lastVal } from './shared';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: volPct that saturates the surge dim. Tuned later against BTC data; API stable. */
export const VOL_SURGE_SAT = 150;
/** Conservative default: participation-trend gain (%SMA-ratio → dim points). Tuned later against BTC data; API stable. */
export const VOL_TREND_GAIN = 1;
/** Conservative default: fast participation SMA length. Tuned later against BTC data; API stable. */
export const VOL_FAST_SMA = 5;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const VOL_CONFIDENCE_WEIGHTS = { pressure: 0.4, surge: 0.3, trend: 0.3 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const VOL_STRENGTH_WEIGHTS = { surge: 0.5, trend: 0.3, pressure: 0.2 } as const;

/** Volume-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface VolumeDiagnostics extends IndicatorDiagnostics {
  pressure: number; // directional ≡ frozen score
  surge: number;    // magnitude: spike intensity above average
  trend: number;    // directional: fast vs slow participation SMA
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildVolConfidence(d: VolumeDiagnostics): number {
  const W = VOL_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.pressure * conv(d.pressure) + W.surge * d.surge + W.trend * conv(d.trend), 0, 100));
}

/** Indicator Strength (0–100): participation quality, direction-independent. */
export function buildVolStrength(d: VolumeDiagnostics): number {
  const S = VOL_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.surge * d.surge + S.trend * conv(d.trend) + S.pressure * conv(d.pressure), 0, 100));
}

function buildSignals(volPct: number, d: VolumeDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.surge >= 70) out.push({ code: 'VOL_SPIKE', message: 'Volume Spike', severity: 'strong' });
  if (volPct >= 25) out.push({ code: 'VOL_ABOVE_AVERAGE', message: 'Volume Above Average', severity: 'info' });
  if (d.trend >= 65) out.push({ code: 'VOL_RISING_PARTICIPATION', message: 'Rising Participation', severity: 'info' });
  return out;
}

function buildWarnings(volPct: number, d: VolumeDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (volPct <= -50) out.push({ code: 'VOL_DRY_UP', message: 'Volume Dry-Up', severity: 'warning' });
  else if (volPct <= -25) out.push({ code: 'VOL_BELOW_AVERAGE', message: 'Volume Below Average', severity: 'warning' });
  if (d.trend <= 35) out.push({ code: 'VOL_FADING_PARTICIPATION', message: 'Fading Participation', severity: 'warning' });
  return out;
}

/** Pure, deterministic Volume evaluation: frozen score + indicator-local intelligence. */
export function evaluateVolume(candles: Candle[]): IndicatorEvaluation {
  const volumes = candles.map((c) => c.volume);
  const volSma = lastVal(pm.sma(volumes, 20));
  const lastVol = volumes[volumes.length - 1] ?? 0;

  // Frozen M0 score/display — DO NOT CHANGE (observable behavior).
  const volPct = volSma && volSma > 0 ? (lastVol / volSma - 1) * 100 : 0;
  const score = clamp(50 + volPct / 2, 0, 100);
  const display = `${volPct >= 0 ? '+' : ''}${volPct.toFixed(0)}%`;

  const smaFast = lastVal(pm.sma(volumes, VOL_FAST_SMA));
  let trend = 50;
  if (smaFast != null && volSma != null && volSma > 0) {
    const ratioPct = (smaFast / volSma - 1) * 100;
    trend = Math.abs(ratioPct) < EPS ? 50 : clamp(50 + ratioPct * VOL_TREND_GAIN, 0, 100);
  }
  const diagnostics: VolumeDiagnostics = {
    pressure: score,
    surge: volPct > EPS ? clamp((volPct / VOL_SURGE_SAT) * 100, 0, 100) : 0,
    trend,
  };
  return {
    score, display,
    confidence: buildVolConfidence(diagnostics),
    strength: buildVolStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(volPct, diagnostics),
    warnings: buildWarnings(volPct, diagnostics),
  };
}
