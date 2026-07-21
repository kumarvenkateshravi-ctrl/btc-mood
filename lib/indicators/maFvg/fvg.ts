// Fair Value Gap engine — faithful port of the LuxAlgo FVG module
// (CC BY-NC-SA 4.0, © LuxAlgo). Pure: detects 3-bar gaps on the chart series,
// tracks mitigation, and reports counts. The composite turns these records into
// band boxes + unmitigated level lines.
//
// Detection (bar i, using i, i-1, i-2), verbatim from the Pine:
//   bull: low[i] > high[i-2] ∧ close[i-1] > high[i-2] ∧ (low[i]-high[i-2])/high[i-2] > threshold
//         → gap [top=low[i], bottom=high[i-2]]
//   bear: high[i] < low[i-2] ∧ close[i-1] < low[i-2] ∧ (low[i-2]-high[i])/high[i] > threshold
//         → gap [top=low[i-2], bottom=high[i]]
//   threshold = auto ? mean_{0..i}((high-low)/low) : thresholdPct/100
// Mitigation: bull filled when close < bottom; bear filled when close > top.

import type { Candle } from '../../types';

export interface Fvg {
  isBull: boolean;
  top: number;
  bottom: number;
  /** Formation bar index (the box's left edge is startIndex-2). */
  startIndex: number;
  /** Bar index where the gap was filled, or null if still open at series end. */
  endIndex: number | null;
}

export interface FvgResult {
  fvgs: Fvg[];
  bullCount: number;
  bearCount: number;
  bullMitigated: number;
  bearMitigated: number;
}

export function detectFvgs(
  candles: Candle[],
  opts: { thresholdPct?: number; auto?: boolean } = {},
): FvgResult {
  const { thresholdPct = 0, auto = false } = opts;
  const n = candles.length;
  const fvgs: Fvg[] = [];
  let bullCount = 0;
  let bearCount = 0;
  let bullMitigated = 0;
  let bearMitigated = 0;

  let cumRange = 0; // Σ (high-low)/low, for the auto threshold's running mean.

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    cumRange += (c.high - c.low) / c.low;

    // Mitigation check runs every bar against all still-open gaps.
    for (const g of fvgs) {
      if (g.endIndex !== null) continue;
      if (g.isBull ? c.close < g.bottom : c.close > g.top) {
        g.endIndex = i;
        if (g.isBull) bullMitigated += 1;
        else bearMitigated += 1;
      }
    }

    if (i < 2) continue;
    const threshold = auto ? cumRange / i : thresholdPct / 100;
    const h2 = candles[i - 2].high;
    const l2 = candles[i - 2].low;
    const prevClose = candles[i - 1].close;

    const bull = c.low > h2 && prevClose > h2 && (c.low - h2) / h2 > threshold;
    const bear = c.high < l2 && prevClose < l2 && (l2 - c.high) / c.high > threshold;

    if (bull) {
      fvgs.push({ isBull: true, top: c.low, bottom: h2, startIndex: i, endIndex: null });
      bullCount += 1;
    } else if (bear) {
      fvgs.push({ isBull: false, top: l2, bottom: c.high, startIndex: i, endIndex: null });
      bearCount += 1;
    }
  }

  return { fvgs, bullCount, bearCount, bullMitigated, bearMitigated };
}
