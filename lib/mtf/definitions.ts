// The fixed seven-indicator roster of the MTF Engine. Scoring logic moved
// verbatim from lib/alignment.ts computeTfCells so the registry is the single
// source of truth; alignment.ts delegates here. Weights default to equal so
// the composite score stays identical to the legacy rounded mean.

import type { Candle } from '../types';
import type { IndicatorPlot } from '../indicatorFramework';
import * as pm from '../pineMath';
import { computeRsi } from '../indicators/rsi';
import { computeMacd } from '../indicators/macd';
import { computeAdx } from '../indicators/adx';
import { computeSuperTrend } from '../indicators/superTrend';
import { computeObv } from '../indicators/obv';
import { labelOf, verdictOf, type IndicatorDefinition } from './types';
import { evaluateEma } from './indicators/ema';
import { evaluateRsi } from './indicators/rsi';
import { evaluateMacd } from './indicators/macd';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Last finite value of an indicator plot's data array. */
function lastNum(data: IndicatorPlot['data']): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (d == null) continue;
    const v = typeof d === 'number' ? d : (d as { value?: number }).value;
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function plotData(plots: IndicatorPlot[], id: string): IndicatorPlot['data'] {
  return plots.find((p) => p.id === id)?.data ?? [];
}

const labelDisplay = (score: number) => labelOf(verdictOf(score));

/** Row order here is the dashboard row order — keep stable. */
export const DEFAULT_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'ema',
    label: 'EMA Alignment',
    sub: '20 > 50 > 200',
    kind: 'label',
    category: 'trend',
    defaultWeight: 1,
    // M1.1: evaluation delegates to the EMA intelligence engine (score frozen there).
    evaluate: (candles) => evaluateEma(candles),
  },
  {
    id: 'supertrend',
    label: 'Supertrend',
    sub: '10,3',
    kind: 'label',
    category: 'trend',
    defaultWeight: 1,
    evaluate(candles, settings) {
      const plots = computeSuperTrend(candles, settings && { id: 'supertrend', settings }).plots;
      const stLine = lastNum(plotData(plots, 'supertrend'));
      const lastClose = candles[candles.length - 1]?.close ?? 0;
      const score = stLine == null ? 50 : lastClose > stLine ? 100 : 0;
      return { score, display: labelDisplay(score) };
    },
    subFor: (s) => `${s.inputs.atrPeriod ?? 10},${s.inputs.mult ?? 3}`,
  },
  {
    id: 'rsi',
    label: 'RSI',
    sub: '14',
    kind: 'value',
    category: 'momentum',
    defaultWeight: 1,
    // M1.x: delegates to the RSI intelligence engine (score frozen there).
    evaluate: (candles, settings) => evaluateRsi(candles, settings),
    subFor: (s) => `${s.inputs.length ?? 14}`,
  },
  {
    id: 'macd',
    label: 'MACD',
    sub: '12,26,9',
    kind: 'label',
    category: 'momentum',
    defaultWeight: 1,
    // M1.x: delegates to the MACD intelligence engine (score frozen there).
    evaluate: (candles, settings) => evaluateMacd(candles, settings),
    subFor: (s) => `${s.inputs.fast ?? 12},${s.inputs.slow ?? 26},${s.inputs.signal ?? 9}`,
  },
  {
    id: 'adx',
    label: 'ADX',
    sub: '14',
    kind: 'value',
    category: 'strength',
    defaultWeight: 1,
    evaluate(candles, settings) {
      const plots = computeAdx(candles, settings && { id: 'adx', settings }).plots;
      const adx = lastNum(plotData(plots, 'adx'));
      const plusDI = lastNum(plotData(plots, 'plusDI'));
      const minusDI = lastNum(plotData(plots, 'minusDI'));
      let score = 50;
      if (adx != null && plusDI != null && minusDI != null) {
        const dir = plusDI >= minusDI ? 1 : -1;
        score = 50 + dir * clamp(adx, 0, 50);
      }
      return { score, display: adx == null ? '—' : adx.toFixed(1) };
    },
    subFor: (s) => `${s.inputs.diLength ?? 14}`,
  },
  {
    id: 'obv',
    label: 'OBV',
    sub: 'On Balance Volume',
    kind: 'label',
    category: 'volume',
    defaultWeight: 1,
    evaluate(candles) {
      const obv = plotData(computeObv(candles).plots, 'obv');
      const last = lastNum(obv);
      const prevIdx = Math.max(0, obv.length - 15);
      const prev = typeof obv[prevIdx] === 'number' ? (obv[prevIdx] as number) : null;
      const score = last == null || prev == null ? 50 : last > prev ? 100 : last < prev ? 0 : 50;
      return { score, display: labelDisplay(score) };
    },
  },
  {
    id: 'volume',
    label: 'Volume',
    sub: 'vs 20 SMA',
    kind: 'value',
    category: 'volume',
    defaultWeight: 1,
    evaluate(candles) {
      const volumes = candles.map((c) => c.volume);
      const volSma = lastNum(pm.sma(volumes, 20));
      const lastVol = volumes[volumes.length - 1] ?? 0;
      const volPct = volSma && volSma > 0 ? (lastVol / volSma - 1) * 100 : 0;
      const score = clamp(50 + volPct / 2, 0, 100);
      return { score, display: `${volPct >= 0 ? '+' : ''}${volPct.toFixed(0)}%` };
    },
  },
];
