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

  // Drop any malformed bars (null/NaN fields from bad WS frames or
  // an incomplete live candle). A single bad bar would propagate NaN
  // through all subsequent bricks and crash LWC with "Value is null".
  const valid = candles.filter(
    (c) =>
      c != null &&
      Number.isFinite(c.time as number) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close),
  );
  if (valid.length === 0) return [];

  const brick = computeBrickSize(valid, opts);
  if (!Number.isFinite(brick) || brick <= 0) return [];

  const out: Candle[] = [];

  // ── Grid-align the anchor (Traditional Renko) ─────────────────────────────
  // TradingView's Traditional Renko snaps the starting price to the nearest
  // multiple of `brick` *below* the first close, creating a price grid where
  // all brick boundaries are exact multiples of the brick size.
  //
  // Without this, bricks float from the raw close (e.g. $64,932.53) and all
  // subsequent boundaries are fractional — causing the entire pattern to
  // diverge from TradingView even with identical settings.
  const rawStart = valid[0].close;
  const gridStart = Math.floor(rawStart / brick) * brick;
  // Traditional Renko is direction-aware: a continuation needs 1× brick of
  // movement beyond the last close, but a REVERSAL needs 2× brick (the price
  // must retrace the whole last brick, then move one more). The reversal brick
  // attaches at the prior brick's OPEN, not its close, so bricks stay
  // contiguous (a down brick sits directly beneath the up brick it reverses).
  // Tracking only `lastClose` symmetrically — the old bug — produced a spurious
  // reversal brick after just 1× brick and diverged from TradingView.
  let lastOpen = gridStart;
  let lastClose = gridStart;
  let dir: 0 | 1 | -1 = 0;


  const firstTime = valid[0].time;
  // Anchor: a zero-width brick at the grid-aligned start so the chart always
  // has at least one bar. Placed 1 second before the first candle so all
  // subsequent bricks have strictly greater timestamps.
  pushBrick(out, lastClose, lastClose, firstTime - 1);

  // Estimate the typical interval between source candles so we can
  // spread multiple bricks generated from the same candle across a
  // realistic time window. Falls back to 60 seconds if indeterminate.
  const candleInterval =
    valid.length >= 2 ? (valid[1].time as number) - (valid[0].time as number) : 60;

  for (let i = 1; i < valid.length; i++) {
    const c = valid[i];
    const price = c.close;
    const srcTime = c.time as number;

    // Collect all the bricks generated from this source candle first,
    // then assign them evenly-spaced timestamps within the candle's
    // time slot so the axis shows the candle's real date.
    const pendingBricks: { open: number; close: number }[] = [];

    let safety = 0;
    while (safety++ < 10_000) {
      if (dir > 0) {
        // Last brick was UP.
        if (price >= lastClose + brick) {
          // Continuation up: open at the prior close.
          const open = lastClose;
          lastOpen = open;
          lastClose = open + brick;
          pendingBricks.push({ open, close: lastClose });
        } else if (price <= lastClose - 2 * brick) {
          // Reversal down: needs 2× brick; attaches at the prior brick's open.
          const open = lastOpen;
          lastClose = open - brick;
          lastOpen = open;
          dir = -1;
          pendingBricks.push({ open, close: lastClose });
        } else break;
      } else if (dir < 0) {
        // Last brick was DOWN.
        if (price <= lastClose - brick) {
          // Continuation down.
          const open = lastClose;
          lastOpen = open;
          lastClose = open - brick;
          pendingBricks.push({ open, close: lastClose });
        } else if (price >= lastClose + 2 * brick) {
          // Reversal up: 2× brick, attaches at the prior brick's open.
          const open = lastOpen;
          lastClose = open + brick;
          lastOpen = open;
          dir = 1;
          pendingBricks.push({ open, close: lastClose });
        } else break;
      } else {
        // No established direction yet (right after the grid anchor): the first
        // brick forms after 1× brick of movement in either direction.
        if (price >= lastClose + brick) {
          const open = lastClose;
          lastOpen = open;
          lastClose = open + brick;
          dir = 1;
          pendingBricks.push({ open, close: lastClose });
        } else if (price <= lastClose - brick) {
          const open = lastClose;
          lastOpen = open;
          lastClose = open - brick;
          dir = -1;
          pendingBricks.push({ open, close: lastClose });
        } else break;
      }
    }

    // Distribute the bricks across this candle's time window.
    // spacing = candleInterval / (count + 1) keeps them within the
    // slot and guarantees they are strictly greater than the previous
    // brick's time (which was at srcTime - candleInterval at the latest).
    const count = pendingBricks.length;
    for (let j = 0; j < count; j++) {
      // Map bricks across (prevSrcTime, srcTime] so the LAST brick from
      // this candle always lands exactly at srcTime. This guarantees the
      // most-recent candle's date (today) always appears on the x-axis.
      // fraction goes from 1/count ... count/count (= 1.0)
      const frac = (j + 1) / count;
      const t = Math.round(srcTime - candleInterval + frac * candleInterval);
      const lastOutTime = out.length > 0 ? out[out.length - 1].time : 0;
      // Guarantee strict monotonicity (fallback: last + 1)
      const finalTime = t > lastOutTime ? t : lastOutTime + 1;
      pushBrick(out, pendingBricks[j].open, pendingBricks[j].close, finalTime);
    }
  }

  // ── Forming (ghost) brick ──────────────────────────────────────────────────
  // Forming (ghost) brick — always represents today's incomplete movement.
  const lastCandle = valid[valid.length - 1];
  const formingClose = lastCandle.close;
  const lastOutTime = out.length > 0 ? out[out.length - 1].time : firstTime;
  // Use the last candle's actual timestamp so the axis shows the real date.
  // Add 1 to guarantee strict monotonicity if the timestamp is already used.
  const formingTime = lastCandle.time > lastOutTime ? lastCandle.time : lastOutTime + 1;
  out.push({
    time: formingTime,
    open: lastClose,
    close: formingClose,
    high: Math.max(lastClose, formingClose),
    low: Math.min(lastClose, formingClose),
    volume: 0,
  });

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
  // Guard: filter out any nullish/non-finite values that could propagate
  // NaN through the ATR calculation and produce a zero brick size.
  const highs = candles.map((c) => (Number.isFinite(c.high) ? c.high : 0));
  const lows = candles.map((c) => (Number.isFinite(c.low) ? c.low : 0));
  const closes = candles.map((c) => (Number.isFinite(c.close) ? c.close : 0));
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
