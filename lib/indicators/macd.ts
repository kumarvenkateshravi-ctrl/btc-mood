import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals, resolveInputs, resolveSourceNum } from './itsTemplates';
import * as pm from '../pineMath';

type MaType = 'EMA' | 'SMA';

export interface MacdInputs {
  fast: number;
  slow: number;
  signal: number;
  source: string;
  oscMaType: MaType;
  signalMaType: MaType;
}

const DEFAULTS: MacdInputs = {
  fast: 12,
  slow: 26,
  signal: 9,
  source: 'close',
  oscMaType: 'EMA',
  signalMaType: 'EMA',
};

// TradingView's default 4-state histogram palette.
const COL_GROW_ABOVE = '#26A69A'; // above zero, rising
const COL_FALL_ABOVE = '#B2DFDB'; // above zero, falling
const COL_GROW_BELOW = '#FFCDD2'; // below zero, rising
const COL_FALL_BELOW = '#FF5252'; // below zero, falling

function movingAverage(src: (number | null)[], length: number, type: MaType): (number | null)[] {
  // EMA uses TradingView's `ta.ema` seeding (emaPine); SMA uses `ta.sma`.
  return type === 'SMA' ? pm.sma(src, length) : pm.emaPine(src, length);
}

/**
 * MACD — faithful port of TradingView's built-in "MACD" indicator (separate pane).
 *
 *   fast_ma = oscMaType == "SMA" ? ta.sma(src, fast) : ta.ema(src, fast)
 *   slow_ma = oscMaType == "SMA" ? ta.sma(src, slow) : ta.ema(src, slow)
 *   macd    = fast_ma - slow_ma
 *   signal  = signalMaType == "SMA" ? ta.sma(macd, signal) : ta.ema(macd, signal)
 *   hist    = macd - signal
 *
 * With the EMA defaults this emits from the very first bars (ta.ema is
 * src-seeded), exactly like TradingView — not after a slow+signal warm-up gap.
 */
export function computeMacd(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
): IndicatorResult {
  const { fast, slow, signal, source, oscMaType, signalMaType } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const srcNum = resolveSourceNum(candles, source, computedSources);
  const src: (number | null)[] = srcNum.map((v) => (Number.isFinite(v) ? v : null));

  const fastMa = movingAverage(src, fast, oscMaType);
  const slowMa = movingAverage(src, slow, oscMaType);

  const macdLine = fastMa.map((f, i) => {
    const s = slowMa[i];
    return f != null && s != null ? f - s : null;
  });

  const signalLine = movingAverage(macdLine, signal, signalMaType);

  const hist = macdLine.map((m, i) => {
    const s = signalLine[i];
    return m != null && s != null ? m - s : null;
  });

  const histColored = hist.map((h, i) => {
    if (h == null) return null;
    const prev = i > 0 ? hist[i - 1] : null;
    const rising = prev != null && prev < h;
    const color =
      h >= 0
        ? rising
          ? COL_GROW_ABOVE
          : COL_FALL_ABOVE
        : rising
          ? COL_GROW_BELOW
          : COL_FALL_BELOW;
    return { value: h, color };
  });

  const plots: IndicatorPlot[] = [
    { id: 'macd', title: 'MACD', color: '#2962FF', type: 'line', pane: 'separate', lineWidth: 2, data: macdLine },
    { id: 'signal', title: 'Signal', color: '#FF6D00', type: 'line', pane: 'separate', lineWidth: 2, data: signalLine },
    { id: 'hist', title: 'Histogram', color: '#7b88a0', type: 'histogram', pane: 'separate', lineWidth: 4, data: histColored as IndicatorPlot['data'] },
  ];

  return { plots, signals: neutralSignals(n) };
}
