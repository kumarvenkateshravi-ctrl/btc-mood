// The fixed seven-indicator roster of the MTF Engine — a lightweight registry
// of metadata + delegation. All evaluation (frozen M0 scores + M1 indicator-
// local intelligence) lives in the per-indicator modules under ./indicators/.
// Specs: docs/superpowers/specs/2026-07-18-m1-indicator-intelligence-contract-ema-engine-design.md
//        docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md

import type { IndicatorDefinition } from './types';
import { evaluateEma } from './indicators/ema';
import { evaluateRsi } from './indicators/rsi';
import { evaluateMacd } from './indicators/macd';
import { evaluateAdx } from './indicators/adx';
import { evaluateSupertrend } from './indicators/supertrend';
import { evaluateObv } from './indicators/obv';
import { evaluateVolume } from './indicators/volume';

/** Row order here is the dashboard row order — keep stable. */
export const DEFAULT_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'ema',
    label: 'EMA Alignment',
    sub: '20 > 50 > 200',
    kind: 'label',
    category: 'trend',
    defaultWeight: 1,
    evaluate: (candles) => evaluateEma(candles),
  },
  {
    id: 'supertrend',
    label: 'Supertrend',
    sub: '10,3',
    kind: 'label',
    category: 'trend',
    defaultWeight: 1,
    evaluate: (candles, settings) => evaluateSupertrend(candles, settings),
    subFor: (s) => `${s.inputs.atrPeriod ?? 10},${s.inputs.mult ?? 3}`,
  },
  {
    id: 'rsi',
    label: 'RSI',
    sub: '14',
    kind: 'value',
    category: 'momentum',
    defaultWeight: 1,
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
    evaluate: (candles, settings) => evaluateAdx(candles, settings),
    subFor: (s) => `${s.inputs.diLength ?? 14}`,
  },
  {
    id: 'obv',
    label: 'OBV',
    sub: 'On Balance Volume',
    kind: 'label',
    category: 'volume',
    defaultWeight: 1,
    evaluate: (candles) => evaluateObv(candles),
  },
  {
    id: 'volume',
    label: 'Volume',
    sub: 'vs 20 SMA',
    kind: 'value',
    category: 'volume',
    defaultWeight: 1,
    evaluate: (candles) => evaluateVolume(candles),
  },
];
