import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { countActiveFvgs, countActiveTodayFvgs, countActiveTodayFvgsByTimeframe } from './fvgActivity';

const candle = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume: 10,
});

describe('countActiveTodayFvgs', () => {
  it('counts an active bullish FVG created today and ignores the forming bar', () => {
    const hour = 3_600;
    const day = Date.UTC(2026, 0, 5) / 1_000;
    const candles = [
      candle(day, 100, 101, 99, 100),
      candle(day + hour, 100, 104, 100, 103),
      candle(day + hour * 2, 104, 107, 105, 106),
      // A forming bar that would otherwise alter the result must not count yet.
      candle(day + hour * 3, 106, 107, 103, 104),
    ];

    expect(countActiveTodayFvgs(candles, '5m')).toEqual({ bullish: 1, bearish: 0, total: 1 });
  });

  it('counts an active bearish FVG created today', () => {
    const hour = 3_600;
    const day = Date.UTC(2026, 0, 5) / 1_000;
    const candles = [
      candle(day, 110, 112, 108, 110),
      candle(day + hour, 110, 111, 104, 105),
      candle(day + hour * 2, 105, 106, 102, 103),
      candle(day + hour * 3, 103, 105, 101, 102),
    ];

    expect(countActiveTodayFvgs(candles, '5m')).toEqual({ bullish: 0, bearish: 1, total: 1 });
  });
  it('excludes a gap after a closed bar fully mitigates it', () => {
    const hour = 3_600;
    const day = Date.UTC(2026, 0, 5) / 1_000;
    const candles = [
      candle(day, 100, 101, 99, 100),
      candle(day + hour, 100, 104, 100, 103),
      candle(day + hour * 2, 104, 107, 105, 106),
      // This closed candle settles below the FVG's bottom (101).
      candle(day + hour * 3, 106, 107, 100, 100),
      candle(day + hour * 4, 100, 101, 99, 100),
    ];

    expect(countActiveTodayFvgs(candles, '5m')).toEqual({ bullish: 0, bearish: 0, total: 0 });
  });
});

describe('active FVG dashboard counts', () => {
  it('counts an older active gap while the today-only count excludes it', () => {
    const hour = 3_600;
    const day = Date.UTC(2026, 0, 5) / 1_000;
    const candles = [
      candle(day, 100, 101, 99, 100),
      candle(day + hour, 100, 104, 100, 103),
      candle(day + hour * 2, 104, 107, 105, 106),
      candle(day + 86_400, 106, 107, 102, 103),
      candle(day + 86_400 + hour, 103, 105, 102, 104),
    ];

    expect(countActiveFvgs(candles, '5m')).toEqual({ bullish: 1, bearish: 0, total: 1 });
    expect(countActiveTodayFvgs(candles, '5m')).toEqual({ bullish: 0, bearish: 0, total: 0 });
    expect(countActiveTodayFvgsByTimeframe({ '5m': candles })['5m'])
      .toEqual({ bullish: 0, bearish: 0, total: 0 });
  });

  it('returns a six-timeframe record and marks insufficient inputs as unavailable', () => {
    const day = Date.UTC(2026, 0, 5) / 1_000;
    const source = [
      candle(day, 100, 101, 99, 100),
      candle(day + 300, 100, 104, 100, 103),
      candle(day + 600, 104, 107, 105, 106),
      candle(day + 900, 106, 107, 103, 104),
    ];

    const counts = countActiveTodayFvgsByTimeframe({ '5m': source });
    expect(counts['5m']).toEqual({ bullish: 1, bearish: 0, total: 1 });
    expect(counts['15m']).toBeNull();
    expect(counts['1d']).toBeNull();
  });
});
