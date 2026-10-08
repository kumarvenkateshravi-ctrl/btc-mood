import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import { STANDARD_MTF_TIMEFRAMES } from './standardMtfContract';
import { buildStandardMtfSnapshot, standardMtfSnapshotCacheKey } from './standardMtfService';

const START = 1_700_000_000;

function candles(seed: number, count = 241): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + seed) / 9) * 2;
    const open = 100 + seed + index * 0.18 + wave;
    const close = open + Math.cos((index + seed) / 5);
    return {
      time: START + index * 300,
      open,
      high: Math.max(open, close) + 1.3,
      low: Math.min(open, close) - 1.1,
      close,
      volume: 1_000 + ((index * 37 + seed * 17) % 360),
      takerBuyVolume: 450 + ((index * 19 + seed * 13) % 280),
    };
  });
}

function source(): Record<Timeframe, Candle[]> {
  return Object.fromEntries(
    STANDARD_MTF_TIMEFRAMES.map((timeframe, index) => [timeframe, candles(index * 11)]),
  ) as Record<Timeframe, Candle[]>;
}

function input(overrides: Partial<Parameters<typeof buildStandardMtfSnapshot>[0]> = {}) {
  return { symbol: 'BTCUSDT' as const, candlesByTimeframe: source(), ...overrides };
}

function corrected(
  candlesByTimeframe: Record<Timeframe, Candle[]>,
  timeframe: Timeframe,
  index: number,
): Record<Timeframe, Candle[]> {
  return {
    ...candlesByTimeframe,
    [timeframe]: candlesByTimeframe[timeframe].map((candle, candleIndex) => candleIndex === index
      ? { ...candle, close: candle.close + 7, high: candle.high + 7, volume: candle.volume + 29 }
      : candle),
  };
}

describe('official Standard MTF snapshot service', () => {
  it('is deterministic and exposes the Board -> M8 -> M9 chain on the closed cutoff', () => {
    const first = buildStandardMtfSnapshot(input());
    const second = buildStandardMtfSnapshot(input());
    expect(second.snapshot).toEqual(first.snapshot);
    expect(first.snapshot.generatedAt).toBe(START + 239 * 300);
    expect(first.snapshot.canonical.decision.generatedAt).toBe(first.snapshot.generatedAt);
    expect(first.snapshot.canonical.decision.direction).toBe(first.snapshot.canonical.board.bias);
    expect(first.snapshot.evaluationPolicy).toBe('closed_bar');
  });

  it('does not change an official snapshot when only a forming candle mutates', () => {
    const raw = source();
    const first = buildStandardMtfSnapshot(input({ candlesByTimeframe: raw }));
    const changed = corrected(raw, '5m', raw['5m'].length - 1);
    const second = buildStandardMtfSnapshot(input({ candlesByTimeframe: changed }));
    expect(second.snapshot).toEqual(first.snapshot);
    expect(standardMtfSnapshotCacheKey(input({ candlesByTimeframe: changed }))).toBe(first.snapshot.cacheKey);
  });

  it('recomputes identity when a closed candle changes, including a correction at the same timestamp', () => {
    const raw = source();
    const first = buildStandardMtfSnapshot(input({ candlesByTimeframe: raw }));
    const changed = corrected(raw, '5m', raw['5m'].length - 2);
    const second = buildStandardMtfSnapshot(input({ candlesByTimeframe: changed }));
    expect(second.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect(second.snapshot.timeframeResults['5m'].candleFingerprint)
      .not.toBe(first.snapshot.timeframeResults['5m'].candleFingerprint);
    expect(second.snapshot.candleCutoff).toBe(first.snapshot.candleCutoff);
  });

  it('isolates symbols and unaffected timeframe fingerprints', () => {
    const raw = source();
    const first = buildStandardMtfSnapshot(input({ candlesByTimeframe: raw }));
    const xau = buildStandardMtfSnapshot(input({ symbol: 'XAUUSD', candlesByTimeframe: raw }));
    const changed = buildStandardMtfSnapshot(input({ candlesByTimeframe: corrected(raw, '15m', 205) }));
    expect(xau.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect(changed.snapshot.timeframeResults['15m'].candleFingerprint)
      .not.toBe(first.snapshot.timeframeResults['15m'].candleFingerprint);
    expect(changed.snapshot.timeframeResults['1h'].candleFingerprint)
      .toBe(first.snapshot.timeframeResults['1h'].candleFingerprint);
  });

  it('gives a replay cut the same identity as the equivalent bounded closed input', () => {
    const raw = source();
    const replayCutoff = raw['5m'][220].time;
    const replay = buildStandardMtfSnapshot(input({ candlesByTimeframe: raw, replayCutoff, hasFormingBar: false }));
    const bounded = Object.fromEntries(
      STANDARD_MTF_TIMEFRAMES.map((timeframe) => [timeframe, raw[timeframe].filter((candle) => candle.time <= replayCutoff)]),
    ) as Record<Timeframe, Candle[]>;
    const exact = buildStandardMtfSnapshot(input({ candlesByTimeframe: bounded, hasFormingBar: false }));
    expect(replay.snapshot.snapshotId).toBe(exact.snapshot.snapshotId);
    expect(replay.snapshot.cacheKey).toBe(exact.snapshot.cacheKey);
  });

  it('includes configuration in identity and keeps the published graph immutable', () => {
    const first = buildStandardMtfSnapshot(input({ parameters: { policy: { threshold: 55 } } }));
    const changed = buildStandardMtfSnapshot(input({ parameters: { policy: { threshold: 56 } } }));
    expect(changed.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    expect(Object.isFrozen(first.snapshot.identity.timeframeInputs['5m'])).toBe(true);
    expect(Object.isFrozen(first.snapshot.canonical.decision)).toBe(true);
  });

  it('publishes all supported canonical categories and preserves real unavailable Order Flow', () => {
    const snapshot = buildStandardMtfSnapshot(input()).snapshot;
    for (const category of [
      snapshot.categories.marketStructure,
      snapshot.categories.volumeProfile,
      snapshot.categories.confluence,
    ]) {
      expect(category.availability).toBe('available');
      expect(category.score).not.toBeNull();
      expect(category.signals.length).toBeGreaterThan(0);
    }
    expect(snapshot.categories.orderFlow.availability).toBe('available');
    const xau = buildStandardMtfSnapshot(input({ symbol: 'XAUUSD' })).snapshot;
    expect(xau.categories.orderFlow.availability).toBe('unavailable');
    expect(xau.categories.orderFlow.score).toBeNull();
  });
});
