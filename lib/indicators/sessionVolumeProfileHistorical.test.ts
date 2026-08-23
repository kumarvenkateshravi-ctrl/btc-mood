import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { computeSessionVolumeProfile } from './sessionVolumeProfile';
import { SessionVolumeProfileCache } from './sessionVolumeProfileIncremental';

const DAY = 86_400;

function candle(time: number, price: number): Candle {
  return { time, open: price - 1, high: price + 2, low: price - 2, close: price + 1, volume: 10 };
}

const config = {
  id: 'session_volume_profile',
  settings: { inputs: { sessions: 'daily', showProfileBoxes: true }, styles: {}, visibility: {} },
};

describe('SVP compact historical POC output', () => {
  it('retains compact daily POCs independently of the 60 full-profile render limit', () => {
    const candles = Array.from({ length: 75 }, (_, index) => candle(index * DAY, 100 + index));
    const context = createIndicatorEvaluationContext({
      rawCandles: candles, displayCandles: candles, symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', sourceRevision: 'r1',
    });
    const result = computeSessionVolumeProfile(candles, config, undefined, context);
    expect(result.profiles).toHaveLength(60);
    expect(result.historicalPocs).toHaveLength(74);
    expect(result.historicalPocs?.every((record) => record.finalized && record.sessionType === 'daily')).toBe(true);
  });

  it('keeps only the recent full-profile window as histogram rows in the incremental cache', () => {
    const cache = new SessionVolumeProfileCache('historical-window');
    const candles = Array.from({ length: 70 }, (_, index) => candle(index * DAY, 100 + index));
    const profiles = cache.provider(candles, { mode: 'daily' }, { rowsLayout: 'rows', rowSize: 24, valueAreaVolume: 70 });
    expect(profiles.slice(0, 10).every((profile) => profile.rows.length === 0)).toBe(true);
    expect(profiles.slice(-60).some((profile) => profile.rows.length > 0)).toBe(true);
  });
});
