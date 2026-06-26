import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals } from './itsTemplates';

/**
 * OBV — faithful port of TradingView's built-in "On Balance Volume":
 *
 *   obv = ta.cum(math.sign(ta.change(close)) * volume)
 *
 * `ta.change(close)` is na on bar 0, so OBV is na there and accumulates from
 * bar 1: OBV[i] = nz(OBV[i-1]) + sign(close[i] - close[i-1]) * volume[i]. An
 * unchanged close contributes 0 (sign 0).
 */
export function computeObv(
  candles: Candle[],
  _config?: CustomIndicatorConfig,
): IndicatorResult {
  const n = candles.length;
  const data = new Array<number | null>(n).fill(null);

  let running = 0;
  for (let i = 1; i < n; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const sign = change > 0 ? 1 : change < 0 ? -1 : 0;
    running += sign * candles[i].volume;
    data[i] = running;
  }

  const plots: IndicatorPlot[] = [
    { id: 'obv', title: 'OBV', color: '#5aa2e6', type: 'line', pane: 'separate', lineWidth: 2, data },
  ];

  return { plots, signals: neutralSignals(n) };
}
