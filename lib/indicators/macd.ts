import * as its from 'indicatorts';
import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { alignRight, cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface MacdInputs {
  fast: number;
  slow: number;
  signal: number;
}

const DEFAULTS: MacdInputs = { fast: 12, slow: 26, signal: 9 };

const HIST_UP = '#26A69A';
const HIST_DOWN = '#F23645';

/**
 * MACD — drawn in a separate pane. Bucket A: `indicatorts.macd` gives the MACD
 * and signal lines (EMA-based, as in TradingView); the histogram is their
 * difference, colored by sign. macdLine and signalLine can differ in length
 * (signal is an extra EMA), so each is right-aligned independently.
 */
export function computeMacd(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { fast, slow, signal } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const c = cols.close(candles);

  if (n <= slow + signal) {
    const empty = new Array<number | null>(n).fill(null);
    return {
      plots: [
        { id: 'macd', title: 'MACD', color: '#2962FF', type: 'line', pane: 'separate', data: empty },
        { id: 'signal', title: 'Signal', color: '#FF6D00', type: 'line', pane: 'separate', data: empty },
        { id: 'hist', title: 'Histogram', color: '#7b88a0', type: 'histogram', pane: 'separate', data: empty },
      ],
      signals: neutralSignals(n),
    };
  }

  const r = its.macd(c, { fast, slow, signal });
  const macdLine = alignRight(r.macdLine, n);
  const signalLine = alignRight(r.signalLine, n);

  const hist = macdLine.map((m, i) => {
    const s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });
  const histColored = hist.map((h) =>
    h === null ? null : { value: h, color: h >= 0 ? HIST_UP : HIST_DOWN },
  );

  const plots: IndicatorPlot[] = [
    { id: 'macd', title: 'MACD', color: '#2962FF', type: 'line', pane: 'separate', lineWidth: 2, data: macdLine },
    { id: 'signal', title: 'Signal', color: '#FF6D00', type: 'line', pane: 'separate', lineWidth: 2, data: signalLine },
    { id: 'hist', title: 'Histogram', color: '#7b88a0', type: 'histogram', pane: 'separate', lineWidth: 4, data: histColored as IndicatorPlot['data'] },
  ];

  return { plots, signals: neutralSignals(n) };
}
