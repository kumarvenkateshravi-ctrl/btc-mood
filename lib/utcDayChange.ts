import type { Candle, Timeframe } from './types';

const SECONDS_PER_UTC_DAY = 24 * 60 * 60;

/** Returns the Unix-second timestamp for the UTC calendar day containing timeMs. */
export function utcDayStartSeconds(timeMs: number): number {
  return Math.floor(timeMs / 1000 / SECONDS_PER_UTC_DAY) * SECONDS_PER_UTC_DAY;
}

/**
 * Finds the opening price for the current UTC day. Daily and 4-hour candles
 * start exactly at 00:00 UTC; lower timeframes are fallbacks when a higher-TF
 * request has not arrived yet.
 */
export function findUtcDayOpen(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  timeMs = Date.now(),
): number | null {
  const dayStart = utcDayStartSeconds(timeMs);
  const fallbackOrder: Timeframe[] = ['1d', '4h', '1h', '30m', '15m', '5m'];

  for (const timeframe of fallbackOrder) {
    const candles = candlesByTf[timeframe] ?? [];
    const candle = candles.find((bar) => bar.time >= dayStart);
    if (candle && Number.isFinite(candle.open) && candle.open > 0) return candle.open;
  }

  return null;
}

export function computeUtcDayChange(
  price: number | null | undefined,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  timeMs = Date.now(),
): { absolute: number; percent: number } | null {
  if (price == null || !Number.isFinite(price)) return null;
  const dayOpen = findUtcDayOpen(candlesByTf, timeMs);
  if (dayOpen == null) return null;

  const absolute = price - dayOpen;
  return {
    absolute,
    percent: (absolute / dayOpen) * 100,
  };
}
