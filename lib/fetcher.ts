import { CandleArraySchema } from './schemas';
import type { Candle, Timeframe } from './types';
import type { CompareSymbol } from './compare';

export class RateLimitedError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(message: string, status: number, retryAfter: number | null) {
    super(message);
    this.name = 'RateLimitedError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class KlinesError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'KlinesError';
    this.status = status;
  }
}

/**
 * Fetches historical candles for one TF + symbol. Validates the
 * response with Zod so a malformed payload throws instead of crashing
 * the chart renderer later.
 */
export async function fetchKlinesTyped(
  tf: Timeframe,
  symbol: CompareSymbol = 'BTCUSDT',
  signal?: AbortSignal,
): Promise<Candle[]> {
  const params = new URLSearchParams({ tf, symbol });
  const res = await fetch(`/api/klines?${params.toString()}`, {
    signal,
    cache: 'no-store',
  });
  if (res.status === 429) {
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : null;
    throw new RateLimitedError(
      'rate_limited',
      res.status,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
  if (!res.ok) {
    throw new KlinesError(`klines_${res.status}`, res.status);
  }
  const raw: unknown = await res.json();
  const parsed = CandleArraySchema.safeParse(raw);
  if (!parsed.success) {
    throw new KlinesError('invalid_payload', 502);
  }
  return parsed.data;
}

/**
 * Fetch one older page of candles ending strictly before `beforeMs` (the open
 * time, in ms, of the oldest bar currently loaded). Used by the chart's
 * lazy-load-on-scroll to extend history backward.
 */
export async function fetchKlinesBefore(
  tf: Timeframe,
  symbol: CompareSymbol,
  beforeMs: number,
  limit = 1000,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    tf,
    symbol,
    before: String(Math.floor(beforeMs)),
    limit: String(limit),
  });
  const res = await fetch(`/api/klines?${params.toString()}`, { signal, cache: 'no-store' });
  if (res.status === 429) {
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : null;
    throw new RateLimitedError('rate_limited', res.status, Number.isFinite(retryAfter) ? retryAfter : null);
  }
  if (!res.ok) throw new KlinesError(`klines_${res.status}`, res.status);
  const raw: unknown = await res.json();
  const parsed = CandleArraySchema.safeParse(raw);
  if (!parsed.success) throw new KlinesError('invalid_payload', 502);
  return parsed.data;
}

/**
 * Fetches the smallest REST page that can contain a detected candle gap and
 * returns only its requested open-time range. The API's `before` cursor is an
 * exclusive upper bound, so `endMs` is the following known candle's open.
 */
export async function fetchKlinesRange(
  tf: Timeframe,
  symbol: CompareSymbol,
  startMs: number,
  endMs: number,
  limit: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const candles = await fetchKlinesBefore(tf, symbol, endMs, limit, signal);
  return candles.filter((candle) => {
    const openMs = candle.time * 1_000;
    return openMs >= startMs && openMs < endMs;
  });
}

export const klinesQueryKey = (
  symbol: CompareSymbol,
  tf: Timeframe,
) => ['klines', symbol, tf] as const;
