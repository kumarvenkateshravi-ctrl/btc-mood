import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals } from './itsTemplates';

const SECONDS_PER_DAY = 86_400;

/**
 * VWAP — session-anchored Volume-Weighted Average Price, price pane.
 *
 * Implemented directly (not via `indicatorts.vwap`, which is a rolling-period
 * VWAP) because TradingView's default VWAP anchors to the trading *session*
 * and resets each day. We reset the cumulative sums at every UTC day boundary
 * and use the typical price (H+L+C)/3, matching TradingView's session VWAP.
 */
export function computeVwap(
  candles: Candle[],
  _config?: CustomIndicatorConfig,
): IndicatorResult {
  const n = candles.length;
  const data = new Array<number | null>(n).fill(null);

  let cumPV = 0;
  let cumV = 0;
  let currentDay: number | null = null;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const day = Math.floor(c.time / SECONDS_PER_DAY);
    if (day !== currentDay) {
      cumPV = 0;
      cumV = 0;
      currentDay = day;
    }
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    data[i] = cumV > 0 ? cumPV / cumV : null;
  }

  const plots: IndicatorPlot[] = [
    { id: 'vwap', title: 'VWAP', color: '#42a5f5', type: 'line', pane: 'overlay', lineWidth: 2, data },
  ];

  return { plots, signals: neutralSignals(n) };
}
