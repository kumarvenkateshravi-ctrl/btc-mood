// RSI overlay helpers for the "Moving Averages & FVG" composite.
// - rawRsi: TradingView's ta.rsi as a plain array (same formula as rsi.ts).
// - scaleToPrice: maps a 0–100 oscillator value onto the price axis.
// - crossSignals: confirmed buy/sell when the RSI-strength line crosses BOTH
//   the VWAP and MA-200 (the Pine's aboveBoth/belowBoth transitions).

import * as pm from '../../pineMath';

/** ta.rsi(src, len): rma of gains / rma of losses → 0..100 (down==0→100, up==0→0). */
export function rawRsi(src: (number | null)[], len: number): (number | null)[] {
  const n = src.length;
  const gain = new Array<number | null>(n).fill(null);
  const loss = new Array<number | null>(n).fill(null);
  for (let i = 1; i < n; i++) {
    const a = src[i];
    const b = src[i - 1];
    if (a == null || b == null) continue;
    const ch = a - b;
    gain[i] = Math.max(ch, 0);
    loss[i] = Math.max(-ch, 0);
  }
  const up = pm.rma(gain, len);
  const down = pm.rma(loss, len);
  const out = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const u = up[i];
    const d = down[i];
    if (u == null || d == null) continue;
    out[i] = d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d);
  }
  return out;
}

/** baseline + (v−50)/100 · priceRange — the Pine f_scale. */
export function scaleToPrice(v: number, baseline: number, priceRange: number): number {
  return baseline + ((v - 50) / 100) * priceRange;
}

/** Confirmed signals: strength above BOTH vwap and ma4 (buy) / below both (sell),
 *  firing only on the transition into that state. */
export function crossSignals(
  strength: (number | null)[],
  vwap: (number | null)[],
  ma4: (number | null)[],
): { buy: boolean[]; sell: boolean[] } {
  const n = strength.length;
  const above = new Array<boolean>(n).fill(false);
  const below = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const s = strength[i];
    const v = vwap[i];
    const m = ma4[i];
    if (s == null || v == null || m == null) continue;
    above[i] = s > v && s > m;
    below[i] = s < v && s < m;
  }
  const buy = new Array<boolean>(n).fill(false);
  const sell = new Array<boolean>(n).fill(false);
  // The first bar has no prior state (Pine's `[1]` is na there) → never fires.
  for (let i = 1; i < n; i++) {
    buy[i] = above[i] && !above[i - 1];
    sell[i] = below[i] && !below[i - 1];
  }
  return { buy, sell };
}

export interface SignalEvent {
  index: number;
  side: 'buy' | 'sell';
  /** 0–100 conviction: the strength line's separation beyond the NEARER
   *  confirmation line, measured in the RSI's OWN oscillator space (not price)
   *  and capped at 100. Higher = more decisive cross. See CONFIDENCE_FULL_SEP_OSC. */
  confidence: number;
}

/** Separation (in RSI oscillator points) that maps to 100% confidence. A cross
 *  with ~this much daylight above/below the confirmation lines is "very strong".
 *  Conservative default; tuned during practice; API stable. */
export const CONFIDENCE_FULL_SEP_OSC = 20;

export type ConfidenceBand = 'very strong' | 'strong' | 'moderate' | 'weak';
export function confidenceBand(c: number): ConfidenceBand {
  if (c >= 90) return 'very strong';
  if (c >= 70) return 'strong';
  if (c >= 50) return 'moderate';
  return 'weak';
}

/**
 * Confirmed Buy/Sell events with two noise controls on top of the base
 * strength-crosses-BOTH-lines rule:
 *   - `cooldownBars`: suppress a signal within N bars of the previous one.
 *   - `trendFilter`: BUY only when close > ma; SELL only when close < ma.
 * Confidence is the separation beyond the nearer confirmation line, divided by
 * `normalizer` (the RSI price-range per bar → oscillator space), scaled by
 * CONFIDENCE_FULL_SEP_OSC and capped at 100 — an intuitive 0–100 conviction.
 * Null-guarded (JS coerces null→0 in comparisons), never fires on bar 0, and
 * loops only up to `end` (exclusive) so the forming bar is excluded by the caller.
 */
export function emitCrossSignals(
  strength: (number | null)[],
  vwap: (number | null)[],
  ma: (number | null)[],
  closes: number[],
  opts: { cooldownBars?: number; trendFilter?: boolean; end?: number; normalizer?: (number | null)[] } = {},
): SignalEvent[] {
  const { cooldownBars = 0, trendFilter = false, end = strength.length, normalizer } = opts;
  const out: SignalEvent[] = [];
  let lastSignalBar = -Infinity;

  for (let i = 1; i < end; i++) {
    const s0 = strength[i - 1]; const s1 = strength[i];
    const m0 = ma[i - 1]; const m1 = ma[i];
    const v0 = vwap[i - 1]; const v1 = vwap[i];
    if (s0 == null || s1 == null || m0 == null || m1 == null || v0 == null || v1 == null) continue;

    const buy = !(s0 > m0 && s0 > v0) && s1 > m1 && s1 > v1;
    const sell = !(s0 < m0 && s0 < v0) && s1 < m1 && s1 < v1;
    if (!buy && !sell) continue;
    if (i - lastSignalBar < cooldownBars) continue;
    if (trendFilter && (buy ? !(closes[i] > m1) : !(closes[i] < m1))) continue;

    // Separation beyond the NEARER line, in the RSI's oscillator space.
    const gap = buy ? Math.min(s1 - v1, s1 - m1) : Math.min(v1 - s1, m1 - s1);
    const pr = normalizer?.[i] ?? null;
    const sepOsc = pr != null && pr > 0 ? (gap / pr) * 100 : 0;
    const confidence = Math.min(100, Math.max(0, Math.round((sepOsc / CONFIDENCE_FULL_SEP_OSC) * 100)));

    out.push({ index: i, side: buy ? 'buy' : 'sell', confidence });
    lastSignalBar = i;
  }
  return out;
}
