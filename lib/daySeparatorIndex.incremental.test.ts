import { describe, expect, it } from 'vitest';
import { buildDaySeparatorIndex, updateDaySeparatorIndex } from './daySeparatorIndex';
import type { Candle } from './types';

const candle = (time: number): Candle => ({ time, open: 1, high: 2, low: 0, close: 1, volume: 1 });

describe('incremental day separator index', () => {
  it('updates only the tail for forming and appended bars with exact parity', () => {
    const initial = [candle(86_000), candle(86_500), candle(172_900)];
    const base = buildDaySeparatorIndex(initial);
    const forming = [...initial.slice(0, -1), candle(173_000)];
    expect(updateDaySeparatorIndex(initial, forming, base)).toEqual(buildDaySeparatorIndex(forming));
    const appended = [...forming, candle(259_300)];
    expect(updateDaySeparatorIndex(forming, appended, buildDaySeparatorIndex(forming))).toEqual(buildDaySeparatorIndex(appended));
  });

  it('falls back to a structural rebuild for prepend and replay rewind', () => {
    const initial = [candle(86_000), candle(86_500), candle(172_900), candle(173_000)];
    const base = buildDaySeparatorIndex(initial);
    const prepended = [candle(1), ...initial];
    expect(updateDaySeparatorIndex(initial, prepended, base)).toEqual(buildDaySeparatorIndex(prepended));
    const rewind = initial.slice(0, 2);
    expect(updateDaySeparatorIndex(initial, rewind, base)).toEqual(buildDaySeparatorIndex(rewind));
  });
});
