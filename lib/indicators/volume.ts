import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals } from './itsTemplates';

const UP = 'rgba(38, 166, 154, 0.5)';
const DOWN = 'rgba(242, 54, 69, 0.5)';

/**
 * Volume (raw) — per-bar volume histogram in a separate pane, colored by
 * candle direction (close ≥ open = up). No library needed.
 */
export function computeVolume(
  candles: Candle[],
  _config?: CustomIndicatorConfig,
): IndicatorResult {
  const n = candles.length;
  const data = candles.map((c) => ({
    value: c.volume,
    color: c.close >= c.open ? UP : DOWN,
  }));

  const plots: IndicatorPlot[] = [
    {
      id: 'volume',
      title: 'Volume',
      color: UP,
      type: 'histogram',
      pane: 'separate',
      data: data as IndicatorPlot['data'],
    },
  ];

  return { plots, signals: neutralSignals(n) };
}
