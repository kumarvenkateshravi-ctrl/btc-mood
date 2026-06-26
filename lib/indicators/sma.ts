import type { Candle } from '../types';
import type { IndicatorResult, CustomIndicatorConfig } from '../indicatorFramework';
import { resolveInputs, resolveSourceNum } from './itsTemplates';
import { sma } from '../pineMath';

export interface SmaInputs {
  length: number;
  source: string;
}

const DEFAULTS: SmaInputs = { length: 9, source: 'close' };

/**
 * SMA — Simple Moving Average over the chosen source. Plain SMA is unambiguous
 * (no seeding variant), so this matches TradingView's `ta.sma` exactly: the
 * first value lands at index `length-1` = mean of that window.
 */
export function computeSma(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
): IndicatorResult {
  const { length, source } = resolveInputs(config, DEFAULTS);
  const data = resolveSourceNum(candles, source, computedSources);
  const smaData = sma(data, Number(length));

  return {
    plots: [
      { id: 'smaLine', title: 'SMA', color: '#2962FF', type: 'line', data: smaData },
    ],
    signals: new Array(candles.length).fill('neutral'),
  };
}
