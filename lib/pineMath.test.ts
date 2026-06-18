import { describe, it, expect } from 'vitest';
import { highest, lowest, tr, linreg } from './pineMath';

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
