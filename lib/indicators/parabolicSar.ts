import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { neutralSignals, resolveInputs } from './itsTemplates';

export interface PsarInputs {
  start: number;
  increment: number;
  max: number;
}

const DEFAULTS: PsarInputs = { start: 0.02, increment: 0.02, max: 0.2 };

const RISING = '#26A69A';
const FALLING = '#F23645';

/**
 * Parabolic SAR — line-for-line port of TradingView's `ta.sar` (the documented
 * `pine_sar` reference). Wilder's stop-and-reverse: AF starts at `start`, steps
 * by `increment` on each new extreme up to `max`, and the SAR is clamped to the
 * prior two bars' extremes so it never enters the current/previous range.
 * `result` is na on bar 0 and emitted from bar 1, exactly like TradingView.
 */
function sar(candles: Candle[], start: number, increment: number, max: number): (number | null)[] {
  const n = candles.length;
  const out = new Array<number | null>(n).fill(null);
  if (n < 2) return out;

  let result = 0;
  let maxMin = 0;
  let acceleration = start;
  let isBelow = false;

  for (let i = 1; i < n; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const close = candles[i].close;
    let isFirstTrendBar = false;

    // Initialize on the second bar (bar_index == 1).
    if (i === 1) {
      acceleration = start;
      if (close > candles[i - 1].close) {
        isBelow = true;
        maxMin = high;
        result = candles[i - 1].low;
      } else {
        isBelow = false;
        maxMin = low;
        result = candles[i - 1].high;
      }
      isFirstTrendBar = true;
    }

    result = result + acceleration * (maxMin - result);

    // Reversal checks.
    if (isBelow) {
      if (result > low) {
        isFirstTrendBar = true;
        isBelow = false;
        result = Math.max(high, maxMin);
        maxMin = low;
        acceleration = start;
      }
    } else {
      if (result < high) {
        isFirstTrendBar = true;
        isBelow = true;
        result = Math.min(low, maxMin);
        maxMin = high;
        acceleration = start;
      }
    }

    // Advance the acceleration factor on a new extreme (unless we just flipped).
    if (!isFirstTrendBar) {
      if (isBelow) {
        if (high > maxMin) {
          maxMin = high;
          acceleration = Math.min(acceleration + increment, max);
        }
      } else {
        if (low < maxMin) {
          maxMin = low;
          acceleration = Math.min(acceleration + increment, max);
        }
      }
    }

    // Clamp SAR to the prior two bars' extremes.
    if (isBelow) {
      result = Math.min(result, candles[i - 1].low);
      if (i > 1) result = Math.min(result, candles[i - 2].low);
    } else {
      result = Math.max(result, candles[i - 1].high);
      if (i > 1) result = Math.max(result, candles[i - 2].high);
    }

    out[i] = result;
  }
  return out;
}

/**
 * Parabolic SAR indicator — trailing stop-and-reverse dots on the price pane.
 * Each point is colored by trend (dot at or below close = rising/green, above =
 * falling/red). The math is TradingView's `ta.sar` exactly (see `sar` above).
 */
export function computeParabolicSar(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { start, increment, max } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const vals = sar(candles, start, increment, max);
  const colored = vals.map((v, i) =>
    v === null ? null : { value: v, color: v <= candles[i].close ? RISING : FALLING },
  );

  const plots: IndicatorPlot[] = [
    { id: 'psar', title: 'PSAR', color: RISING, type: 'line', pane: 'overlay', lineWidth: 2, data: colored as IndicatorPlot['data'] },
  ];

  return { plots, signals: neutralSignals(n) };
}
