import { describe, expect, it } from 'vitest';
import { buildDaySeparatorIndex, selectVisibleDaySeparators, type DaySeparator } from './daySeparatorIndex';
import type { Candle } from './types';

function candles(count: number, start = 1_700_000_000): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * 1_800,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  }));
}

function reference(source: Candle[]): DaySeparator[] {
  const seen = new Set<number>();
  const out: DaySeparator[] = [];
  for (let index = 1; index < source.length; index++) {
    const previous = source[index - 1];
    const current = source[index];
    const day = Math.floor(current.time / 86_400);
    const previousDay = Math.floor(previous.time / 86_400);
    if (day !== previousDay && !seen.has(day)) {
      seen.add(day);
      out.push({ index, time: current.time, day });
    }
  }
  return out;
}

describe('day separator index', () => {
  it.each([2_000, 20_000, 50_000, 100_000])('matches the original UTC boundary scan for %i candles', (count) => {
    const source = candles(count);
    expect(buildDaySeparatorIndex(source)).toEqual(reference(source));
  });

  it('handles UTC midnight transitions and excludes out-of-range boundaries', () => {
    const source = candles(4, 86_399);
    const index = buildDaySeparatorIndex(source);
    expect(index).toEqual([{ index: 1, time: 88_199, day: 1 }]);
    expect(selectVisibleDaySeparators(index, { from: 0, to: 0 })).toEqual([]);
    expect(selectVisibleDaySeparators(index, { from: 0, to: 1 })).toEqual(index);
  });

  it('updates correctly after a history prepend and replay truncation', () => {
    const source = candles(100);
    const prepended = [{ ...source[0], time: source[0].time - 86_400 }, ...source];
    expect(buildDaySeparatorIndex(prepended)).toEqual(reference(prepended));
    expect(buildDaySeparatorIndex(source.slice(0, 20))).toEqual(reference(source.slice(0, 20)));
  });

  it('preserves Renko timestamp semantics by indexing the provided source timestamps exactly', () => {
    const source = [
      { ...candles(1)[0], time: 10 },
      { ...candles(1)[0], time: 86_410 },
      { ...candles(1)[0], time: 172_810 },
    ];
    expect(buildDaySeparatorIndex(source)).toEqual(reference(source));
  });
});
