import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals, resolveInputs, resolveSourceNum } from './itsTemplates';
import { vwapPeriodKey, type VwapAnchor } from './vwapAnchor';

export interface VwapInputs {
  anchor: VwapAnchor;
  source: string;
}

// TradingView VWAP defaults: Anchor = Session, Source = hlc3.
const DEFAULTS: VwapInputs = { anchor: 'session', source: 'hlc3' };

/**
 * VWAP — faithful to TradingView's built-in "Volume Weighted Average Price":
 * within each anchored period, VWAP = Σ(src·vol)/Σvol. Source defaults to hlc3
 * and the anchor defaults to Session (UTC day), matching TV; Week/Month/Quarter/
 * Year re-anchor at the corresponding UTC calendar boundary.
 */
export function computeVwap(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
): IndicatorResult {
  const { anchor, source } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const src = resolveSourceNum(candles, source, computedSources);
  const data = new Array<number | null>(n).fill(null);

  let cumPV = 0;
  let cumV = 0;
  let period: number | null = null;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const key = vwapPeriodKey(c.time, anchor);
    if (key !== period) {
      cumPV = 0;
      cumV = 0;
      period = key;
    }
    cumPV += src[i] * c.volume;
    cumV += c.volume;
    data[i] = cumV > 0 ? cumPV / cumV : null;
  }

  const plots: IndicatorPlot[] = [
    { id: 'vwap', title: 'VWAP', color: '#42a5f5', type: 'line', pane: 'overlay', lineWidth: 2, data },
  ];

  return { plots, signals: neutralSignals(n) };
}
