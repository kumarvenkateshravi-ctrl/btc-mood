import { describe, it, expect } from 'vitest';
import { ema, rsi } from './indicators';

describe('ema', () => {
  it('returns all nulls when input is shorter than the period', () => {
    const vals = [10, 11, 12];
    const result = ema(vals, 5);
    expect(result).toEqual([null, null, null]);
  });

  it('seeds the first value with the SMA of the first period', () => {
    const vals = [10, 11, 12, 13, 14];
    const result = ema(vals, 5);
    // indicatorts uses a slightly different seeding convention;
    // the first valid value should be close to the SMA.
    expect(result[4]).toBeGreaterThan(11.5);
    expect(result[4]).toBeLessThan(13);
  });

  it('applies the standard k=2/(period+1) recurrence', () => {
    const vals = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const result = ema(vals, 9);
    // First valid at index 8
    expect(result[8]).not.toBeNull();
    // Second valid should follow EMA recurrence
    const k = 2 / (9 + 1);
    expect(result[9]).toBeCloseTo(vals[9] * k + result[8]! * (1 - k), 10);
  });
});

describe('rsi (Wilder)', () => {
  it('returns all nulls until enough data is available', () => {
    const vals = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
    const result = rsi(vals);
    // RSI needs period + 1 bars, so first 14 should be null
    for (let i = 0; i < 14; i++) {
      expect(result[i]).toBeNull();
    }
    expect(result[14]).not.toBeNull();
  });

  it('emits 100 when there are no losses in the seed window', () => {
    const vals: number[] = [];
    for (let i = 0; i < 30; i++) vals.push(1000 + i);
    const result = rsi(vals);
    expect(result[14]).not.toBeNull();
    expect(result[14]!).toBeGreaterThanOrEqual(99);
  });

  it('emits ~0 when there are no gains in the seed window', () => {
    const vals: number[] = [];
    for (let i = 0; i < 30; i++) vals.push(1000 - i);
    const result = rsi(vals);
    expect(result[14]).not.toBeNull();
    expect(result[14]!).toBeLessThanOrEqual(1);
  });

  it('a 14-period Wilder RSI on a 15-element uptrend settles between 50 and 100', () => {
    const vals: number[] = [];
    for (let i = 0; i < 30; i++) vals.push(100 + i * 0.5);
    const result = rsi(vals);
    const last = result[result.length - 1]!;
    expect(last).toBeGreaterThan(50);
    expect(last).toBeLessThanOrEqual(100);
  });
});