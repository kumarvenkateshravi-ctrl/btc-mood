import { describe, expect, it } from 'vitest';
import { historyWindowEndTime } from './useHistoryWindow';

describe('historyWindowEndTime', () => {
  it('loads enough newer 5m candles to place the chosen date inside the chart window', () => {
    const date = Date.UTC(2026, 7, 2);
    const now = Date.UTC(2026, 7, 24);

    expect(historyWindowEndTime(date, '5m', now)).toBe(date + 500 * 5 * 60_000);
  });

  it('never requests future candles for a recent selected date', () => {
    const date = Date.UTC(2026, 7, 23);
    const now = Date.UTC(2026, 7, 24);

    expect(historyWindowEndTime(date, '1d', now)).toBe(now);
  });
});