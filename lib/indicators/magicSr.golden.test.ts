import { describe, it, expect } from 'vitest';
import { computeMagicSr } from './magicSr';
import { defineGoldenTest } from '../testing/goldenRunner';
import type { Candle } from '../types';

const c = (h: number, l: number): Candle => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 });

describe('magic_sr golden master', () => {
  defineGoldenTest({ name: 'magicSr', compute: computeMagicSr, params: { lookback: 2, count: 3, showUp: true, showDown: true } });

  it('emits resistance levels above and support levels below the last close', () => {
    // A pivot high at index 3 (high 120), pivot low at index 7 (low 80), lookback 2.
    const candles: Candle[] = [
      c(100, 95), c(101, 96), c(102, 97),
      c(120, 110),           // 3: pivot high (higher than ±2 neighbors)
      c(103, 98), c(102, 97), c(101, 96),
      c(90, 80),             // 7: pivot low
      c(95, 88), c(97, 90),
    ];
    const res = computeMagicSr(candles, { id: 'magic_sr', settings: { inputs: { lookback: 2, count: 3, showUp: true, showDown: true }, styles: {}, visibility: {} } });
    const vals = (res.levels ?? []).map((l) => l.value);
    expect(vals).toContain(120); // resistance pivot high
    expect(vals).toContain(80);  // support pivot low
    expect(res.plots).toEqual([]);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
  });

  it('respects showUp / showDown toggles', () => {
    const candles: Candle[] = [c(100, 95), c(101, 96), c(120, 110), c(101, 96), c(100, 95)];
    const noUp = computeMagicSr(candles, { id: 'magic_sr', settings: { inputs: { lookback: 1, count: 3, showUp: false, showDown: true }, styles: {}, visibility: {} } });
    expect((noUp.levels ?? []).every((l) => l.title !== 'R')).toBe(true);
  });
});
