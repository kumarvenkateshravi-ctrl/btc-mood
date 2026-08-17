// Daily order flow — cumulative taker buy vs sell volume for the current UTC day.
//
// Distinct from lib/orderFlow.ts, which resets on every candle boundary to feed
// a per-candle delta readout. This one resets only when the UTC date rolls, so
// the two columns answer "who has been in control today".
//
// Two sources feed the same accumulator:
//   1. Backfill from klines (Binance gives taker-buy base volume per kline, so
//      the day up to now can be reconstructed on mount — a socket alone would
//      only ever show "since you opened the tab").
//   2. The live @aggTrade tape.
// A watermark stops the handover from double-counting.
//
// Pure + framework-free so it can be unit-tested without a socket.

import type { Candle } from './types';
import type { Trade } from './ws';

const SECONDS_PER_DAY = 86_400;

/** Cumulative-delta sparkline resolution: one point per 5 minutes of the day. */
export const SPARK_BUCKET_SECONDS = 300;
const SPARK_MAX_POINTS = Math.ceil(SECONDS_PER_DAY / SPARK_BUCKET_SECONDS); // 288

export interface DailyFlow {
  /** UTC day index (unix days), or null before any data. */
  day: number | null;
  buyVol: number;
  sellVol: number;
  /**
   * Highest trade/candle time already folded in. Live trades at or before this
   * are ignored, so a trade already inside a backfilled kline can't be counted
   * twice at the handover.
   */
  watermark: number;
  /**
   * Cumulative delta sampled per 5-minute bucket, indexed by bucket-of-day.
   * Sparse until filled; `sparkSeries()` compacts it for rendering.
   */
  spark: (number | null)[];
}

export function emptyDailyFlow(): DailyFlow {
  return {
    day: null,
    buyVol: 0,
    sellVol: 0,
    watermark: 0,
    spark: new Array(SPARK_MAX_POINTS).fill(null),
  };
}

/** UTC day index for a unix-seconds timestamp. */
export function utcDay(timeSec: number): number {
  return Math.floor(timeSec / SECONDS_PER_DAY);
}

function sparkBucket(timeSec: number): number {
  return Math.floor((timeSec % SECONDS_PER_DAY) / SPARK_BUCKET_SECONDS);
}

/** Wipe to a fresh day, preserving object identity for cheap in-place use. */
function resetTo(acc: DailyFlow, day: number): void {
  acc.day = day;
  acc.buyVol = 0;
  acc.sellVol = 0;
  acc.watermark = 0;
  acc.spark = new Array(SPARK_MAX_POINTS).fill(null);
}

/** Record the running cumulative delta into this time's sparkline bucket. */
function stampSpark(acc: DailyFlow, timeSec: number): void {
  acc.spark[sparkBucket(timeSec)] = acc.buyVol - acc.sellVol;
}

/**
 * Fold one live trade in. Resets first if the trade belongs to a new UTC day.
 * Trades at or before the watermark are skipped as already-counted.
 * Mutates and returns `acc` — this is the hot path.
 */
export function accumulateTrade(acc: DailyFlow, trade: Trade): DailyFlow {
  const day = utcDay(trade.time);
  if (acc.day !== day) resetTo(acc, day);
  else if (trade.time <= acc.watermark) return acc;

  if (trade.side === 'buy') acc.buyVol += trade.qty;
  else acc.sellVol += trade.qty;

  stampSpark(acc, trade.time);
  return acc;
}

/**
 * Seed from klines. Binance reports taker-buy base volume per kline, so:
 *   buy  = takerBuyVolume
 *   sell = volume − takerBuyVolume
 *
 * Only candles inside `day` (default: the newest candle's day) are used.
 * Candles lacking `takerBuyVolume` are skipped rather than guessed at — a
 * close-vs-open guess would silently fabricate order flow.
 *
 * Sets the watermark to the last seeded candle time so the live tape resumes
 * cleanly. Note the last kline is usually still open, so its trades continue
 * arriving on the socket; they are skipped up to the watermark and counted
 * after it. That leaves a sub-candle gap at the seam, which is the honest
 * tradeoff — see the widget's "backfilled" note.
 */
export function seedFromCandles(
  acc: DailyFlow,
  candles: Candle[],
  day?: number,
): DailyFlow {
  const usable = candles.filter(
    (c) => typeof c.takerBuyVolume === 'number' && Number.isFinite(c.takerBuyVolume),
  );
  if (usable.length === 0) return acc;

  const targetDay = day ?? utcDay(usable[usable.length - 1].time);
  const today = usable.filter((c) => utcDay(c.time) === targetDay);
  if (today.length === 0) return acc;

  resetTo(acc, targetDay);

  for (const c of today) {
    const buy = Math.max(0, Math.min(c.takerBuyVolume as number, c.volume));
    const sell = Math.max(0, c.volume - buy);
    acc.buyVol += buy;
    acc.sellVol += sell;
    stampSpark(acc, c.time);
  }

  acc.watermark = today[today.length - 1].time;
  return acc;
}

/** Drop everything (symbol switch — flow must never carry across symbols). */
export function resetDailyFlow(acc: DailyFlow): DailyFlow {
  acc.day = null;
  acc.buyVol = 0;
  acc.sellVol = 0;
  acc.watermark = 0;
  acc.spark = new Array(SPARK_MAX_POINTS).fill(null);
  return acc;
}

// ---- Derived metrics -------------------------------------------------------

export type FlowSide = 'buyers' | 'sellers' | 'balanced';

export interface DailyFlowStats {
  buyVol: number;
  sellVol: number;
  totalVol: number;
  /** buy − sell. Positive = buyers lifting offers. */
  delta: number;
  /** buy / (buy + sell), 0..1. The control figure, comparable across days. */
  buyShare: number;
  /** Signed 0..1 dominance of the leading side; 0 when perfectly balanced. */
  imbalance: number;
  dominant: FlowSide;
  hasData: boolean;
}

/** Inside this band of 50/50 the tape is called balanced rather than directional. */
const BALANCED_BAND = 0.02;

export function flowStats(acc: DailyFlow): DailyFlowStats {
  const totalVol = acc.buyVol + acc.sellVol;
  if (totalVol <= 0) {
    return {
      buyVol: 0,
      sellVol: 0,
      totalVol: 0,
      delta: 0,
      buyShare: 0.5,
      imbalance: 0,
      dominant: 'balanced',
      hasData: false,
    };
  }
  const buyShare = acc.buyVol / totalVol;
  const dominant: FlowSide =
    Math.abs(buyShare - 0.5) <= BALANCED_BAND
      ? 'balanced'
      : buyShare > 0.5
        ? 'buyers'
        : 'sellers';
  return {
    buyVol: acc.buyVol,
    sellVol: acc.sellVol,
    totalVol,
    delta: acc.buyVol - acc.sellVol,
    buyShare,
    imbalance: Math.abs(buyShare - 0.5) * 2,
    dominant,
    hasData: true,
  };
}

/**
 * Compact the sparse spark buffer into an ordered series for rendering.
 *
 * Quiet buckets *between* trades hold the previous value (delta is cumulative,
 * so a gap means "unchanged"). Buckets after the last trade are dropped rather
 * than held — they are the part of the day that hasn't happened yet, and
 * padding them would draw the morning's shape squashed against the left edge
 * with a long flat tail standing in for the future.
 */
export function sparkSeries(acc: DailyFlow): number[] {
  // Bound on the buffer, not on the output values: a flat day would otherwise
  // look like a trailing tail and get trimmed away entirely.
  let lastStamped = -1;
  for (let i = acc.spark.length - 1; i >= 0; i--) {
    if (acc.spark[i] != null) {
      lastStamped = i;
      break;
    }
  }
  if (lastStamped < 0) return [];

  const out: number[] = [];
  let last = 0;
  let seen = false;
  for (let i = 0; i <= lastStamped; i++) {
    const v = acc.spark[i];
    if (v == null) {
      if (seen) out.push(last); // hold the line through quiet buckets
      continue;
    }
    last = v;
    seen = true;
    out.push(v);
  }
  return out;
}
