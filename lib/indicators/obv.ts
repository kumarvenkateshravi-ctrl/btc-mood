import * as its from 'indicatorts';
import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { alignRight, cols, neutralSignals } from './itsTemplates';

/**
 * OBV — On-Balance Volume, separate pane. Bucket A: `indicatorts.obv`
 * (cumulative, no parameters; matches TradingView's running total).
 */
export function computeObv(
  candles: Candle[],
  _config?: CustomIndicatorConfig,
): IndicatorResult {
  const n = candles.length;
  const data =
    n > 0 ? alignRight(its.obv(cols.close(candles), cols.volume(candles)), n) : [];

  const plots: IndicatorPlot[] = [
    { id: 'obv', title: 'OBV', color: '#5aa2e6', type: 'line', pane: 'separate', lineWidth: 2, data },
  ];

  return { plots, signals: neutralSignals(n) };
}
