import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface BollingerInputs {
  length: number;
  mult: number;
}

const DEFAULTS: BollingerInputs = { length: 20, mult: 2 };

/**
 * Bollinger Bands (20, 2) — drawn on the price pane.
 *
 * Computed via `pineMath` rather than `indicatorts.bb` on purpose:
 * indicatorts' `bb()` hardcodes the multiplier and exposes only `period`,
 * whereas TradingView's BB is `sma(close, len) ± mult * stdev(close, len)`
 * with a configurable `mult` and *population* stdev — which `pm.stdev` already
 * implements (biased, divides by N). Matches TradingView.
 */
export function computeBollingerBands(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { length, mult } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const c = cols.close(candles);

  const basis = pm.sma(c, length);
  const dev = pm.multiply(pm.stdev(c, length), mult);
  const upper = pm.add(basis, dev);
  const lower = pm.subtract(basis, dev);

  const plots: IndicatorPlot[] = [
    { id: 'basis', title: 'Basis', color: '#FF6D00', type: 'line', pane: 'overlay', lineWidth: 2, data: basis },
    { id: 'upper', title: 'Upper', color: '#2962FF', type: 'line', pane: 'overlay', lineWidth: 1, data: upper },
    { id: 'lower', title: 'Lower', color: '#2962FF', type: 'line', pane: 'overlay', lineWidth: 1, data: lower },
  ];

  return { plots, signals: neutralSignals(n) };
}
