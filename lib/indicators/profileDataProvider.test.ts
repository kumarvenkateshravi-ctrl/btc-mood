import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import {
  createProfileDataProvider,
  type ProfileDataSource,
  type ProfileSourceProvenance,
} from './profileDataProvider';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';

const candle = (time: number, close: number): Candle => ({
  time,
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 10,
});

function context(overrides: Partial<Parameters<typeof createIndicatorEvaluationContext>[0]> = {}) {
  return createIndicatorEvaluationContext({
    rawCandles: [candle(100, 100), candle(200, 101), candle(300, 102)],
    displayCandles: [candle(100, 90), candle(200, 91), candle(300, 92)],
    symbol: 'BTCUSDT',
    timeframe: '5m' as Timeframe,
    mode: 'live',
    sourceRevision: 'raw-rev-1',
    ...overrides,
  });
}

function source(overrides: Partial<ProfileSourceProvenance> = {}, candles = [candle(100, 100), candle(200, 101)]) : ProfileDataSource {
  return {
    candles,
    provenance: {
      symbol: 'BTCUSDT',
      sessionTimeframe: 'daily',
      sourceTimeframe: '1m',
      tier: 'accurate',
      quality: 'higher-accuracy',
      completeness: 'complete',
      mode: 'live',
      sourceRevision: '1m-rev-1',
      ...overrides,
    },
  };
}

describe('profile data provider and provenance', () => {
  it('uses raw chart candles for FAST mode regardless of display transform', () => {
    const raw = context();
    const provider = createProfileDataProvider({ context: raw, sessionTimeframe: 'daily' });
    expect(provider.source.candles).toBe(raw.rawCandles);
    expect(provider.provenance.tier).toBe('fast');
    expect(provider.provenance.sourceTimeframe).toBe('5m');
    expect(provider.provenance.quality).toBe('estimated');
  });

  it('uses an available ACCURATE source and exposes its resolution', () => {
    const provider = createProfileDataProvider({
      context: context(),
      sessionTimeframe: 'weekly',
      accurateSource: source(),
    });
    expect(provider.source.candles[0].close).toBe(100);
    expect(provider.provenance.tier).toBe('accurate');
    expect(provider.provenance.sourceTimeframe).toBe('1m');
    expect(provider.provenance.sessionTimeframe).toBe('weekly');
  });

  it('falls back explicitly when ACCURATE data is unavailable', () => {
    const provider = createProfileDataProvider({
      context: context(),
      accurateSource: undefined,
      requestedTier: 'accurate',
    });
    expect(provider.provenance.tier).toBe('fast');
    expect(provider.provenance.fallbackFrom).toBe('accurate');
    expect(provider.provenance.fallbackReason).toBeTruthy();
  });

  it('bounds replay sources at the active cut and never consumes future candles', () => {
    const replay = context({
      mode: 'replay',
      replay: { sessionId: 'replay-1', cutTime: 200, executionTimeframe: '5m' },
      rawCandles: [candle(100, 100), candle(200, 101), candle(300, 102)],
    });
    const provider = createProfileDataProvider({ context: replay, accurateSource: source({}, [candle(100, 99), candle(200, 100), candle(300, 101)]) });
    expect(provider.source.candles.map((bar) => bar.time)).toEqual([100, 200]);
    expect(provider.provenance.mode).toBe('replay');
    expect(provider.provenance.replaySessionId).toBe('replay-1');
    expect(provider.provenance.replayCutTime).toBe(200);
  });

  it('separates cache identities by resolution, provenance, source revision, and replay identity', () => {
    const base = createProfileDataProvider({ context: context(), sessionTimeframe: 'daily' });
    const accurate = createProfileDataProvider({ context: context(), sessionTimeframe: 'daily', accurateSource: source() });
    const revised = createProfileDataProvider({ context: context({ sourceRevision: 'raw-rev-2' }), sessionTimeframe: 'daily' });
    const replay = createProfileDataProvider({ context: context({ mode: 'replay', replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' } }), sessionTimeframe: 'daily' });
    expect(new Set([base.cacheIdentity, accurate.cacheIdentity, revised.cacheIdentity, replay.cacheIdentity]).size).toBe(4);
    expect(base.cacheIdentity).not.toContain('1m');
    expect(accurate.cacheIdentity).toContain('1m');
  });

  it('does not share a cache identity between 1m and 5m source inputs', () => {
    const fiveMinute = createProfileDataProvider({ context: context(), accurateSource: source({ sourceTimeframe: '5m', tier: 'accurate' }) });
    const oneMinute = createProfileDataProvider({ context: context(), accurateSource: source({ sourceTimeframe: '1m' }) });
    expect(fiveMinute.cacheIdentity).not.toBe(oneMinute.cacheIdentity);
  });
});
