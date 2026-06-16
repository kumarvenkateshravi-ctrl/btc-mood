import { z } from 'zod';

// Schema for a single parsed kline row, as returned by our /api/klines
// proxy. Field order matches the lib/binance.ts transform.
export const CandleSchema = z.object({
  time: z.number().int().positive(),
  open: z.number().finite().nonnegative(),
  high: z.number().finite().nonnegative(),
  low: z.number().finite().nonnegative(),
  close: z.number().finite().nonnegative(),
  volume: z.number().finite().nonnegative(),
});
export type CandleT = z.infer<typeof CandleSchema>;

export const CandleArraySchema = z.array(CandleSchema).min(1);

// Raw Binance kline tuple — the upstream returns a fixed-position array
// of 12+ scalars. We only consume the indices we actually use and let
// zod reject the row if any required field is missing or non-numeric.
const BinanceKlineRow = z.tuple([
  z.number(), // 0: open time (ms)
  z.string(), // 1: open
  z.string(), // 2: high
  z.string(), // 3: low
  z.string(), // 4: close
  z.string(), // 5: volume
  z.number(), // 6: close time (ms)
  z.string(), // 7: quote asset volume
  z.number(), // 8: number of trades
  z.string(), // 9: taker buy base asset volume
  z.string(), // 10: taker buy quote asset volume
  z.string(), // 11: ignore
]);

export const BinanceKlinesSchema = z.array(BinanceKlineRow).min(1);

export function parseCandlesFromBinance(raw: unknown): CandleT[] {
  const rows = BinanceKlinesSchema.parse(raw);
  return rows.map((r) => ({
    time: Math.floor(r[0] / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

// WebSocket payload from /stream?streams=btcusdt@kline_<tf>
export const BinanceKlineMessageSchema = z.object({
  e: z.literal('kline'),
  E: z.number(),
  s: z.string(),
  k: z.object({
    t: z.number(),
    T: z.number(),
    s: z.string(),
    i: z.string(),
    o: z.string(),
    c: z.string(),
    h: z.string(),
    l: z.string(),
    v: z.string(),
    x: z.boolean(),
  }),
});

export const BinanceStreamEnvelopeSchema = z.object({
  stream: z.string().optional(),
  data: BinanceKlineMessageSchema.optional(),
});

// Binance @bookTicker — best bid/ask with quantities.
export const BinanceBookTickerMessageSchema = z.object({
  u: z.number(),
  s: z.string(),
  b: z.string(),
  B: z.string(),
  a: z.string(),
  A: z.string(),
});

export const BookTickerEnvelopeSchema = z.object({
  stream: z.string().optional(),
  data: BinanceBookTickerMessageSchema.optional(),
});
