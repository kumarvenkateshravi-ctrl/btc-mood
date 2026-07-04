import type { Candle } from '../types';
import type { IndicatorResult, IndicatorLevel, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { priorPeriodOHLC, type HtfPeriod } from './htf';

interface FibPivotInputs { period: string; f1: number; f2: number; f3: number; }
const DEFAULTS: FibPivotInputs = { period: 'D', f1: 0.382, f2: 0.618, f3: 1.0 };

const P_COLOR = '#FF6D00';
const R_COLOR = '#5aa2e6';
const S_COLOR = '#f23645';

/** Classic Fibonacci pivots from the prior D/W/M range: P=(H+L+C)/3,
 *  R/S at P ± f×(H−L). Levels use the current period's prior-period values. */
export function computeFibPivot(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { period, f1, f2, f3 } = resolveInputs<FibPivotInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const tf: HtfPeriod = period === 'W' ? 'W' : period === 'M' ? 'M' : 'D';
  if (n === 0) return { plots: [], signals };

  const prior = priorPeriodOHLC(candles, tf);
  const p = prior[n - 1]; // current period's prior-period OHLC
  if (!p) return { plots: [], signals };

  const pivot = (p.high + p.low + p.close) / 3;
  const range = p.high - p.low;
  const levels: IndicatorLevel[] = [
    { value: pivot, color: P_COLOR, lineStyle: 'solid', lineWidth: 1, title: 'P' },
    { value: pivot + f1 * range, color: R_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'R1' },
    { value: pivot + f2 * range, color: R_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'R2' },
    { value: pivot + f3 * range, color: R_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'R3' },
    { value: pivot - f1 * range, color: S_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'S1' },
    { value: pivot - f2 * range, color: S_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'S2' },
    { value: pivot - f3 * range, color: S_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'S3' },
  ];
  return { plots: [], signals, levels };
}
