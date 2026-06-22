import * as its from 'indicatorts';
import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { alignRight, cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface StochasticInputs {
  kPeriod: number;
  smoothK: number;
  dPeriod: number;
}

// TradingView's built-in "Stochastic" defaults: %K length 14, %K smoothing 3,
// %D smoothing 3 (the "slow" stochastic).
const DEFAULTS: StochasticInputs = { kPeriod: 14, smoothK: 3, dPeriod: 3 };

/**
 * Stochastic (14, 3, 3) — separate pane.
 *
 * `indicatorts.stoch` returns the *raw* fast %K (and a %D = SMA(rawK, dPeriod))
 * but exposes no %K smoothing, so its output does NOT match TradingView's
 * default slow stochastic. We take only the raw %K, apply the `smoothK` SMA to
 * get slow %K, then %D = SMA(slow %K, dPeriod) — which matches TradingView.
 */
export function computeStochastic(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { kPeriod, smoothK, dPeriod } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const empty = new Array<number | null>(n).fill(null);
  if (n <= kPeriod) {
    return {
      plots: [
        { id: 'k', title: '%K', color: '#2962FF', type: 'line', pane: 'separate', data: empty },
        { id: 'd', title: '%D', color: '#FF6D00', type: 'line', pane: 'separate', data: empty },
      ],
      signals: neutralSignals(n),
    };
  }

  const rawK = alignRight(
    its.stoch(cols.high(candles), cols.low(candles), cols.close(candles), {
      kPeriod,
      dPeriod, // unused output; we recompute %D below from slow %K
    }).k,
    n,
  );
  const slowK = pm.sma(rawK, smoothK);
  const d = pm.sma(slowK, dPeriod);

  const plots: IndicatorPlot[] = [
    { id: 'k', title: '%K', color: '#2962FF', type: 'line', pane: 'separate', lineWidth: 2, data: slowK },
    { id: 'd', title: '%D', color: '#FF6D00', type: 'line', pane: 'separate', lineWidth: 2, data: d },
  ];

  return { plots, signals: neutralSignals(n) };
}
