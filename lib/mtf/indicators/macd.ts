// M1.x — MACD Intelligence Engine. Frozen M0 score + indicator-LOCAL
// intelligence (see the M1 spec's Architectural Rule). Pure, deterministic,
// one computeMacd() call per evaluation. Spec:
// docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { Candle } from '../../types';
import type { IndicatorSettings } from '../../indicatorFramework';
import { computeMacd } from '../../indicators/macd';
import {
  labelOf, verdictOf,
  type IndicatorDiagnostics, type IndicatorEvaluation, type IndicatorSignal,
} from '../types';
import { EPS, clamp, conv, lastVal, val, type PlotData } from './shared';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: histogram diffs scanned for momentum. Tuned later against BTC data; API stable. */
export const MACD_HIST_LOOKBACK = 5;
/** Conservative default: separation saturates when |m−s| equals the larger line. Tuned later against BTC data; API stable. */
export const MACD_SEP_SAT = 1;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const MACD_CONFIDENCE_WEIGHTS = { crossState: 0.4, histMomentum: 0.25, zeroLine: 0.2, separation: 0.15 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const MACD_STRENGTH_WEIGHTS = { crossState: 0.4, separation: 0.3, histMomentum: 0.3 } as const;

/** MACD-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface MacdDiagnostics extends IndicatorDiagnostics {
  crossState: number;    // directional: macd vs signal (100/0/50)
  histMomentum: number;  // directional: histogram rising share around 50
  zeroLine: number;      // directional: both above/below zero (100/0/65/35/50)
  separation: number;    // magnitude: |m−s| relative to the larger line
}

/** Aligned finite (macd, signal) pairs in bar order. */
function pairs(macdData: PlotData, signalData: PlotData): Array<[number, number]> {
  const n = Math.min(macdData.length, signalData.length);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const m = val(macdData[i]);
    const s = val(signalData[i]);
    if (m != null && s != null) out.push([m, s]);
  }
  return out;
}

function histMomentumDim(hist: number[]): number {
  const diffs: number[] = [];
  for (let i = Math.max(1, hist.length - MACD_HIST_LOOKBACK); i < hist.length; i++) {
    diffs.push(hist[i] - hist[i - 1]);
  }
  if (diffs.length === 0) return 50;
  // rising 1 · flat 0.5 · falling 0 → mean·100 (symmetric; flat is neutral)
  const score = diffs.reduce((s, d) => s + (Math.abs(d) <= EPS ? 0.5 : d > 0 ? 1 : 0), 0) / diffs.length;
  return Math.round(score * 100);
}

function zeroLineDim(m: number | null, s: number | null): number {
  if (m == null || s == null) return 50;
  if (m > 0 && s > 0) return 100;
  if (m < 0 && s < 0) return 0;
  return m > 0 ? 65 : m < 0 ? 35 : 50;
}

function separationDim(m: number | null, s: number | null): number {
  if (m == null || s == null) return 0;
  const ratio = Math.abs(m - s) / Math.max(Math.abs(m), Math.abs(s), EPS);
  if (ratio < EPS) return 0;
  return clamp((ratio / MACD_SEP_SAT) * 100, 0, 100);
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildMacdConfidence(d: MacdDiagnostics): number {
  const W = MACD_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.crossState * conv(d.crossState) + W.histMomentum * conv(d.histMomentum) +
    W.zeroLine * conv(d.zeroLine) + W.separation * d.separation, 0, 100));
}

/** Indicator Strength (0–100): signal quality, direction-independent. */
export function buildMacdStrength(d: MacdDiagnostics): number {
  const S = MACD_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.crossState * conv(d.crossState) + S.separation * d.separation + S.histMomentum * conv(d.histMomentum), 0, 100));
}

function buildSignals(d: MacdDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.crossState === 100 && d.zeroLine >= 65)
    out.push({ code: 'MACD_BULLISH', message: 'MACD Bullish Above Zero', severity: 'strong' });
  if (d.crossState === 0 && d.zeroLine <= 35)
    out.push({ code: 'MACD_BEARISH', message: 'MACD Bearish Below Zero', severity: 'strong' });
  if (d.histMomentum >= 70) out.push({ code: 'MACD_HIST_RISING', message: 'MACD Histogram Rising', severity: 'info' });
  if (d.histMomentum <= 30) out.push({ code: 'MACD_HIST_FALLING', message: 'MACD Histogram Falling', severity: 'info' });
  if (d.separation >= 70) out.push({ code: 'MACD_WIDE_SEPARATION', message: 'Wide MACD Separation', severity: 'info' });
  return out;
}

function buildWarnings(d: MacdDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.separation <= 20) out.push({ code: 'MACD_COMPRESSION', message: 'MACD Lines Converging', severity: 'warning' });
  if (d.zeroLine === 35 || d.zeroLine === 65)
    out.push({ code: 'MACD_ZERO_STRADDLE', message: 'MACD Straddling Zero Line', severity: 'warning' });
  return out;
}

/** Pure, deterministic MACD evaluation: frozen score + indicator-local intelligence. */
export function evaluateMacd(candles: Candle[], settings?: IndicatorSettings): IndicatorEvaluation {
  const plots = computeMacd(candles, settings && { id: 'macd', settings }).plots;
  const macdData = plots.find((p) => p.id === 'macd')?.data ?? [];
  const signalData = plots.find((p) => p.id === 'signal')?.data ?? [];
  const ps = pairs(macdData, signalData);
  // Frozen semantics: last finite value of EACH plot independently (as lastNum did).
  const m = lastVal(macdData);
  const s = lastVal(signalData);

  // Frozen M0 score/display — DO NOT CHANGE (equality → 0, observable behavior).
  const score = m == null || s == null ? 50 : m > s ? 100 : 0;
  const display = labelOf(verdictOf(score));

  const diagnostics: MacdDiagnostics = {
    crossState: m == null || s == null ? 50 : m > s ? 100 : m < s ? 0 : 50,
    histMomentum: histMomentumDim(ps.map(([a, b]) => a - b)),
    zeroLine: zeroLineDim(m, s),
    separation: separationDim(m, s),
  };
  return {
    score, display,
    confidence: buildMacdConfidence(diagnostics),
    strength: buildMacdStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(diagnostics),
    warnings: buildWarnings(diagnostics),
  };
}
