import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals, resolveInputs } from './itsTemplates';
import * as pm from '../pineMath';

type SmoothingType = 'RMA' | 'SMA' | 'EMA' | 'WMA';

export interface AtrInputs {
  length: number;
  smoothing: SmoothingType;
}

const DEFAULTS: AtrInputs = { length: 14, smoothing: 'RMA' };

function smooth(src: (number | null)[], length: number, type: SmoothingType): (number | null)[] {
  switch (type) {
    case 'SMA': return pm.sma(src, length);
    case 'EMA': return pm.emaPine(src, length); // TV ta.ema (src-seeded)
    case 'WMA': return pm.wma(src, length);
    case 'RMA':
    default:    return pm.rma(src, length); // Wilder, TV default
  }
}

/**
 * ATR — faithful port of TradingView's built-in "Average True Range":
 *
 *   ma_function(source, length) => switch smoothing { RMA|SMA|EMA|WMA }
 *   plot(ma_function(ta.tr(true), length))
 *
 * Default smoothing = RMA (Wilder). `ta.tr(true)` (handle_na=true) sets the
 * first bar's true range to high-low, which `pm.tr` already does — so the RMA's
 * SMA seed lands on bar `length-1`, exactly like TradingView.
 */
export function computeAtr(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { length, smoothing } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const trueRange = pm.tr(candles);
  const data = smooth(trueRange, length, smoothing);

  const plots: IndicatorPlot[] = [
    { id: 'atr', title: `ATR ${length}`, color: '#ef6c00', type: 'line', pane: 'separate', lineWidth: 2, data },
  ];

  return { plots, signals: neutralSignals(n) };
}
