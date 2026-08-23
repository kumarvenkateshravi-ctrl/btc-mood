import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import { acceptWebSocketCandle, createCandleMergeState, setCandleMergeEpoch } from './candleMerge';
import { applyValidatedGapRepair, planGapRepair } from './gapRepair';
import { HistoricalRequestGate } from '../historicalRequestIdentity';

const tf: Timeframe = '5m';
const T0 = 1_700_000_000;
const candle = (time: number): Candle => ({ time, open: 100, high: 110, low: 90, close: 105, volume: 10 });

function stateWithGap(missingIntervals: number) {
  let state = setCandleMergeEpoch(createCandleMergeState({ symbol: 'BTCUSDT', timeframe: tf }), 1);
  const first = acceptWebSocketCandle(state, {
    source: 'websocket', symbol: 'BTCUSDT', timeframe: tf, candle: candle(T0), eventTimeMs: 100, closed: true, connectionEpoch: 1,
  });
  state = first.state;
  const later = acceptWebSocketCandle(state, {
    source: 'websocket', symbol: 'BTCUSDT', timeframe: tf,
    candle: candle(T0 + (missingIntervals + 1) * 300), eventTimeMs: 200, closed: false, connectionEpoch: 1,
  });
  return { state: later.state, gap: later.gap! };
}

describe('validated REST gap repair', () => {
  it('plans and repairs one missing candle', () => {
    const { state, gap } = stateWithGap(1);
    const plan = planGapRepair(tf, gap);
    const repaired = applyValidatedGapRepair(state, plan, [candle(T0 + 300)], 500);

    expect(plan.expectedOpenTimes).toEqual([T0 + 300]);
    expect(repaired.ok).toBe(true);
    expect(repaired.state.candles.map((bar) => bar.time)).toEqual([T0, T0 + 300, T0 + 600]);
    expect(repaired.state.gaps).toEqual([]);
  });

  it('repairs multiple missing candles in order and dedupes REST duplicates', () => {
    const { state, gap } = stateWithGap(3);
    const plan = planGapRepair(tf, gap);
    const repaired = applyValidatedGapRepair(state, plan, [
      candle(T0 + 900), candle(T0 + 300), candle(T0 + 600), candle(T0 + 600),
    ], 500);

    expect(repaired.ok).toBe(true);
    expect(repaired.state.candles.map((bar) => bar.time)).toEqual([T0, T0 + 300, T0 + 600, T0 + 900, T0 + 1200]);
  });

  it('repairs overlapping/queued discontinuities one at a time without losing either gap', () => {
    let state = setCandleMergeEpoch(createCandleMergeState({ symbol: 'BTCUSDT', timeframe: tf }), 1);
    state = acceptWebSocketCandle(state, {
      source: 'websocket', symbol: 'BTCUSDT', timeframe: tf, candle: candle(T0), eventTimeMs: 100, closed: true, connectionEpoch: 1,
    }).state;
    state = acceptWebSocketCandle(state, {
      source: 'websocket', symbol: 'BTCUSDT', timeframe: tf, candle: candle(T0 + 600), eventTimeMs: 200, closed: false, connectionEpoch: 1,
    }).state;
    state = acceptWebSocketCandle(state, {
      source: 'websocket', symbol: 'BTCUSDT', timeframe: tf, candle: candle(T0 + 1200), eventTimeMs: 300, closed: false, connectionEpoch: 1,
    }).state;

    const first = applyValidatedGapRepair(state, planGapRepair(tf, state.gaps[0]), [candle(T0 + 300)], 400);
    const second = applyValidatedGapRepair(first.state, planGapRepair(tf, first.state.gaps[0]), [candle(T0 + 900)], 500);

    expect(first.ok).toBe(true);
    expect(first.state.gaps).toHaveLength(1);
    expect(second.ok).toBe(true);
    expect(second.state.gaps).toEqual([]);
  });

  it('keeps an incomplete repair non-live by refusing to mutate the gap', () => {
    const { state, gap } = stateWithGap(2);
    const repaired = applyValidatedGapRepair(state, planGapRepair(tf, gap), [candle(T0 + 300)], 500);

    expect(repaired.ok).toBe(false);
    expect(repaired.reason).toBe('incomplete');
    expect(repaired.state).toBe(state);
    expect(repaired.state.gaps).toHaveLength(1);
  });

  it('rejects an oversized gap without issuing an unbounded REST plan', () => {
    const plan = planGapRepair(tf, { fromOpenTime: T0, toOpenTime: T0 + 300 * 1002, missingIntervals: 1001 });
    expect(plan.valid).toBe(false);
    expect(plan.reason).toBe('too_large');
  });

  it('uses the existing request gate so stale symbol/timeframe repairs cannot commit', () => {
    const gate = new HistoricalRequestGate();
    const btcRepair = gate.begin('BTCUSDT', '5m', 'repair');
    gate.invalidate(); // symbol switch
    const goldRepair = gate.begin('XAUUSD', '15m', 'repair');
    let staleCommitted = false;
    btcRepair.ifCurrent(() => { staleCommitted = true; });

    expect(btcRepair.signal.aborted).toBe(true);
    expect(staleCommitted).toBe(false);
    expect(goldRepair.isCurrent()).toBe(true);
  });

  it('allows only one current repair request across a reconnect replacement', () => {
    const gate = new HistoricalRequestGate();
    const first = gate.begin('BTCUSDT', '5m', 'repair');
    const replacement = gate.begin('BTCUSDT', '5m', 'repair');

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(replacement.isCurrent()).toBe(true);
  });

  it('leaves duplicate buffered websocket events harmless after repair', () => {
    const { state, gap } = stateWithGap(1);
    const repaired = applyValidatedGapRepair(state, planGapRepair(tf, gap), [candle(T0 + 300)], 500);
    const duplicate = acceptWebSocketCandle(repaired.state, {
      source: 'websocket', symbol: 'BTCUSDT', timeframe: tf, candle: candle(T0 + 600), eventTimeMs: 200, closed: false, connectionEpoch: 1,
    });

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.state.candles).toHaveLength(3);
  });
});
