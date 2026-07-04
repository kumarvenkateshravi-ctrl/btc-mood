import type { Candle } from '../types';
import type { IndicatorResult, IndicatorLevel, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

interface MagicSrInputs { lookback: number; count: number; showUp: boolean; showDown: boolean; }
const DEFAULTS: MagicSrInputs = { lookback: 10, count: 3, showUp: true, showDown: true };

const RES = '#5aa2e6';
const SUP = '#f23645';

/** Pivot high at i: high[i] is the strict max of high[i-L..i+L] (needs L bars
 *  each side). Pivot low symmetric. Emits the nearest `count` pivots above/below
 *  the last close as resistance/support levels. */
export function computeMagicSr(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { lookback: L, count, showUp, showDown } = resolveInputs<MagicSrInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = L; i < n - L; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivotHighs.push(candles[i].high);
    if (isLow) pivotLows.push(candles[i].low);
  }

  const lastClose = candles[n - 1].close;
  const levels: IndicatorLevel[] = [];

  if (showUp) {
    pivotHighs.filter((p) => p > lastClose)
      .sort((a, b) => a - b).slice(0, count)
      .forEach((p) => levels.push({ value: p, color: RES, lineStyle: 'solid', lineWidth: 1, title: 'R' }));
  }
  if (showDown) {
    pivotLows.filter((p) => p < lastClose)
      .sort((a, b) => b - a).slice(0, count)
      .forEach((p) => levels.push({ value: p, color: SUP, lineStyle: 'solid', lineWidth: 1, title: 'S' }));
  }

  return { plots: [], signals, levels };
}
