import { describe, expect, it } from 'vitest';
import { computeUtcDayChange, findUtcDayOpen, utcDayStartSeconds } from './utcDayChange';

const MIDNIGHT_MS = Date.parse('2026-08-12T00:00:00Z');
const MIDNIGHT_SECONDS = MIDNIGHT_MS / 1000;

describe('utcDayChange', () => {
  it('resets the session at 00:00 UTC', () => {
    expect(utcDayStartSeconds(MIDNIGHT_MS + 6 * 60 * 60 * 1000)).toBe(MIDNIGHT_SECONDS);
    expect(utcDayStartSeconds(MIDNIGHT_MS + 24 * 60 * 60 * 1000)).toBe(MIDNIGHT_SECONDS + 86400);
  });

  it('uses the current UTC daily candle opening price', () => {
    const result = computeUtcDayChange(105, {
      '1d': [
        { time: MIDNIGHT_SECONDS - 86400, open: 90, high: 100, low: 80, close: 95, volume: 1 },
        { time: MIDNIGHT_SECONDS, open: 100, high: 110, low: 99, close: 105, volume: 1 },
      ],
    }, MIDNIGHT_MS + 12 * 60 * 60 * 1000);

    expect(result).toEqual({ absolute: 5, percent: 5 });
  });

  it('falls back to a lower timeframe while the daily request is unavailable', () => {
    const open = findUtcDayOpen({
      '4h': [{ time: MIDNIGHT_SECONDS, open: 200, high: 205, low: 195, close: 202, volume: 1 }],
    }, MIDNIGHT_MS + 2 * 60 * 60 * 1000);

    expect(open).toBe(200);
  });

  it('returns null when no candle for the current UTC day is loaded', () => {
    expect(computeUtcDayChange(105, {
      '1d': [{ time: MIDNIGHT_SECONDS - 86400, open: 90, high: 100, low: 80, close: 95, volume: 1 }],
    }, MIDNIGHT_MS + 12 * 60 * 60 * 1000)).toBeNull();
  });
});
