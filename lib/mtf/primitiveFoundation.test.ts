import { describe, expect, it } from 'vitest';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import type { Candle } from '../types';
import {
  createClosedPocPrimitiveEvaluator,
  evaluateClosedFvgPrimitive,
  evaluateClosedMomentumPrimitives,
  evaluateClosedStructurePrimitive,
  evaluateClosedTakerSideOrderFlow,
  evaluateClosedTrendPrimitives,
  evaluateClosedVolatilityPrimitives,
  evaluateClosedVolumePrimitives,
} from './primitiveFoundation';

const START = Date.UTC(2024, 0, 1) / 1000;

function candles(count = 260, start = START): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const base = 40_000 + index * 9 + Math.sin(index / 5) * 70;
    return {
      time: start + index * 3_600,
      open: base - 12,
      high: base + 45,
      low: base - 40,
      close: base + (index % 3 - 1) * 8,
      volume: 1_000 + (index % 11) * 90,
      takerBuyVolume: 450 + (index % 9) * 55,
    };
  });
}

function context(
  source: Candle[],
  options: { symbol?: string; forming?: boolean; replayCutoff?: number; display?: Candle[] } = {},
) {
  return createIndicatorEvaluationContext({
    rawCandles: source,
    displayCandles: options.display ?? source,
    symbol: options.symbol ?? 'BTCUSDT',
    timeframe: '1h',
    mode: options.replayCutoff == null ? 'live' : 'replay',
    hasFormingBar: options.forming ?? false,
    replay: options.replayCutoff == null ? undefined : { sessionId: 'phase-3', cutTime: options.replayCutoff, executionTimeframe: '1h' },
    sourceRevision: 'fixture-v1',
  });
}

function byId<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error('Missing primitive ' + id);
  return item;
}

describe('Phase 3 primitive foundation', () => {
  it('is deterministic and explicitly reports insufficient history', () => {
    const input = context(candles());
    expect(evaluateClosedTrendPrimitives({ context: input })).toEqual(evaluateClosedTrendPrimitives({ context: input }));
    expect(evaluateClosedMomentumPrimitives({ context: input })).toEqual(evaluateClosedMomentumPrimitives({ context: input }));
    expect(evaluateClosedVolumePrimitives({ context: input })).toEqual(evaluateClosedVolumePrimitives({ context: input }));
    expect(evaluateClosedVolatilityPrimitives({ context: input })).toEqual(evaluateClosedVolatilityPrimitives({ context: input }));

    const short = context(candles(8));
    expect(byId(evaluateClosedTrendPrimitives({ context: short }), 'sma').availability).toBe('insufficient_data');
    expect(byId(evaluateClosedMomentumPrimitives({ context: short }), 'stochRsi').availability).toBe('insufficient_data');
    expect(byId(evaluateClosedVolatilityPrimitives({ context: short }), 'standardDeviation').availability).toBe('insufficient_data');
  });

  it('allows safe Custom-only parameter overrides without changing the default primitive', () => {
    const input = context(candles());
    const standardLike = byId(evaluateClosedTrendPrimitives({ context: input }), 'sma');
    const custom = byId(evaluateClosedTrendPrimitives({
      context: input,
      settings: { sma: { inputs: { length: 50 }, styles: {}, visibility: {} } },
    }), 'sma');
    expect(standardLike.diagnostics.length).toBe(20);
    expect(custom.diagnostics.length).toBe(50);
    expect(custom.value).not.toBe(standardLike.value);
  });

  it('keeps official closed primitives unchanged when only a forming bar changes', () => {
    const closed = candles();
    const formingA: Candle = { ...closed[closed.length - 1], time: closed[closed.length - 1].time + 3_600, high: 90_000, close: 89_000, volume: 9_000, takerBuyVolume: 8_900 };
    const formingB: Candle = { ...formingA, high: 20_000, low: 10, close: 20, volume: 1, takerBuyVolume: 0 };
    const a = context([...closed, formingA], { forming: true });
    const b = context([...closed, formingB], { forming: true });
    expect(evaluateClosedTrendPrimitives({ context: a })).toEqual(evaluateClosedTrendPrimitives({ context: b }));
    expect(evaluateClosedMomentumPrimitives({ context: a })).toEqual(evaluateClosedMomentumPrimitives({ context: b }));
    expect(evaluateClosedVolumePrimitives({ context: a })).toEqual(evaluateClosedVolumePrimitives({ context: b }));
    expect(evaluateClosedVolatilityPrimitives({ context: a })).toEqual(evaluateClosedVolatilityPrimitives({ context: b }));
    expect(evaluateClosedTakerSideOrderFlow(a)).toEqual(evaluateClosedTakerSideOrderFlow(b));
  });

  it('bounds every raw structural/profile primitive at the replay cutoff', () => {
    const all = candles(280);
    const cutoff = all[239].time;
    const prefix = all.filter((candle) => candle.time <= cutoff);
    const replay = context(all, { replayCutoff: cutoff });
    const expected = context(prefix, { replayCutoff: cutoff });
    expect(evaluateClosedMomentumPrimitives({ context: replay })).toEqual(evaluateClosedMomentumPrimitives({ context: expected }));
    expect(evaluateClosedFvgPrimitive(replay)).toEqual(evaluateClosedFvgPrimitive(expected));
    expect(evaluateClosedStructurePrimitive(replay)).toEqual(evaluateClosedStructurePrimitive(expected));
    const replayPoc = createClosedPocPrimitiveEvaluator()(replay);
    const expectedPoc = createClosedPocPrimitiveEvaluator()(expected);
    expect(replayPoc).toEqual(expectedPoc);
  });

  it('uses raw candles, never display transforms, for VWAP, POC, FVG, and structure', () => {
    const raw = candles();
    const display = raw.map((candle, index) => ({ ...candle, open: 1, high: 2 + index, low: 0.1, close: 1.5, volume: 1 }));
    const rawContext = context(raw);
    const transformed = context(raw, { display });
    expect(byId(evaluateClosedTrendPrimitives({ context: rawContext }), 'vwap')).toEqual(byId(evaluateClosedTrendPrimitives({ context: transformed }), 'vwap'));
    expect(createClosedPocPrimitiveEvaluator()(rawContext)).toEqual(createClosedPocPrimitiveEvaluator()(transformed));
    expect(evaluateClosedFvgPrimitive(rawContext)).toEqual(evaluateClosedFvgPrimitive(transformed));
    expect(evaluateClosedStructurePrimitive(rawContext)).toEqual(evaluateClosedStructurePrimitive(transformed));
  });

  it('keeps POC sessions UTC-bound, developing, isolated by symbol, and previous-day scoped', () => {
    const source = candles(100, START + 24 * 3_600);
    const evaluator = createClosedPocPrimitiveEvaluator();
    const btc = evaluator(context(source, { symbol: 'BTCUSDT' }));
    const gold = evaluator(context(source, { symbol: 'XAUUSD' }));
    expect(btc.fourHour.state).toBe('developing');
    expect(btc.daily.state).toBe('developing');
    expect(btc.weekly.state).toBe('developing');
    expect(btc.fourHour.startTime! % (4 * 3_600)).toBe(0);
    expect(btc.daily.startTime! % 86_400).toBe(0);
    expect(btc.daily.cacheIdentity).not.toBe(gold.daily.cacheIdentity);
    expect(btc.previousDailyShape).not.toBeNull();
    // Previous-day shape is a finalized historical profile; no line is extended into the current day by this API.
    expect(btc.previousDailyShape?.shape).toBeDefined();
  });

  it('exposes only real taker-side order flow and marks absent inputs unavailable', () => {
    const source = candles();
    const actual = evaluateClosedTakerSideOrderFlow(context(source));
    expect(actual.availability).toBe('available');
    expect(actual.provenance.metricSource).toBe('binance-kline-taker-buy-base-volume');
    expect(actual.absorption).toBeNull();

    const unavailable = evaluateClosedTakerSideOrderFlow(context(source.map((candle) => ({ ...candle, takerBuyVolume: undefined }))));
    expect(unavailable.availability).toBe('unavailable');
    expect(unavailable.bidAskDelta).toBeNull();
    expect(unavailable.aggression).toBeNull();
  });
});
