import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { computeSessionVolumeProfile } from './sessionVolumeProfile';
import { createProfileDataProvider } from './profileDataProvider';

const bar = (time: number, open: number, high: number, low: number, close: number, volume: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

const raw = [
  bar(0, 100, 110, 90, 105, 10),
  bar(300, 105, 115, 95, 110, 20),
  bar(86_400, 110, 120, 100, 115, 30),
  bar(86_700, 115, 125, 105, 120, 40),
];

function evaluation(displayCandles: Candle[], overrides: Partial<Parameters<typeof createIndicatorEvaluationContext>[0]> = {}) {
  return createIndicatorEvaluationContext({
    rawCandles: raw,
    displayCandles,
    symbol: 'BTCUSDT',
    timeframe: '5m' as Timeframe,
    mode: 'live',
    sourceRevision: 'raw-rev-1',
    ...overrides,
  });
}

describe('raw market POC provenance', () => {
  it('keeps Fast POCs identical across candlestick, HA, and Renko display candles', () => {
    const ha = raw.map((candle) => ({ ...candle, open: candle.open + 50, high: candle.high + 50, low: candle.low + 50, close: candle.close + 50 }));
    const renko = [
      bar(0, 70, 75, 65, 72, 100),
      bar(86_400, 130, 135, 125, 132, 100),
    ];
    const configs = [evaluation(raw), evaluation(ha, { transform: 'heikinAshi' }), evaluation(renko, { transform: 'renko' })];
    const results = configs.map((context) => computeSessionVolumeProfile(raw, undefined, undefined, context));
    expect(results.map((result) => result.profiles?.map((profile) => profile.poc))).toEqual([
      results[0].profiles?.map((profile) => profile.poc),
      results[0].profiles?.map((profile) => profile.poc),
      results[0].profiles?.map((profile) => profile.poc),
    ]);
    expect(results[1].profiles?.every((profile) => profile.source?.tier === 'fast')).toBe(true);
  });

  it('preserves the legacy Fast result when the same raw candles are supplied directly', () => {
    const direct = computeSessionVolumeProfile(raw);
    const contextual = computeSessionVolumeProfile(raw, undefined, undefined, evaluation(raw));
    expect(contextual.profiles?.map((profile) => profile.poc)).toEqual(direct.profiles?.map((profile) => profile.poc));
    expect(contextual.profiles?.map((profile) => profile.vah)).toEqual(direct.profiles?.map((profile) => profile.vah));
    expect(contextual.profiles?.map((profile) => profile.val)).toEqual(direct.profiles?.map((profile) => profile.val));
  });

  it('labels developing and finalized profiles with the selected raw source', () => {
    const context = evaluation(raw, { hasFormingBar: true });
    const result = computeSessionVolumeProfile(raw, undefined, undefined, context);
    expect(result.profiles?.every((profile) => profile.source?.sourceTimeframe === '5m')).toBe(true);
    expect(result.profiles?.every((profile) => profile.source?.completeness === 'complete')).toBe(true);
  });

  it('does not let transformed candles enter the profile provider', () => {
    const context = evaluation(raw.map((candle) => ({ ...candle, high: candle.high + 1_000, low: candle.low + 1_000 })));
    const provider = createProfileDataProvider({ context, sessionTimeframe: 'weekly' });
    expect(provider.source.candles).toBe(raw);
    expect(provider.source.candles.every((candle) => candle.high < 500)).toBe(true);
  });
});
