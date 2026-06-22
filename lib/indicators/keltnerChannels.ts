import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface KeltnerInputs {
  length: number;
  mult: number;
  atrLength: number;
}

// TradingView "Keltner Channels" defaults: EMA(20) basis, 2 × ATR(10).
const DEFAULTS: KeltnerInputs = { length: 20, mult: 2, atrLength: 10 };

/**
 * Keltner Channels — price pane.
 *
 * Computed via `pineMath` rather than `indicatorts.kc`: the library hardcodes
 * the multiplier and ties the ATR length to the EMA length, while TradingView
 * uses EMA(length) ± mult × ATR(atrLength) with a Wilder (RMA) ATR. We
 * reproduce that here for a faithful, configurable match.
 */
export function computeKeltnerChannels(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { length, mult, atrLength } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const c = cols.close(candles);

  const basis = pm.ema(c, length);
  const atr = pm.rma(pm.tr(candles), atrLength);
  const offset = pm.multiply(atr, mult);
  const upper = pm.add(basis, offset);
  const lower = pm.subtract(basis, offset);

  const plots: IndicatorPlot[] = [
    { id: 'basis', title: 'Basis', color: '#FF6D00', type: 'line', pane: 'overlay', lineWidth: 2, data: basis },
    { id: 'upper', title: 'Upper', color: '#26A69A', type: 'line', pane: 'overlay', lineWidth: 1, data: upper },
    { id: 'lower', title: 'Lower', color: '#26A69A', type: 'line', pane: 'overlay', lineWidth: 1, data: lower },
  ];

  return { plots, signals: neutralSignals(n) };
}
