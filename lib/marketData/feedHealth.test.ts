import { describe, expect, it } from 'vitest';
import { TIMEFRAMES, type Timeframe } from '../types';
import {
  createFeedHealthSnapshot,
  markFeedMessage,
  markFeedRepaired,
  markFeedSynchronizing,
  markFeedTransport,
  type FeedHealthSnapshot,
} from './feedHealth';
import { deriveMarketDataIntegrity } from '../marketDataIntegrity';

const nowMs = 1_700_000_000_000;

function withHealthyFeed(symbol = 'BTCUSDT', omit?: Timeframe): FeedHealthSnapshot {
  let health = createFeedHealthSnapshot(symbol, TIMEFRAMES);
  for (const tf of TIMEFRAMES) {
    if (tf === omit) continue;
    health = markFeedTransport(health, { kind: 'kline', timeframe: tf, transport: 'open', epoch: 1, nowMs });
    health = markFeedMessage(health, {
      kind: 'kline', timeframe: tf, epoch: 1, nowMs, serverEventMs: nowMs,
      confirmedClosedCandleTime: 1_700_000_000,
    });
  }
  health = markFeedTransport(health, { kind: 'ticker', transport: 'open', epoch: 1, nowMs });
  return markFeedMessage(health, { kind: 'ticker', epoch: 1, nowMs, serverEventMs: nowMs });
}

function derive(health: FeedHealthSnapshot, overrides: Record<string, unknown> = {}) {
  return deriveMarketDataIntegrity({
    hasAnyCandles: true,
    hasAllTimeframes: true,
    hasErrors: false,
    isLoading: false,
    wsStatus: 'open',
    lastUpdateMs: nowMs,
    nowMs,
    feedHealth: health,
    ...overrides,
  });
}

describe('per-stream feed health', () => {
  it('requires every current kline timeframe plus a fresh authoritative ticker before live', () => {
    expect(derive(withHealthyFeed())).toBe('live');
  });

  it('does not allow a stale 1h stream to be hidden by healthy lower timeframes', () => {
    let health = withHealthyFeed();
    health = markFeedTransport(health, { kind: 'kline', timeframe: '1h', transport: 'open', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedMessage(health, { kind: 'kline', timeframe: '1h', epoch: 2, nowMs: nowMs - 30_000 });
    expect(derive(health)).toBe('stale');
  });

  it('does not let a fresh ticker refresh stale 4h kline freshness', () => {
    let health = withHealthyFeed();
    health = markFeedTransport(health, { kind: 'kline', timeframe: '4h', transport: 'open', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedMessage(health, { kind: 'kline', timeframe: '4h', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedMessage(health, { kind: 'ticker', epoch: 1, nowMs, serverEventMs: nowMs });
    expect(derive(health)).toBe('stale');
  });


  it('treats ticker transport open without a valid event as non-live', () => {
    let health = withHealthyFeed();
    health = markFeedTransport(health, { kind: 'ticker', transport: 'open', epoch: 2, nowMs });
    expect(derive(health)).toBe('partial');
  });

  it('does not let a fresh bookTicker hide a stale authoritative ticker', () => {
    let health = withHealthyFeed();
    health = markFeedTransport(health, { kind: 'ticker', transport: 'open', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedMessage(health, { kind: 'ticker', epoch: 2, nowMs: nowMs - 30_000 });
    health = markFeedTransport(health, { kind: 'bookTicker', transport: 'open', epoch: 1, nowMs });
    health = markFeedMessage(health, { kind: 'bookTicker', epoch: 1, nowMs });
    expect(derive(health)).toBe('partial');
  });

  it('returns non-live when one required timeframe is missing', () => {
    const health = withHealthyFeed('BTCUSDT', '4h');
    expect(derive(health)).toBe('partial');
  });

  it('remains non-live while a required stream is synchronizing', () => {
    let health = withHealthyFeed();
    health = markFeedTransport(health, { kind: 'kline', timeframe: '15m', transport: 'open', epoch: 2, nowMs });
    expect(derive(health)).toBe('partial');
  });

  it('keeps a repaired timeframe synchronizing until validated repair completion', () => {
    let health = withHealthyFeed();
    health = markFeedSynchronizing(health, { kind: 'kline', timeframe: '1h', epoch: 1, nowMs });
    expect(derive(health)).toBe('partial');
    health = markFeedRepaired(health, { kind: 'kline', timeframe: '1h', epoch: 1, nowMs });
    expect(derive(health)).toBe('live');
  });

  it('keeps validated history historical until live synchronization exists', () => {
    const health = createFeedHealthSnapshot('BTCUSDT', TIMEFRAMES);
    expect(derive(health, { wsStatus: 'closed' })).toBe('historical');
  });

  it('preserves unavailable, replay, and demo integrity precedence', () => {
    const health = createFeedHealthSnapshot('BTCUSDT', TIMEFRAMES);
    expect(derive(health, { hasAnyCandles: false, isLoading: false })).toBe('unavailable');
    expect(derive(withHealthyFeed(), { replayActive: true })).toBe('replay');
    expect(derive(withHealthyFeed(), { demo: true })).toBe('demo');
  });
});
