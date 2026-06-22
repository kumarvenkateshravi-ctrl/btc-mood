import * as its from 'indicatorts';
import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { alignRight, cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface AtrInputs {
  length: number;
}

const DEFAULTS: AtrInputs = { length: 14 };

/**
 * ATR (14) — volatility, separate pane. Bucket A: `indicatorts.atr` (Wilder
 * RMA smoothing). Returns the `atrLine`.
 */
export function computeAtr(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { length } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const data =
    n > length
      ? alignRight(
          its.atr(cols.high(candles), cols.low(candles), cols.close(candles), {
            period: length,
          }).atrLine,
          n,
        )
      : new Array(n).fill(null);

  const plots: IndicatorPlot[] = [
    { id: 'atr', title: `ATR ${length}`, color: '#ef6c00', type: 'line', pane: 'separate', lineWidth: 2, data },
  ];

  return { plots, signals: neutralSignals(n) };
}
