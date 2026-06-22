// Order-flow helpers: bucket trades into the current candle and accumulate
// buy/sell volume + delta. Pure + tested; the live panel wires the WebSocket.

import type { Timeframe } from './types';
import type { Trade } from './ws';
import { TF_SECONDS } from './confluence';

export interface DeltaAccumulator {
  /** Candle start bucket (unix seconds / tfSeconds), or null before the first trade. */
  bucket: number | null;
  buyVol: number;
  sellVol: number;
}

export function emptyDelta(): DeltaAccumulator {
  return { bucket: null, buyVol: 0, sellVol: 0 };
}

/** The candle bucket index a trade-time falls in for a timeframe (UTC-aligned). */
export function candleBucket(timeSec: number, tf: Timeframe): number {
  return Math.floor(timeSec / TF_SECONDS[tf]);
}

/**
 * Fold a trade into the accumulator. When the trade crosses into a new candle,
 * the accumulator resets first (delta is *per current candle*). Mutates and
 * returns `acc` for cheap in-place use on the hot path.
 */
export function accumulate(acc: DeltaAccumulator, trade: Trade, tf: Timeframe): DeltaAccumulator {
  const bucket = candleBucket(trade.time, tf);
  if (acc.bucket !== bucket) {
    acc.bucket = bucket;
    acc.buyVol = 0;
    acc.sellVol = 0;
  }
  if (trade.side === 'buy') acc.buyVol += trade.qty;
  else acc.sellVol += trade.qty;
  return acc;
}

/** Net delta = buy − sell volume for the current candle. */
export function delta(acc: DeltaAccumulator): number {
  return acc.buyVol - acc.sellVol;
}
