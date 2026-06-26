import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  IndicatorLevel,
  IndicatorFill,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { neutralSignals, resolveInputs, cols } from './itsTemplates';

export interface StochasticInputs {
  kPeriod: number;
  smoothK: number;
  dPeriod: number;
}

// TradingView's built-in "Stochastic" defaults (published Pine):
//   %K Length = 14, %K Smoothing = 1, %D Smoothing = 3.
const DEFAULTS: StochasticInputs = { kPeriod: 14, smoothK: 1, dPeriod: 3 };

const BAND_COLOR = '#787B86';
const FILL_COLOR = 'rgba(33, 150, 243, 0.1)'; // TV background fill

/**
 * ta.stoch(close, high, low, length):
 *   100 * (close - lowest(low, length)) / (highest(high, length) - lowest(low, length))
 * Emits from bar `length-1`; a zero range (highest == lowest) is na, like Pine.
 */
function stoch(high: number[], low: number[], close: number[], length: number): (number | null)[] {
  const hh = pm.highest(high, length);
  const ll = pm.lowest(low, length);
  const out = new Array<number | null>(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    const h = hh[i];
    const l = ll[i];
    if (h == null || l == null) continue;
    const range = h - l;
    out[i] = range === 0 ? null : (100 * (close[i] - l)) / range;
  }
  return out;
}

/**
 * Stochastic — faithful port of TradingView's built-in "Stochastic":
 *   k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)
 *   d = ta.sma(k, periodD)
 * plus the 80 / 50 / 20 bands and the blue background fill TV draws.
 */
export function computeStochastic(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { kPeriod, smoothK, dPeriod } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const rawK = stoch(cols.high(candles), cols.low(candles), cols.close(candles), kPeriod);
  const k = pm.sma(rawK, smoothK);
  const d = pm.sma(k, dPeriod);

  const plots: IndicatorPlot[] = [
    { id: 'k', title: '%K', color: '#2962FF', type: 'line', pane: 'separate', lineWidth: 2, data: k },
    { id: 'd', title: '%D', color: '#FF6D00', type: 'line', pane: 'separate', lineWidth: 2, data: d },
  ];

  const levels: IndicatorLevel[] = [
    { value: 80, color: BAND_COLOR, title: 'Upper' },
    { value: 50, color: BAND_COLOR, lineStyle: 'dashed', title: 'Middle' },
    { value: 20, color: BAND_COLOR, title: 'Lower' },
  ];
  const fills: IndicatorFill[] = [{ from: 80, to: 20, color: FILL_COLOR }];

  return { plots, levels, fills, signals: neutralSignals(n) };
}
