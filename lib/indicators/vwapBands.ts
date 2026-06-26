import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals, resolveInputs, resolveSourceNum } from './itsTemplates';
import { vwapPeriodKey, type VwapAnchor } from './vwapAnchor';

export interface VwapBandsInputs {
  mult1: number;
  mult2: number;
  anchor: VwapAnchor;
  source: string;
}

const DEFAULTS: VwapBandsInputs = { mult1: 1, mult2: 2, anchor: 'session', source: 'hlc3' };

/**
 * VWAP Bands — faithful to TradingView's VWAP standard-deviation bands.
 * Within each anchored period: vwap = Σ(src·vol)/Σvol and the band half-width is
 * mult · sqrt(max(0, Σ(src²·vol)/Σvol − vwap²)) — the volume-weighted variance
 * of the source around the VWAP, exactly as TV computes its bands. Anchor /
 * source default to Session / hlc3 like TradingView.
 */
export function computeVwapBands(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
): IndicatorResult {
  const { mult1, mult2, anchor, source } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const src = resolveSourceNum(candles, source, computedSources);

  const vwap = new Array<number | null>(n).fill(null);
  const u1 = new Array<number | null>(n).fill(null);
  const l1 = new Array<number | null>(n).fill(null);
  const u2 = new Array<number | null>(n).fill(null);
  const l2 = new Array<number | null>(n).fill(null);

  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  let period: number | null = null;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const key = vwapPeriodKey(c.time, anchor);
    if (key !== period) {
      cumPV = 0;
      cumV = 0;
      cumPV2 = 0;
      period = key;
    }
    const p = src[i];
    cumPV += p * c.volume;
    cumV += c.volume;
    cumPV2 += p * p * c.volume;

    if (cumV > 0) {
      const v = cumPV / cumV;
      const variance = Math.max(0, cumPV2 / cumV - v * v);
      const sd = Math.sqrt(variance);
      vwap[i] = v;
      u1[i] = v + mult1 * sd;
      l1[i] = v - mult1 * sd;
      u2[i] = v + mult2 * sd;
      l2[i] = v - mult2 * sd;
    }
  }

  const line = (id: string, title: string, color: string, data: (number | null)[], width = 1): IndicatorPlot => ({
    id,
    title,
    color,
    type: 'line',
    pane: 'overlay',
    lineWidth: width,
    data,
  });

  const plots: IndicatorPlot[] = [
    line('vwap', 'VWAP', '#42a5f5', vwap, 2),
    line('upper1', `+${mult1}σ`, '#7e9cb5', u1),
    line('lower1', `-${mult1}σ`, '#7e9cb5', l1),
    line('upper2', `+${mult2}σ`, '#5c7488', u2),
    line('lower2', `-${mult2}σ`, '#5c7488', l2),
  ];

  return { plots, signals: neutralSignals(n) };
}
