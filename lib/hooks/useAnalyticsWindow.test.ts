import { describe, it, expect } from 'vitest';
import { stepAnalyticsWindow, tailSignature, type WindowState } from './useAnalyticsWindow';
import type { Candle, Timeframe } from '@/lib/types';

const mk = (times: number[], close = 100): Candle[] =>
  times.map((t) => ({ time: t, open: close, high: close + 1, low: close - 1, close, volume: 1 }));

const EMPTY: WindowState = { sigs: {}, out: {} };
const byTf = (arr: Candle[]): Partial<Record<Timeframe, Candle[]>> => ({ '1h': arr });

describe('stepAnalyticsWindow', () => {
  it('caps to the most recent bars', () => {
    const arr = mk(Array.from({ length: 50 }, (_, i) => i));
    const s = stepAnalyticsWindow(EMPTY, byTf(arr), 10);
    expect(s.out['1h']!.length).toBe(10);
    expect(s.out['1h']![0].time).toBe(40);
    expect(s.out['1h']![9].time).toBe(49);
  });

  it('passes small arrays through untouched (same reference)', () => {
    const arr = mk([1, 2, 3]);
    const s = stepAnalyticsWindow(EMPTY, byTf(arr), 10);
    expect(s.out['1h']).toBe(arr);
  });

  it('PREPEND of old bars beyond the window returns the IDENTICAL state object', () => {
    const tail = Array.from({ length: 20 }, (_, i) => 100 + i);
    const s1 = stepAnalyticsWindow(EMPTY, byTf(mk(tail)), 10);
    // prepend 1000 older bars; tail (last 10) unchanged
    const grown = mk([...Array.from({ length: 1000 }, (_, i) => i - 1000), ...tail]);
    const s2 = stepAnalyticsWindow(s1, byTf(grown), 10);
    expect(s2).toBe(s1); // same outer object → all downstream memos skip
  });

  it('an in-bar tick (close change) produces a new slice', () => {
    const arr = mk([1, 2, 3, 4, 5]);
    const s1 = stepAnalyticsWindow(EMPTY, byTf(arr), 3);
    const ticked = [...arr.slice(0, 4), { ...arr[4], close: 101, high: 102 }];
    const s2 = stepAnalyticsWindow(s1, byTf(ticked), 3);
    expect(s2).not.toBe(s1);
    expect(s2.out['1h']![2].close).toBe(101);
  });

  it('a bar close (append) produces a new slice', () => {
    const arr = mk([1, 2, 3, 4, 5]);
    const s1 = stepAnalyticsWindow(EMPTY, byTf(arr), 3);
    const s2 = stepAnalyticsWindow(s1, byTf(mk([1, 2, 3, 4, 5, 6])), 3);
    expect(s2).not.toBe(s1);
    expect(s2.out['1h']![2].time).toBe(6);
  });

  it('only the changed TF gets a new slice; others keep their reference', () => {
    const h1 = mk([1, 2, 3]);
    const d1 = mk([10, 20, 30]);
    const s1 = stepAnalyticsWindow(EMPTY, { '1h': h1, '1d': d1 }, 10);
    const s2 = stepAnalyticsWindow(s1, { '1h': mk([1, 2, 3, 4]), '1d': d1 }, 10);
    expect(s2.out['1d']).toBe(s1.out['1d']);
    expect(s2.out['1h']).not.toBe(s1.out['1h']);
  });

  it('tailSignature ignores bars outside the window', () => {
    const tail = mk([5, 6, 7]);
    const grown = mk([1, 2, 3, 4, 5, 6, 7]);
    expect(tailSignature(tail, 3)).toBe(tailSignature(grown, 3));
  });
});
