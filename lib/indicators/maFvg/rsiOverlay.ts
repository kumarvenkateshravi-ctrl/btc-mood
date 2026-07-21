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
