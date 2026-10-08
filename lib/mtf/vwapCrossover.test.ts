import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import {
  computeClosedDailyWeeklyVwapCross,
  computeClosedDailyWeeklyVwapCrossesByTimeframe,
  computeClosedPriceWeeklyVwapCross,
  computeClosedPriceWeeklyVwapCrossesByTimeframe,
  computeDailyWeeklyVwapCross,
  computePriceWeeklyVwapCross,
} from './vwapCrossover';

const candle = (time: number, price: number): Candle => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume: 10,
});

describe('computeDailyWeeklyVwapCross', () => {
  it('detects a daily VWAP bullish cross above the weekly VWAP', () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const hour = 60 * 60;
    const result = computeDailyWeeklyVwapCross([
      candle(monday, 100),
      candle(monday + hour, 100),
      candle(monday + 24 * hour, 90),
      candle(monday + 25 * hour, 110),
      candle(monday + 26 * hour, 120),
    ]);

    expect(result.relationship).toBe('above');
    expect(result.lastCross).toBe('bullish');
    expect(result.barsSinceCross).toBe(0);
    expect(result.daily).toBeCloseTo(320 / 3, 8);
    expect(result.weekly).toBeCloseTo(104, 8);
  });

  it('reports unavailable when no volume-weighted values can be formed', () => {
    const result = computeDailyWeeklyVwapCross([{
      time: 1,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 0,
    }]);

    expect(result.relationship).toBe('unavailable');
    expect(result.daily).toBeNull();
  });

  it('excludes a crossover on the live forming candle', () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const hour = 60 * 60;
    const candles = [
      candle(monday, 100),
      candle(monday + hour, 100),
      candle(monday + 24 * hour, 90),
      candle(monday + 25 * hour, 110),
      candle(monday + 26 * hour, 120),
    ];

    expect(computeDailyWeeklyVwapCross(candles).lastCross).toBe('bullish');
    expect(computeClosedDailyWeeklyVwapCross(candles).lastCross).toBe('none');
  });

  it('builds a complete display map and marks missing timeframes as waiting', () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const result = computeClosedDailyWeeklyVwapCrossesByTimeframe({
      '5m': [candle(monday, 100), candle(monday + 300, 101)],
    });

    expect(result['5m']).not.toBeNull();
    expect(result['15m']).toBeNull();
    expect(Object.keys(result)).toHaveLength(6);
  });
});

describe('computePriceWeeklyVwapCross', () => {
  it('reports Bear when the latest confirmed price is below Weekly VWAP', () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const hour = 60 * 60;
    const candles = [
      candle(monday, 100),
      candle(monday + hour, 120),
      candle(monday + 2 * hour, 80),
      candle(monday + 3 * hour, 70),
    ];

    const result = computePriceWeeklyVwapCross(candles);

    expect(result.relationship).toBe('below');
    expect(result.lastCross).toBe('bearish');
    expect(result.price).toBe(70);
    expect(result.weekly).toBeCloseTo(92.5, 8);
  });

  it('uses the last closed price and excludes a bullish forming candle', () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const hour = 60 * 60;
    const candles = [
      candle(monday, 100),
      candle(monday + hour, 80),
      candle(monday + 2 * hour, 120),
    ];

    expect(computePriceWeeklyVwapCross(candles).relationship).toBe('above');
    expect(computeClosedPriceWeeklyVwapCross(candles).relationship).toBe('below');
  });

  it('does not treat the Weekly VWAP reset as a crossover', () => {
    const sunday = Date.UTC(2026, 0, 4, 23) / 1000;
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const result = computePriceWeeklyVwapCross([
      candle(sunday, 80),
      candle(monday, 120),
    ]);

    expect(result.relationship).toBe('equal');
    expect(result.lastCross).toBe('none');
  });

  it('builds the six-timeframe confirmed price/Weekly VWAP display map', () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const result = computeClosedPriceWeeklyVwapCrossesByTimeframe({
      '5m': [candle(monday, 100), candle(monday + 300, 90), candle(monday + 600, 80)],
    });

    expect(result['5m']?.relationship).toBe('below');
    expect(result['15m']).toBeNull();
    expect(Object.keys(result)).toHaveLength(6);
  });
});
