import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { buildScoredZones, computeSdSignalEvents } from './sdSignals';
import { computeSdZones } from './sdZones';

const HOUR = 3600;

function fixture(extra = 0): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 24 * 6 + extra; i++) {
    const day = Math.floor(i / 24);
    const o = price;
    const move = day === 1 ? -0.7 : day === 2 ? 0.9 : 0.1;
    price = Math.max(1, price + move);
    out.push({
      time: 1_700_000_000 + i * HOUR,
      open: o,
      high: Math.max(o, price) + 1,
      low: Math.min(o, price) - 1,
      close: price,
      volume: 100 + i,
    });
  }
  return out;
}

describe('Supply/Demand causal evaluation', () => {
  it('freezes formation-time zone evidence so future bars cannot change it', () => {
    const prefix = fixture(0).slice(0, 96);
    const full = fixture(48);
    const a = buildScoredZones(prefix, ['D', '4H'], 1.5)
      .filter((z) => z.formedAtIndex < prefix.length)
      .map((z) => ({ id: `${z.tf}:${z.kind}:${z.formedAtIndex}`, strength: z.strength }));
    const b = buildScoredZones(full, ['D', '4H'], 1.5)
      .filter((z) => z.formedAtIndex < prefix.length)
      .map((z) => ({ id: `${z.tf}:${z.kind}:${z.formedAtIndex}`, strength: z.strength }));
    expect(b).toEqual(a);
  });

  it('uses raw closed candles regardless of display transform', () => {
    const raw = fixture(48);
    const ha = raw.map((c) => ({ ...c, open: c.open + 50, high: c.high + 50, low: c.low + 50, close: c.close + 50 }));
    const candlestick = createIndicatorEvaluationContext({
      rawCandles: raw, displayCandles: raw, symbol: 'BTCUSDT', timeframe: '1h', mode: 'live', sourceRevision: 'r1', transform: 'candlestick',
    });
    const transformed = createIndicatorEvaluationContext({
      rawCandles: raw, displayCandles: ha, symbol: 'BTCUSDT', timeframe: '1h', mode: 'live', sourceRevision: 'r1', transform: 'heikinAshi',
    });
    const a = buildScoredZones(candlestick.closedCandles, ['D', '4H'], 1.5);
    const b = buildScoredZones(transformed.closedCandles, ['D', '4H'], 1.5);
    expect(b).toEqual(a);
    const renderedA = computeSdZones(raw, { id: 'sd_zones' }, candlestick);
    const renderedB = computeSdZones(ha, { id: 'sd_zones' }, transformed);
    expect(renderedB).toEqual(renderedA);
  });

  it('keeps signal evidence stable when later volume/structure is appended', () => {
    const prefix = fixture(0).slice(0, 120);
    const full = fixture(72).map((c, i) => i >= 120 ? { ...c, volume: 1_000_000, high: c.high + 20, low: c.low - 20 } : c);
    const config = { id: 'sd_signals', settings: { inputs: {
      tf1: 'D', tf2: '4H', confirmation: 'touch', confidenceFloor: 0, minRR: 0,
    } } } as never;
    const a = computeSdSignalEvents(prefix, config, { symbol: 'BTCUSDT', timeframe: '1h' });
    const b = computeSdSignalEvents(full, config, { symbol: 'BTCUSDT', timeframe: '1h' });
    const byId = new Map(b.map((e) => [e.id, e]));
    for (const event of a) {
      const later = byId.get(event.id);
      expect(later?.confidence).toBe(event.confidence);
      expect(later?.explanation).toEqual(event.explanation);
    }
  });

  it('replay context is bounded to its immutable cut and has isolated cache identity', () => {
    const raw = fixture(72);
    const context = createIndicatorEvaluationContext({
      rawCandles: raw, displayCandles: raw, symbol: 'BTCUSDT', timeframe: '1h', mode: 'replay', sourceRevision: 'snapshot-1',
      replay: { sessionId: 'replay-a', cutTime: raw[100].time, executionTimeframe: '1h' },
    });
    const events = computeSdSignalEvents(context.rawCandles, { id: 'sd_signals' }, { symbol: 'BTCUSDT', timeframe: '1h' }, context);
    expect(events.every((e) => e.triggeredIndex == null || e.createdAt <= raw[100].time)).toBe(true);
    const other = createIndicatorEvaluationContext({ ...context, mode: 'live', replay: undefined });
    const liveEvents = computeSdSignalEvents(other.rawCandles, { id: 'sd_signals' }, { symbol: 'BTCUSDT', timeframe: '1h' }, other);
    expect(liveEvents).not.toBe(events);
    const symbolEvents = computeSdSignalEvents(context.rawCandles, { id: 'sd_signals' }, { symbol: 'XAUUSD', timeframe: '1h' }, { ...context, symbol: 'XAUUSD' });
    const revisionEvents = computeSdSignalEvents(context.rawCandles, { id: 'sd_signals' }, { symbol: 'BTCUSDT', timeframe: '1h' }, { ...context, sourceRevision: 'snapshot-2' });
    expect(symbolEvents).not.toBe(events);
    expect(revisionEvents).not.toBe(events);
  });
});
