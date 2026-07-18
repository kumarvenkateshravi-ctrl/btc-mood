// M1.x — RSI Intelligence Engine. Frozen M0 score + indicator-LOCAL
// intelligence (see the M1 spec's Architectural Rule). Pure, deterministic,
// one computeRsi() call per evaluation. Spec:
// docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { Candle } from '../../types';
import type { IndicatorSettings } from '../../indicatorFramework';
import { computeRsi } from '../../indicators/rsi';
import type { IndicatorDiagnostics, IndicatorEvaluation, IndicatorSignal } from '../types';
import { clamp, conv, finiteVals } from './shared';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: finite RSI steps for the momentum delta. Tuned later against BTC data; API stable. */
export const RSI_MOM_LOOKBACK = 5;
/** Conservative default: RSI-points delta → dim points around 50. Tuned later against BTC data; API stable. */
export const RSI_MOM_GAIN = 2;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const RSI_CONFIDENCE_WEIGHTS = { position: 0.5, momentum: 0.3, zone: 0.2 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const RSI_STRENGTH_WEIGHTS = { position: 0.6, momentum: 0.4 } as const;

/** RSI-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface RsiDiagnostics extends IndicatorDiagnostics {
  position: number;   // directional — the RSI value itself (≡ frozen score)
  zone: number;       // directional bucket: OB 100 / 70 / 50 / 30 / OS 0
  momentum: number;   // directional — RSI slope around 50
}

function zoneDim(rsi: number | null): number {
  if (rsi == null) return 50;
  if (rsi >= 70) return 100;
  if (rsi >= 60) return 70;
  if (rsi >= 40) return 50;
  if (rsi >= 30) return 30;
  return 0;
}

function momentumDim(vals: number[]): number {
  if (vals.length < RSI_MOM_LOOKBACK + 1) return 50;
  const delta = vals[vals.length - 1] - vals[vals.length - 1 - RSI_MOM_LOOKBACK];
  return clamp(50 + delta * RSI_MOM_GAIN, 0, 100);
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildRsiConfidence(d: RsiDiagnostics): number {
  const W = RSI_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.position * conv(d.position) + W.momentum * conv(d.momentum) + W.zone * conv(d.zone), 0, 100));
}

/** Indicator Strength (0–100): momentum quality, direction-independent. */
export function buildRsiStrength(d: RsiDiagnostics): number {
  const S = RSI_STRENGTH_WEIGHTS;
  return Math.round(clamp(S.position * conv(d.position) + S.momentum * conv(d.momentum), 0, 100));
}

function buildSignals(d: RsiDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.zone === 100) out.push({ code: 'RSI_OVERBOUGHT', message: 'RSI Overbought', severity: 'strong' });
  if (d.zone === 0) out.push({ code: 'RSI_OVERSOLD', message: 'RSI Oversold', severity: 'strong' });
  if (d.position >= 60 && d.momentum >= 60)
    out.push({ code: 'RSI_BULLISH_MOMENTUM', message: 'RSI Rising With Bullish Bias', severity: 'info' });
  if (d.position <= 40 && d.momentum <= 40)
    out.push({ code: 'RSI_BEARISH_MOMENTUM', message: 'RSI Falling With Bearish Bias', severity: 'info' });
  return out;
}

function buildWarnings(d: RsiDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.position > 40 && d.position < 60 && Math.abs(d.momentum - 50) < 10)
    out.push({ code: 'RSI_FLAT', message: 'RSI Flat Near Midline', severity: 'warning' });
  if ((d.position >= 60 && d.momentum <= 40) || (d.position <= 40 && d.momentum >= 60))
    out.push({ code: 'RSI_FADING', message: 'RSI Momentum Fading', severity: 'warning' });
  return out;
}

/** Pure, deterministic RSI evaluation: frozen score + indicator-local intelligence. */
export function evaluateRsi(candles: Candle[], settings?: IndicatorSettings): IndicatorEvaluation {
  const plots = computeRsi(candles, settings && { id: 'rsi', settings }).plots;
  const data = plots.find((p) => p.id === 'rsi')?.data ?? [];
  const vals = finiteVals(data);
  const rsi = vals.length ? vals[vals.length - 1] : null;

  // Frozen M0 score/display — DO NOT CHANGE (observable behavior).
  const score = rsi == null ? 50 : clamp(rsi, 0, 100);
  const display = rsi == null ? '—' : rsi.toFixed(1);

  const diagnostics: RsiDiagnostics = {
    position: score,
    zone: zoneDim(rsi),
    momentum: momentumDim(vals),
  };
  return {
    score, display,
    confidence: buildRsiConfidence(diagnostics),
    strength: buildRsiStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(diagnostics),
    warnings: buildWarnings(diagnostics),
  };
}
