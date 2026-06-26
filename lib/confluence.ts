// Multi-timeframe confluence ribbon data.
//
// Turns each timeframe's candles into a *per-bar* signal series (the same
// EMA9/EMA21 + RSI scoring the verdict uses, via `scoreSignal`), then maps
// those signals onto a shared time domain so all six timeframes can be drawn
// as one time-aligned heatmap beneath the chart. Pure + deterministic so it's
// unit-testable; the component is a thin renderer over this.

import type { Candle, Timeframe, Signal } from './types';
import { ema, rsi } from './indicators';
import { scoreSignal } from './signals';

export type Side = Signal['side']; // 'buy' | 'sell' | 'neutral'

export const TF_SECONDS: Record<Timeframe, number> = {
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/**
 * Per-bar signal for a candle series: EMA9 vs EMA21 (direction) + RSI(14)
 * lean, scored exactly like the per-timeframe verdict so the ribbon can never
 * disagree with the mood read. Bars without enough warm-up score 'neutral'.
 */
export function perBarSignals(candles: Candle[]): Side[] {
  if (candles.length === 0) return [];
  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r14 = rsi(closes, 14);
  return candles.map((_, i) => scoreSignal(e9[i] ?? null, e21[i] ?? null, r14[i] ?? null).side);
}

export interface RibbonSegment {
  /** Left edge as a percentage [0,100] of the time domain. */
  leftPct: number;
  /** Width as a percentage of the time domain. */
  widthPct: number;
  side: Side;
}

/**
 * Map a timeframe's per-bar signals onto the shared time domain [t0, t1]
 * (seconds), returning positioned segments. Consecutive same-side bars are
 * merged to keep the DOM light. Bars fully outside the domain are dropped;
 * the first/last partial bars are clipped to the edges.
 */
export function buildRibbonSegments(
  candles: Candle[],
  tf: Timeframe,
  t0: number,
  t1: number,
): RibbonSegment[] {
  const span = t1 - t0;
  if (!(span > 0) || candles.length === 0) return [];
  const sides = perBarSignals(candles);
  const interval = TF_SECONDS[tf];

  const segs: RibbonSegment[] = [];
  for (let i = 0; i < candles.length; i++) {
    const start = candles[i].time;
    const end = start + interval;
    if (end <= t0 || start >= t1) continue;
    const l = Math.max(0, (start - t0) / span);
    const r = Math.min(1, (end - t0) / span);
    if (r <= l) continue;

    const side = sides[i];
    const last = segs[segs.length - 1];
    // Merge with the previous segment when it's the same side and contiguous.
    if (last && last.side === side && Math.abs(last.leftPct + last.widthPct - l * 100) < 1e-6) {
      last.widthPct = r * 100 - last.leftPct;
    } else {
      segs.push({ leftPct: l * 100, widthPct: (r - l) * 100, side });
    }
  }
  return segs;
}
