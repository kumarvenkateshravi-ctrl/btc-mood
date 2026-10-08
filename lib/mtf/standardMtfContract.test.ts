import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import {
  STANDARD_MTF_TIMEFRAMES,
  canonicalStandardMtfJson,
  createStandardMtfSnapshotIdentity,
  deepFreezeStandardMtf,
  type StandardMtfJson,
  publishStandardMtfSnapshot,
  type StandardMtfSnapshot,
} from './standardMtfContract';

function candles(seed: number): Candle[] {
  return [0, 1, 2].map((offset) => ({
    time: 1_700_000_000 + offset * 300,
    open: seed + offset,
    high: seed + offset + 2,
    low: seed + offset - 1,
    close: seed + offset + 1,
    volume: 100 + offset,
    takerBuyVolume: 55 + offset,
  }));
}

function closedByTf(seed = 100): Record<Timeframe, Candle[]> {
  return Object.fromEntries(
    STANDARD_MTF_TIMEFRAMES.map((timeframe, index) => [timeframe, candles(seed + index)]),
  ) as Record<Timeframe, Candle[]>;
}

const base = () => ({
  symbol: 'BTCUSDT' as const,
  candleCutoff: 1_700_001_000,
  closedCandlesByTimeframe: closedByTf(),
  parameters: {
    indicatorRegistryVersion: 'm0/1',
    board: { executionTimeframe: '5m', minConviction: 55 },
    smc: { version: '1.0', enabled: true },
    volumeProfile: { rows: 24, valueAreaVolume: 70 },
  },
});

describe('Standard MTF contract identity', () => {
  it('is deterministic and canonicalizes parameter key order', () => {
    const first = createStandardMtfSnapshotIdentity(base());
    const reordered = createStandardMtfSnapshotIdentity({
      ...base(),
      parameters: {
        volumeProfile: { valueAreaVolume: 70, rows: 24 },
        smc: { enabled: true, version: '1.0' },
        board: { minConviction: 55, executionTimeframe: '5m' },
        indicatorRegistryVersion: 'm0/1',
      },
    });
    expect(reordered).toEqual(first);
    expect(first.generatedAt).toBe(first.candleCutoff);
    expect(first.evaluationPolicy).toBe('closed_bar');
  });

  it.each([
    ['symbol', () => ({ ...base(), symbol: 'XAUUSD' as const })],
    ['methodology', () => ({ ...base(), methodologyVersion: 'standard-mtf/1.0.1' })],
    ['cutoff', () => ({ ...base(), candleCutoff: 1_700_001_001 })],
    ['parameters', () => ({ ...base(), parameters: { ...base().parameters, smc: { version: '1.0', enabled: false } } })],
    ['one timeframe input', () => {
      const next = closedByTf();
      next['4h'] = next['4h'].map((candle, index) => index === 1 ? { ...candle, volume: candle.volume + 1 } : candle);
      return { ...base(), closedCandlesByTimeframe: next };
    }],
  ])('isolates cache identity when %s changes', (_label, change) => {
    const original = createStandardMtfSnapshotIdentity(base());
    const changed = createStandardMtfSnapshotIdentity(change());
    expect(changed.snapshotId).not.toBe(original.snapshotId);
    expect(changed.cacheKey).not.toBe(original.cacheKey);
  });

  it('preserves unaffected timeframe fingerprints', () => {
    const original = createStandardMtfSnapshotIdentity(base());
    const next = closedByTf();
    next['15m'] = next['15m'].map((candle, index) => index === 2 ? { ...candle, close: candle.close + 0.5 } : candle);
    const changed = createStandardMtfSnapshotIdentity({ ...base(), closedCandlesByTimeframe: next });
    expect(changed.timeframeInputs['15m'].candleFingerprint).not.toBe(original.timeframeInputs['15m'].candleFingerprint);
    for (const timeframe of STANDARD_MTF_TIMEFRAMES.filter((timeframe) => timeframe !== '15m')) {
      expect(changed.timeframeInputs[timeframe].candleFingerprint).toBe(original.timeframeInputs[timeframe].candleFingerprint);
    }
  });

  it('is replay-safe: identical closed inputs produce identical identity', () => {
    const liveEvaluation = createStandardMtfSnapshotIdentity(base());
    const replayEvaluation = createStandardMtfSnapshotIdentity(base());
    expect(replayEvaluation).toEqual(liveEvaluation);
  });

  it('rejects future or non-ascending candles', () => {
    const future = closedByTf();
    future['5m'] = [...future['5m'], { ...future['5m'][2], time: base().candleCutoff + 1 }];
    expect(() => createStandardMtfSnapshotIdentity({ ...base(), closedCandlesByTimeframe: future })).toThrow(/after candleCutoff/);

    const reversed = closedByTf();
    reversed['1h'] = [...reversed['1h']].reverse();
    expect(() => createStandardMtfSnapshotIdentity({ ...base(), closedCandlesByTimeframe: reversed })).toThrow(/strictly time-ascending/);
  });

  it('deep-freezes the publication boundary at runtime', () => {
    const value = deepFreezeStandardMtf({ nested: { evidence: [{ code: 'X' }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.nested.evidence)).toBe(true);
    expect(Object.isFrozen(value.nested.evidence[0])).toBe(true);
  });

  it('publishes only identity-coherent, bounded snapshots', () => {
    const identity = createStandardMtfSnapshotIdentity(base());
    const snapshot = {
      ...identity,
      identity,
      timeframeResults: {},
      categories: { trend: { signals: [] } },
      marketState: 'range_bound',
      direction: 'neutral',
      confidence: 50,
      tradeability: 40,
      supportingEvidence: [],
      opposingEvidence: [],
    } as unknown as StandardMtfSnapshot;
    const published = publishStandardMtfSnapshot(snapshot);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.categories.trend.signals)).toBe(true);
    expect(() => publishStandardMtfSnapshot({ ...snapshot, symbol: 'XAUUSD' })).toThrow(/do not match identity/);
    expect(() => publishStandardMtfSnapshot({ ...snapshot, confidence: 101 })).toThrow(/confidence/);
  });

  it('rejects non-finite canonical identity values', () => {
    expect(() => canonicalStandardMtfJson({ bad: Number.NaN } as unknown as StandardMtfJson)).toThrow(/finite/);
  });
});
