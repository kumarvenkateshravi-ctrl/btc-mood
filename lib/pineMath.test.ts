import { describe, it, expect } from 'vitest';
import { highest, lowest, tr, linreg, pivotHigh, pivotLow, valueWhen, barsSince, ema, emaPine } from './pineMath';

describe('emaPine (TradingView ta.ema)', () => {
  it('seeds with src[0] and emits from bar 0 (pine_ema)', () => {
    // alpha = 2/(3+1) = 0.5. ema0 = 10; then 0.5*src + 0.5*prev.
    const src = [10, 20, 30, 40];
    const out = emaPine(src, 3);
    expect(out[0]).toBeCloseTo(10, 10);
    expect(out[1]).toBeCloseTo(0.5 * 20 + 0.5 * 10, 10); // 15
    expect(out[2]).toBeCloseTo(0.5 * 30 + 0.5 * 15, 10); // 22.5
    expect(out[3]).toBeCloseTo(0.5 * 40 + 0.5 * 22.5, 10); // 31.25
  });

  it('differs from the SMA-seeded ema (which is null until index length-1)', () => {
    const src = [10, 20, 30, 40];
    const smaSeeded = ema(src, 3);
    expect(smaSeeded[0]).toBeNull(); // SMA-seeded warms up
    expect(smaSeeded[1]).toBeNull();
    expect(smaSeeded[2]).toBeCloseTo((10 + 20 + 30) / 3, 10); // seed = SMA = 20
    // emaPine has a value at bar 0 where the SMA-seeded one is still null.
    expect(emaPine(src, 3)[0]).not.toBeNull();
  });

  it('skips leading nulls then seeds at the first real value', () => {
    const src = [null, null, 10, 20];
    const out = emaPine(src, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(10, 10); // seed
    expect(out[3]).toBeCloseTo(0.5 * 20 + 0.5 * 10, 10); // 15
  });
});

describe('pivotHigh / pivotLow', () => {
  it('confirms a pivot high `right` bars after it occurs', () => {
    //            0  1  2  3  4  5  6   (pivot at idx 2, left=2,right=2)
    const src = [1, 2, 5, 2, 1, 0, 0];
    const ph = pivotHigh(src, 2, 2);
    expect(ph[4]).toBe(5); // confirmed at idx 2+2 = 4
    expect(ph[3]).toBeNull();
  });
  it('confirms a pivot low', () => {
    const src = [5, 4, 1, 4, 5, 6, 6];
    const pl = pivotLow(src, 2, 2);
    expect(pl[4]).toBe(1);
  });
  it('rejects non-pivots (ties / not extreme)', () => {
    expect(pivotHigh([1, 2, 2, 2, 1], 1, 1).every((v) => v === null)).toBe(true);
  });
});

describe('valueWhen', () => {
  it('returns src at the occurrence-th most recent true', () => {
    const cond = [true, false, true, false, true];
    const src = [10, 11, 20, 21, 30];
    expect(valueWhen(cond, src, 0)).toEqual([10, 10, 20, 20, 30]); // most recent
    expect(valueWhen(cond, src, 1)).toEqual([null, null, 10, 10, 20]); // one before
  });
});

describe('barsSince', () => {
  it('counts bars since the last true', () => {
    expect(barsSince([false, true, false, false, true, false])).toEqual([null, 0, 1, 2, 0, 1]);
  });
});

describe('highest', () => {
  it('returns nulls until the window is full', () => {
    expect(highest([1, 2, 3, 4], 5)).toEqual([null, null, null, null]);
  });

  it('returns the rolling max', () => {
    expect(highest([1, 5, 3, 7, 2], 3)).toEqual([null, null, 5, 7, 7]);
  });

  it('handles null entries', () => {
    expect(highest([1, null, 3, 2], 3)).toEqual([null, null, null, null]);
  });
});

describe('lowest', () => {
  it('returns nulls until the window is full', () => {
    expect(lowest([3, 2, 1, 0], 5)).toEqual([null, null, null, null]);
  });

  it('returns the rolling min', () => {
    // index 2: window [1,5,3] → min=1
    // index 3: window [5,3,7] → min=3
    // index 4: window [3,7,2] → min=2
    expect(lowest([1, 5, 3, 7, 2], 3)).toEqual([null, null, 1, 3, 2]);
  });
});

describe('tr (true range)', () => {
  it('first bar uses high - low', () => {
    expect(tr([{ high: 10, low: 8, close: 9 }])).toEqual([2]);
  });

  it('uses max of three values when prev close is available', () => {
    // bar 2: high=12, low=10, prev close=9 → |12-9|=3, |10-9|=1, high-low=2 → 3
    expect(tr([
      { high: 9, low: 8, close: 9 },
      { high: 12, low: 10, close: 11 },
    ])).toEqual([1, 3]);
  });

  it('handles gap-down bars', () => {
    // prev close=20, current high=18, low=12 → high-low=6, |18-20|=2, |12-20|=8 → 8
    expect(tr([
      { high: 21, low: 19, close: 20 },
      { high: 18, low: 12, close: 17 },
    ])).toEqual([2, 8]);
  });
});

describe('linreg', () => {
  it('returns nulls until enough data is available', () => {
    expect(linreg([1, 2, 3], 5)).toEqual([null, null, null]);
  });

  it('produces a line through noisy data close to the trend', () => {
    // Perfect linear data y = x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = linreg(data, 5, 0);
    // Each linreg window [i-4..i] is y = x, so the fitted line is exactly y
    expect(result[4]).toBe(4);
    expect(result[7]).toBe(7);
    expect(result[9]).toBe(9);
  });

  it('handles offset by projecting forward', () => {
    const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = linreg(data, 5, 1);
    // PineScript ta.linreg(src, len, offset) returns the fitted value
    // `offset` bars in the future from the regression window's last
    // bar. offset=1 projects one step ahead.
    // result[5] uses window [1..5], projects to x=5 → returns 5
    // result[9] uses window [5..9], projects to x=9 → returns 9
    expect(result[5]).toBe(5);
    expect(result[9]).toBe(9);
  });
});
