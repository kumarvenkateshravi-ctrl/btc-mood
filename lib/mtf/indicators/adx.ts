// M1.x — ADX Intelligence Engine. Frozen M0 score + indicator-LOCAL
// intelligence (see the M1 spec's Architectural Rule). Pure, deterministic,
// one computeAdx() call per evaluation. Spec:
// docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { Candle } from '../../types';
import type { IndicatorSettings } from '../../indicatorFramework';
import { computeAdx } from '../../indicators/adx';
import type { IndicatorDiagnostics, IndicatorEvaluation, IndicatorSignal } from '../types';
import { EPS, clamp, conv, finiteVals, lastVal } from './shared';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: DI spread saturates at half the DI sum. Tuned later against BTC data; API stable. */
export const ADX_SPREAD_SAT = 0.5;
/** Conservative default: finite ADX steps for the momentum delta. Tuned later against BTC data; API stable. */
export const ADX_MOM_LOOKBACK = 5;
/** Conservative default: ADX-points delta → dim points around 50. Tuned later against BTC data; API stable. */
export const ADX_MOM_GAIN = 4;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const ADX_CONFIDENCE_WEIGHTS = { trendStrength: 0.35, direction: 0.25, diSpread: 0.25, adxMomentum: 0.15 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const ADX_STRENGTH_WEIGHTS = { trendStrength: 0.5, diSpread: 0.3, adxMomentum: 0.2 } as const;

/** ADX-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface AdxDiagnostics extends IndicatorDiagnostics {
  trendStrength: number; // magnitude: clamp(adx,0,50)·2
  direction: number;     // directional: +DI vs −DI (100/0/50)
  diSpread: number;      // magnitude: |+DI−−DI| relative to DI sum
  adxMomentum: number;   // directional: ADX rising/falling around 50
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildAdxConfidence(d: AdxDiagnostics): number {
  const W = ADX_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.trendStrength * d.trendStrength + W.direction * conv(d.direction) +
    W.diSpread * d.diSpread + W.adxMomentum * conv(d.adxMomentum), 0, 100));
}

/** Indicator Strength (0–100): trend quality, direction-independent. */
export function buildAdxStrength(d: AdxDiagnostics): number {
  const S = ADX_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.trendStrength * d.trendStrength + S.diSpread * d.diSpread + S.adxMomentum * conv(d.adxMomentum), 0, 100));
}

function buildSignals(adx: number | null, d: AdxDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (adx != null && adx >= 25) out.push({ code: 'ADX_STRONG_TREND', message: 'Strong Trend (ADX ≥ 25)', severity: 'strong' });
  if (adx != null && adx >= 40) out.push({ code: 'ADX_VERY_STRONG', message: 'Very Strong Trend (ADX ≥ 40)', severity: 'strong' });
  if (d.adxMomentum >= 70) out.push({ code: 'ADX_BUILDING', message: 'Trend Strength Building', severity: 'info' });
  if (d.diSpread >= 70) out.push({ code: 'ADX_DI_DOMINANT', message: 'DI Lines Strongly Separated', severity: 'info' });
  return out;
}

function buildWarnings(adx: number | null, dis: boolean, d: AdxDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (adx != null && adx < 20) out.push({ code: 'ADX_WEAK', message: 'Weak or Absent Trend', severity: 'warning' });
  if (d.adxMomentum <= 30) out.push({ code: 'ADX_FADING', message: 'Trend Strength Fading', severity: 'warning' });
  if (dis && d.diSpread <= 15) out.push({ code: 'ADX_DI_TANGLE', message: 'DI Lines Entangled', severity: 'warning' });
  return out;
}

/** Pure, deterministic ADX evaluation: frozen score + indicator-local intelligence. */
export function evaluateAdx(candles: Candle[], settings?: IndicatorSettings): IndicatorEvaluation {
  const plots = computeAdx(candles, settings && { id: 'adx', settings }).plots;
  const adxData = plots.find((p) => p.id === 'adx')?.data ?? [];
  const adx = lastVal(adxData);
  const plusDI = lastVal(plots.find((p) => p.id === 'plusDI')?.data ?? []);
  const minusDI = lastVal(plots.find((p) => p.id === 'minusDI')?.data ?? []);

  // Frozen M0 score/display — DO NOT CHANGE (observable behavior).
  let score = 50;
  if (adx != null && plusDI != null && minusDI != null) {
    const dir = plusDI >= minusDI ? 1 : -1;
    score = 50 + dir * clamp(adx, 0, 50);
  }
  const display = adx == null ? '—' : adx.toFixed(1);

  const disPresent = plusDI != null && minusDI != null;
  const spreadRatio = disPresent ? Math.abs(plusDI! - minusDI!) / (plusDI! + minusDI! + EPS) : 0;
  const adxVals = finiteVals(adxData);
  const momDelta = adxVals.length >= ADX_MOM_LOOKBACK + 1
    ? adxVals[adxVals.length - 1] - adxVals[adxVals.length - 1 - ADX_MOM_LOOKBACK]
    : null;

  const diagnostics: AdxDiagnostics = {
    trendStrength: adx == null ? 0 : clamp(adx, 0, 50) * 2,
    direction: !disPresent ? 50 : plusDI! > minusDI! ? 100 : plusDI! < minusDI! ? 0 : 50,
    diSpread: spreadRatio < EPS ? 0 : clamp((spreadRatio / ADX_SPREAD_SAT) * 100, 0, 100),
    adxMomentum: momDelta == null || Math.abs(momDelta) < EPS ? 50 : clamp(50 + momDelta * ADX_MOM_GAIN, 0, 100),
  };
  return {
    score, display,
    confidence: buildAdxConfidence(diagnostics),
    strength: buildAdxStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(adx, diagnostics),
    warnings: buildWarnings(adx, disPresent, diagnostics),
  };
}
