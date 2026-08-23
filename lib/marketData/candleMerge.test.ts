import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import {
  acceptWebSocketCandle,
  createCandleMergeState,
  mergeRestCandles,
  setCandleMergeEpoch,
} from './candleMerge';

const tf: Timeframe = '5m';
const base: Candle = { time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105, volume: 10 };

function ws(candle: Candle, eventTimeMs: number, closed = false, overrides: Record<string, unknown> = {}) {
  return {
    source: 'websocket' as const,
    symbol: 'BTCUSDT',
    timeframe: tf,
    candle,
    eventTimeMs,
    closed,
    connectionEpoch: 1,
    ...overrides,
  };
}

function state(candles: Candle[] = [base]) {
  return setCandleMergeEpoch(createCandleMergeState({ symbol: 'BTCUSDT', timeframe: tf, candles }), 1);
}

describe('canonical candle acceptance', () => {
  it('dedupes duplicate forming and closed events', () => {
    const first = acceptWebSocketCandle(state([]), ws(base, 100));
    const duplicateForming = acceptWebSocketCandle(first.state, ws(base, 100));
    const closed = acceptWebSocketCandle(first.state, ws(base, 101, true));
    const duplicateClosed = acceptWebSocketCandle(closed.state, ws(base, 101, true));

    expect(first.accepted).toBe(true);
    expect(duplicateForming.accepted).toBe(false);
    expect(closed.accepted).toBe(true);
    expect(duplicateClosed.accepted).toBe(false);
  });

  it('rejects older event timestamps and stale symbol/timeframe/epoch events', () => {
    const first = acceptWebSocketCandle(state([]), ws(base, 100));
    expect(acceptWebSocketCandle(first.state, ws({ ...base, close: 99 }, 99)).reason).toBe('older_event');
    expect(acceptWebSocketCandle(first.state, ws(base, 101, false, { symbol: 'ETHUSDT' })).reason).toBe('stale_symbol');
    expect(acceptWebSocketCandle(first.state, ws(base, 101, false, { timeframe: '15m' })).reason).toBe('stale_timeframe');
    expect(acceptWebSocketCandle(first.state, ws(base, 101, false, { connectionEpoch: 0 })).reason).toBe('stale_epoch');
  });

  it('rejects out-of-order candles and makes finalized candles immutable to websocket updates', () => {
    const closed = acceptWebSocketCandle(state([]), ws(base, 100, true));
    const finalizedUpdate = acceptWebSocketCandle(closed.state, ws({ ...base, close: 99 }, 101));
    const next = { ...base, time: base.time + 300 };
    const appended = acceptWebSocketCandle(closed.state, ws(next, 102));
    const outOfOrder = acceptWebSocketCandle(appended.state, ws(base, 103));

    expect(finalizedUpdate.reason).toBe('finalized');
    expect(outOfOrder.reason).toBe('out_of_order');
  });

  it('accepts newer forming updates without regressing accumulated OHLCV state', () => {
    const first = acceptWebSocketCandle(state([]), ws(base, 100));
    const updated = acceptWebSocketCandle(first.state, ws({ ...base, high: 108, low: 92, close: 101, volume: 8 }, 101));

    expect(updated.accepted).toBe(true);
    expect(updated.candle).toMatchObject({ high: 110, low: 90, close: 101, volume: 10 });
  });

  it('rejects stale same-time forming updates instead of regressing price or volume', () => {
    const first = acceptWebSocketCandle(state([]), ws(base, 100));
    const stale = acceptWebSocketCandle(first.state, ws({ ...base, close: 99, volume: 1 }, 99));

    expect(stale.accepted).toBe(false);
    expect(stale.state.candles[0]).toEqual(base);
  });

  it('does not let a late REST response overwrite newer websocket state', () => {
    const live = acceptWebSocketCandle(state([]), ws({ ...base, close: 109, volume: 20 }, 200, true));
    const rest = mergeRestCandles(live.state, [{ ...base, close: 101, volume: 2 }], { receivedAtMs: 201 });

    expect(rest.accepted).toBe(false);
    expect(rest.state.candles[0]).toMatchObject({ close: 109, volume: 20 });
  });

  it('allows an authoritative websocket update to supersede an initial REST snapshot', () => {
    const rest = mergeRestCandles(createCandleMergeState({ symbol: 'BTCUSDT', timeframe: tf }), [base], { receivedAtMs: 1_000 });
    const liveState = setCandleMergeEpoch(rest.state, 1);
    const live = acceptWebSocketCandle(liveState, ws({ ...base, close: 109, volume: 20 }, 900));

    expect(live.accepted).toBe(true);
    expect(live.state.candles[0]).toMatchObject({ close: 109, volume: 20 });
  });

  it('accepts a REST correction only through the explicit finalized repair path', () => {
    const live = acceptWebSocketCandle(state([]), ws({ ...base, close: 109 }, 200, true));
    const rejected = mergeRestCandles(live.state, [{ ...base, close: 101 }], { receivedAtMs: 201 });
    const repaired = mergeRestCandles(live.state, [{ ...base, close: 101 }], {
      receivedAtMs: 202,
      allowFinalizedRepair: true,
    });

    expect(rejected.accepted).toBe(false);
    expect(repaired.accepted).toBe(true);
    expect(repaired.action).toBe('repair');
    expect(repaired.state.candles[0].close).toBe(101);
  });

  it('detects skipped expected intervals and preserves normal sequential candles', () => {
    const first = acceptWebSocketCandle(state([]), ws(base, 100, true));
    const sequential = acceptWebSocketCandle(first.state, ws({ ...base, time: base.time + 300 }, 101));
    const gapped = acceptWebSocketCandle(sequential.state, ws({ ...base, time: base.time + 900 }, 102));

    expect(sequential.gap).toBeNull();
    expect(gapped.gap).toEqual({ fromOpenTime: base.time + 300, toOpenTime: base.time + 900, missingIntervals: 1 });
    expect(gapped.state.candles).toHaveLength(3);
  });
});
