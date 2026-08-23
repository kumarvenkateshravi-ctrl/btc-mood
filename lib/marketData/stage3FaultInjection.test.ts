import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import { deriveMarketDataIntegrity } from '../marketDataIntegrity';
import {
  createFeedHealthSnapshot,
  markFeedMessage,
  markFeedRepaired,
  markFeedSynchronizing,
  markFeedTransport,
  type FeedHealthSnapshot,
} from './feedHealth';
import { acceptWebSocketCandle, createCandleMergeState, setCandleMergeEpoch } from './candleMerge';
import { applyValidatedGapRepair, planGapRepair } from './gapRepair';
import { BackoffRetry, MarketDataRecoveryCoordinator } from './recovery';
import { captureReplayDataset, clearReplayDataset, getReplayDataset } from '../replay/replayDataset';

const nowMs = 1_700_000_000_000;
const tf: Timeframe = '5m';
const base: Candle = { time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105, volume: 10 };

function healthyFeeds(): FeedHealthSnapshot {
  let health = createFeedHealthSnapshot('BTCUSDT', TIMEFRAMES);
  for (const timeframe of TIMEFRAMES) {
    health = markFeedTransport(health, { kind: 'kline', timeframe, transport: 'open', epoch: 1, nowMs });
    health = markFeedMessage(health, { kind: 'kline', timeframe, epoch: 1, nowMs, serverEventMs: nowMs });
  }
  health = markFeedTransport(health, { kind: 'ticker', transport: 'open', epoch: 1, nowMs });
  health = markFeedMessage(health, { kind: 'ticker', epoch: 1, nowMs, serverEventMs: nowMs });
  return health;
}

function integrity(health: FeedHealthSnapshot, at = nowMs) {
  return deriveMarketDataIntegrity({
    hasAnyCandles: true, hasAllTimeframes: true, hasErrors: false, isLoading: false,
    wsStatus: 'open', lastUpdateMs: at, nowMs: at, feedHealth: health,
  });
}

function event(candle: Candle, eventTimeMs: number, closed = false, overrides: Partial<{
  symbol: string; timeframe: Timeframe; connectionEpoch: number;
}> = {}) {
  return {
    source: 'websocket' as const, symbol: 'BTCUSDT', timeframe: tf, candle, eventTimeMs, closed, connectionEpoch: 1, ...overrides,
  };
}

describe('Stage 3 fault-injection verification', () => {
  beforeEach(() => { vi.useFakeTimers(); clearReplayDataset(); });
  afterEach(() => { clearReplayDataset(); vi.useRealTimers(); });

  it('never promotes live from open-but-unsynchronized or independently stale required feeds', () => {
    let health = healthyFeeds();
    health = markFeedTransport(health, { kind: 'kline', timeframe: '1h', transport: 'open', epoch: 2, nowMs });
    expect(integrity(health)).toBe('partial');

    health = healthyFeeds();
    health = markFeedTransport(health, { kind: 'kline', timeframe: '4h', transport: 'open', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedMessage(health, { kind: 'kline', timeframe: '4h', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedMessage(health, { kind: 'ticker', epoch: 1, nowMs, serverEventMs: nowMs });
    health = markFeedTransport(health, { kind: 'bookTicker', transport: 'open', epoch: 1, nowMs });
    health = markFeedMessage(health, { kind: 'bookTicker', epoch: 1, nowMs });
    expect(integrity(health)).toBe('stale');
  });

  it('rejects duplicate, out-of-order, stale-symbol/timeframe/epoch candles', () => {
    let state = setCandleMergeEpoch(createCandleMergeState({ symbol: 'BTCUSDT', timeframe: tf }), 1);
    const first = acceptWebSocketCandle(state, event(base, 100, true));
    state = first.state;
    expect(acceptWebSocketCandle(state, event(base, 100, true)).accepted).toBe(false);
    expect(acceptWebSocketCandle(state, event({ ...base, close: 99 }, 101)).reason).toBe('finalized');
    expect(acceptWebSocketCandle(state, event(base, 101, false, { symbol: 'ETHUSDT' })).reason).toBe('stale_symbol');
    expect(acceptWebSocketCandle(state, event(base, 101, false, { timeframe: '15m' })).reason).toBe('stale_timeframe');
    expect(acceptWebSocketCandle(state, event(base, 101, false, { connectionEpoch: 0 })).reason).toBe('stale_epoch');
  });

  it('detects, repairs, orders, and dedupes a multiple-candle gap', () => {
    let state = setCandleMergeEpoch(createCandleMergeState({ symbol: 'BTCUSDT', timeframe: tf }), 1);
    state = acceptWebSocketCandle(state, event(base, 100, true)).state;
    const gapped = acceptWebSocketCandle(state, event({ ...base, time: base.time + 900 }, 200));
    const plan = planGapRepair(tf, gapped.gap!);
    const repaired = applyValidatedGapRepair(gapped.state, plan, [
      { ...base, time: base.time + 600 }, { ...base, time: base.time + 300 }, { ...base, time: base.time + 300 },
    ], 300);
    expect(repaired.ok).toBe(true);
    expect(repaired.state.candles.map((bar) => bar.time)).toEqual([base.time, base.time + 300, base.time + 600, base.time + 900]);
  });

  it('keeps a failed repair non-live, then retries with bounded backoff and restores synchronization only on success', () => {
    let health = healthyFeeds();
    health = markFeedSynchronizing(health, { kind: 'kline', timeframe: tf, epoch: 1, nowMs });
    const retry = new BackoffRetry({ baseDelayMs: 500, maxDelayMs: 2_000, jitterRatio: 0 });
    let retried = false;
    expect(retry.schedule(() => { retried = true; })).toBe(500);
    expect(integrity(health)).toBe('partial');
    vi.advanceTimersByTime(500);
    expect(retried).toBe(true);
    health = markFeedRepaired(health, { kind: 'kline', timeframe: tf, epoch: 1, nowMs: nowMs + 500 });
    retry.reset();
    expect(integrity(health, nowMs + 500)).toBe('live');
    retry.dispose();
  });

  it('coalesces sleep/wake recovery and keeps it inactive offline', async () => {
    const recover = vi.fn(async () => {});
    const coordinator = new MarketDataRecoveryCoordinator({ recover });
    coordinator.request('stale');
    coordinator.request('visibilitychange');
    await vi.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);
    coordinator.setOffline(true);
    coordinator.request('online');
    await vi.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('keeps the immutable replay dataset isolated while live recovery work is scheduled', async () => {
    const live = { '5m': [{ ...base }, { ...base, time: base.time + 300 }] } as Partial<Record<Timeframe, Candle[]>>;
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: tf, candlesByTf: live });
    const recover = vi.fn(async () => { live['5m']!.push({ ...base, time: base.time + 600 }); });
    const coordinator = new MarketDataRecoveryCoordinator({ recover });
    coordinator.request('visibilitychange');
    await vi.runAllTimersAsync();
    expect(getReplayDataset().candlesByTf['5m']).toHaveLength(2);
    coordinator.dispose();
  });
});
