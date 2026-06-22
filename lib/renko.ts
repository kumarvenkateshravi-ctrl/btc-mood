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

/** How the Renko box (brick) size is determined. */
export type RenkoMethod = 'traditional' | 'atr' | 'percentage';

export interface RenkoOptions {
  /**
   * Box-size assignment method:
   *   - 'traditional': fixed `brickSize` in price units.
   *   - 'atr':        ATR(`atrLength`) of the source candles (Wilder).
   *   - 'percentage': `percentage`% of the last traded price (LTP).
   * When omitted, the legacy `brickSize` / `autoBrick` fields are honored.
   */
  method?: RenkoMethod;
  /** Fixed brick size in price units (Traditional method). */
  brickSize?: number;
  /** ATR length for the ATR method (default 14). */
  atrLength?: number;
  /** Percent of the last traded price for the Percentage method (e.g. 0.5 = 0.5%). */
  percentage?: number;
  /**
   * @deprecated Legacy flag equivalent to `method: 'atr'` with `atrLength: 14`.
   * Kept so older callers/tests keep working.
   */
  autoBrick?: boolean;
}

/** UI-facing Renko configuration (concrete fields, no `undefined`). */
export interface RenkoConfig {
  method: RenkoMethod;
  /** Traditional box size in price units (null = use fallback). */
  boxSize: number | null;
  atrLength: number;
  /** Percent of LTP for the Percentage method. */
  percentage: number;
}

export const DEFAULT_RENKO: RenkoConfig = {
  method: 'atr',
  boxSize: null,
  atrLength: 14,
  percentage: 0.5,
};

export function renkoConfigToOptions(c: RenkoConfig): RenkoOptions {
  return {
    method: c.method,
    brickSize: c.boxSize ?? undefined,
    atrLength: c.atrLength,
    percentage: c.percentage,
  };
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

function atrBrick(candles: Candle[], length: number): number | null {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const a = its.atr(highs, lows, closes, { period: Math.max(1, length) }).atrLine;
  const last = a[a.length - 1];
  return last != null && last > 0 ? last : null;
}

function isPositive(n: number | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

function computeBrickSize(candles: Candle[], opts: RenkoOptions): number {
  // 1% of the first close — used as the universal fallback.
  const fallback = Math.max(0.0001, candles[0].close * 0.01);
  const ltp = candles[candles.length - 1].close;

  switch (opts.method) {
    case 'traditional':
      return isPositive(opts.brickSize) ? opts.brickSize : fallback;
    case 'atr':
      return atrBrick(candles, opts.atrLength ?? 14) ?? fallback;
    case 'percentage': {
      const v = ltp * ((opts.percentage ?? 0.5) / 100);
      return v > 0 ? v : fallback;
    }
    default:
      // Legacy path (no explicit method): honor brickSize, then autoBrick.
      if (isPositive(opts.brickSize)) return opts.brickSize;
      if (opts.autoBrick) return atrBrick(candles, 14) ?? fallback;
      return fallback;
  }
}

// Re-export the direction type for callers that want to color bricks
// by direction in the future.
export type RenkoDirection = Dir;
