import { describe, expect, it } from 'vitest';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { makeDeterministicCandles } from '../testing/syntheticCandles';
import { computeSmc, computeSmcWindowed, projectSmcSnapshot } from './engine';
import { computeSmcOverlay } from '../indicators/smcOverlay';

function context(rawCandles: ReturnType<typeof makeDeterministicCandles>, overrides: Partial<Parameters<typeof createIndicatorEvaluationContext>[0]> = {}) {
  return createIndicatorEvaluationContext({
    rawCandles,
    displayCandles: rawCandles,
    symbol: 'BTCUSDT',
    timeframe: '5m',
    mode: 'live',
    sourceRevision: 'smc-test-1',
    ...overrides,
  });
}

describe('SMC evaluation context and cache ownership', () => {
  it('uses raw candles regardless of HA/Renko display transforms', () => {
    const raw = makeDeterministicCandles(420, 11);
    const transformed = raw.map((c, i) => ({ ...c, open: c.open + 5, high: c.high + 5, low: c.low + 5, close: c.close + 5, time: c.time + i }));
    const rawEvaluation = computeSmc(raw, undefined, context(raw));
    expect(rawEvaluation.metadata.context).toMatchObject({ symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', sourceRevision: 'smc-test-1' });
    const rawSnap = projectSmcSnapshot(rawEvaluation);
    const transformedSnap = projectSmcSnapshot(computeSmc(transformed, undefined, context(raw, {
      displayCandles: transformed,
      transform: 'heikinAshi',
    })));
    expect(transformedSnap).toEqual(rawSnap);
  });

  it('cannot create persistent structure from the forming bar', () => {
    const closed = makeDeterministicCandles(300, 3);
    const forming = { ...closed[closed.length - 1], high: closed[closed.length - 1].high * 3, low: closed[closed.length - 1].low * 0.2, close: closed[closed.length - 1].high * 2 };
    const withForming = [...closed.slice(0, -1), forming];
    const snap = computeSmc(withForming, undefined, context(withForming, { hasFormingBar: true }));
    const reference = computeSmc(closed.slice(0, -1));
    expect(projectSmcSnapshot(snap)).toEqual(projectSmcSnapshot(reference));
    expect(snap.events.every((event) => event.barIndex < withForming.length - 1)).toBe(true);
    for (const list of Object.values(snap.objects)) {
      expect(list.every((object) => object.createdAtBar < withForming.length - 1)).toBe(true);
    }
  });

  it('does not share overlay cache entries across symbol, mode, replay, or source revision', () => {
    const candles = makeDeterministicCandles(260, 5);
    const live = context(candles);
    const otherSymbol = context(candles, { symbol: 'XAUUSD' });
    const replayA = context(candles, { mode: 'replay', replay: { sessionId: 'A', cutTime: candles.at(-1)!.time, executionTimeframe: '5m' }, sourceRevision: 'replay-A' });
    const replayB = context(candles, { mode: 'replay', replay: { sessionId: 'B', cutTime: candles.at(-1)!.time, executionTimeframe: '5m' }, sourceRevision: 'replay-B' });
    const changed = context(candles, { sourceRevision: 'smc-test-2' });
    const a = computeSmcOverlay(candles, undefined, undefined, live);
    expect(computeSmcOverlay(candles, undefined, undefined, live)).toBe(a);
    expect(computeSmcOverlay(candles, undefined, undefined, otherSymbol)).not.toBe(a);
    expect(computeSmcOverlay(candles, undefined, undefined, replayA)).not.toBe(a);
    expect(computeSmcOverlay(candles, undefined, undefined, replayB)).not.toBe(computeSmcOverlay(candles, undefined, undefined, replayA));
    expect(computeSmcOverlay(candles, undefined, undefined, changed)).not.toBe(a);
    expect(computeSmcOverlay(candles, { settings: { swingsLength: 25 } } as never, undefined, live)).not.toBe(a);
  });

  it('replay prefixes and rewinds are deterministic and isolated from live context', () => {
    const candles = makeDeterministicCandles(360, 17);
    const session = context(candles, { mode: 'replay', replay: { sessionId: 'session-1', cutTime: candles[260].time, executionTimeframe: '5m' }, sourceRevision: 'snapshot-1' });
    const prefix = candles.filter((c) => c.time <= candles[260].time);
    const boundedFullInput = computeSmc(candles, undefined, session);
    expect(boundedFullInput.events.every((event) => event.time <= candles[260].time)).toBe(true);
    const first = projectSmcSnapshot(computeSmc(prefix, undefined, session));
    const second = projectSmcSnapshot(computeSmc(prefix, undefined, session));
    expect(second).toEqual(first);
    const live = projectSmcSnapshot(computeSmc(candles, undefined, context(candles)));
    expect(live).not.toEqual(first);
  });

  it('documents the bounded 2500-bar window as trailing-window semantics', () => {
    const candles = makeDeterministicCandles(2700, 19);
    const windowed = computeSmcWindowed(candles, 2500);
    const start = candles.length - 2500;
    expect(windowed.diagnostics.barsProcessed).toBe(2500);
    expect(windowed.diagnostics.warnings.some((warning) => warning.includes('trailing 2500-bar window'))).toBe(true);
    expect(windowed.events.every((event) => event.barIndex >= start && event.barIndex < candles.length)).toBe(true);
    expect(windowed.objects.structureLevels.every((object) => object.createdAtBar >= start)).toBe(true);
  });
});
