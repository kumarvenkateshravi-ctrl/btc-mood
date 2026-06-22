import * as its from 'indicatorts';
import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { alignRight, cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface MaRibbonInputs {
  fast: number;
  mid: number;
  slow: number;
}

const DEFAULTS: MaRibbonInputs = { fast: 9, mid: 21, slow: 50 };

/**
 * MA Ribbon — three EMAs (9 / 21 / 50 by default) drawn on the price pane.
 * Bucket A: math from `indicatorts.ema`. Trend read = stacking order of the
 * three lines; left as an overlay (no signals emitted here).
 */
export function computeMaRibbon(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { fast, mid, slow } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const c = cols.close(candles);

  const line = (
    period: number,
    id: string,
    color: string,
  ): IndicatorPlot => ({
    id,
    title: `EMA ${period}`,
    color,
    type: 'line',
    pane: 'overlay',
    lineWidth: 2,
    data: n >= period ? alignRight(its.ema(c, { period }), n) : new Array(n).fill(null),
  });

  return {
    plots: [
      line(fast, 'ema_fast', '#5aa2e6'),
      line(mid, 'ema_mid', '#f5b13b'),
      line(slow, 'ema_slow', '#a855f7'),
    ],
    signals: neutralSignals(n),
  };
}
