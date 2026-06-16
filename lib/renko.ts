// Renko brick construction from time-based OHLC candles.
//
// Renko bricks ignore time and emit a new brick only when price moves
// at least `brickSize` in one direction. Each brick's `open` is the
// prior brick's `close` and the new brick's `close` is `open ±
// brickSize`. The high/low are set to the brick's two corners so
// lightweight-charts draws a clean rectangle body.
//
// The output is a `Candle[]` with synthetic `time` values: strictly
// increasing timestamps starting from the source's first candle,
// one second apart, so the time axis can scroll through them in
// order.

import * as its from 'indicatorts';
import type { Candle } from './types';

export interface RenkoOptions {
  /** Fixed brick size in price units. Mutually exclusive with `autoBrick`. */
  brickSize?: number;
  /**
   * If true, brick size is derived from the source's ATR(14) using
   * Wilder smoothing. Falls back to 1% of the first close if the ATR
   * seed hasn't filled yet (e.g. fewer than 15 bars).
   */
  autoBrick?: boolean;
}

type Dir = 1 | -1;

export function toRenko(candles: Candle[], opts: RenkoOptions = {}): Candle[] {
  if (candles.length === 0) return [];

  const brick = computeBrickSize(candles, opts);
  if (!Number.isFinite(brick) || brick <= 0) return [];

  const out: Candle[] = [];
  let lastClose = candles[0].close;
  let timeBase = candles[0].time;

  // Anchor: a degenerate zero-width brick at the first close so the
  // chart has at least one bar to render. Subsequent bricks move
  // strictly by `brick`.
  pushBrick(out, lastClose, lastClose, timeBase++);

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const price = c.close;
    // Each source bar can produce multiple Renko bricks if it spans
    // more than one brick boundary. Use the bar's high/low to extract
    // as many discrete bricks as the move contains.
    let safety = 0;
    while (safety++ < 10_000) {
      const diff = price - lastClose;
      if (diff >= brick) {
        const n = Math.floor(diff / brick);
        for (let k = 0; k < n; k++) {
          const prev = lastClose;
          lastClose = prev + brick;
          pushBrick(out, prev, lastClose, timeBase++);
        }
      } else if (diff <= -brick) {
        const n = Math.floor(-diff / brick);
        for (let k = 0; k < n; k++) {
          const prev = lastClose;
          lastClose = prev - brick;
          pushBrick(out, prev, lastClose, timeBase++);
        }
      } else {
        break;
      }
    }
  }

  return out;
}

function pushBrick(out: Candle[], open: number, close: number, time: number) {
  out.push({
    time,
    open,
    close,
    high: Math.max(open, close),
    low: Math.min(open, close),
    volume: 0, // Renko has no volume concept; the chart hides vol.
  });
}

function computeBrickSize(candles: Candle[], opts: RenkoOptions): number {
  if (opts.brickSize != null && Number.isFinite(opts.brickSize) && opts.brickSize > 0) {
    return opts.brickSize;
  }
  if (opts.autoBrick) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const a = its.atr(highs, lows, closes, { period: 14 }).atrLine;
    const last = a[a.length - 1];
    if (last != null && last > 0) return last;
  }
  // Default: 1% of the first close (also the fallback for auto with
  // too few bars for an ATR seed).
  return Math.max(0.0001, candles[0].close * 0.01);
}

// Re-export the direction type for callers that want to color bricks
// by direction in the future.
export type RenkoDirection = Dir;
