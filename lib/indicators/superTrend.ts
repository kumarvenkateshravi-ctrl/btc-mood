import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
  SignalSide,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { resolveInputs } from './itsTemplates';

export interface SuperTrendInputs {
  atrPeriod: number;
  mult: number;
}

// TradingView "Supertrend" defaults: ATR length 10, factor 3.
const DEFAULTS: SuperTrendInputs = { atrPeriod: 10, mult: 3 };

const UP = '#26A69A';
const DOWN = '#F23645';

/**
 * SuperTrend — ATR-banded trend follower on the price pane. Bucket B hand-port
 * (not in indicatorts), following the standard Pine algorithm:
 *
 *   basic bands = hl2 ± mult · ATR, then carried so the lower band only rises
 *   while price holds above it and the upper band only falls while price holds
 *   below. Trend flips when close crosses the opposite carried band.
 *
 * Emits buy/sell signals on the bar the trend flips.
 */
export function computeSuperTrend(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { atrPeriod, mult } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  // True range null on bar 0 so the Wilder ATR warms up like TradingView.
  const trL = new Array<number | null>(n).fill(null);
  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevClose = candles[i - 1].close;
    trL[i] = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
  }
  const atr = pm.rma(trL, atrPeriod);

  const lower = new Array<number | null>(n).fill(null); // support band (trend up)
  const upper = new Array<number | null>(n).fill(null); // resistance band (trend down)
  const trend = new Array<number>(n).fill(1);
  const stData = new Array<{ value: number; color: string } | null>(n).fill(null);
  const signals = new Array<SignalSide>(n).fill('neutral');

  for (let i = 0; i < n; i++) {
    const a = atr[i];
    if (a === null) {
      trend[i] = i > 0 ? trend[i - 1] : 1;
      continue;
    }
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicLower = hl2 - mult * a;
    const basicUpper = hl2 + mult * a;

    const prevLower = i > 0 && lower[i - 1] !== null ? (lower[i - 1] as number) : basicLower;
    const prevUpper = i > 0 && upper[i - 1] !== null ? (upper[i - 1] as number) : basicUpper;
    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;

    lower[i] = prevClose > prevLower ? Math.max(basicLower, prevLower) : basicLower;
    upper[i] = prevClose < prevUpper ? Math.min(basicUpper, prevUpper) : basicUpper;

    const prevTrend = i > 0 ? trend[i - 1] : 1;
    let t = prevTrend;
    if (prevTrend === -1 && candles[i].close > prevUpper) t = 1;
    else if (prevTrend === 1 && candles[i].close < prevLower) t = -1;
    trend[i] = t;

    if (i > 0 && t !== prevTrend) signals[i] = t === 1 ? 'buy' : 'sell';

    const value = t === 1 ? (lower[i] as number) : (upper[i] as number);
    stData[i] = { value, color: t === 1 ? UP : DOWN };
  }

  const plots: IndicatorPlot[] = [
    {
      id: 'supertrend',
      title: 'SuperTrend',
      color: UP,
      type: 'line',
      pane: 'overlay',
      lineWidth: 2,
      data: stData as IndicatorPlot['data'],
    },
  ];

  return { plots, signals };
}
