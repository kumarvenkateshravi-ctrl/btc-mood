import { describe, it, expect } from 'vitest';
import { computeVolSpike } from './volSpike';
import { defineGoldenTest } from '../testing/goldenRunner';
import type { Candle } from '../types';

const flat = (v: number, up: boolean): Candle =>
  ({ time: 0, open: 100, high: 101, low: 99, close: up ? 101 : 99, volume: v });

describe('vol_spike golden master', () => {
  defineGoldenTest({ name: 'volSpike', compute: computeVolSpike, params: { length: 20, mult: 1.8 } });

  it('marks up-spikes blue below the bar and down-spikes dark above', () => {
    // 20 calm bars (vol 10), then an up-spike (vol 30) and a down-spike (vol 40).
    const candles: Candle[] = [
      ...Array.from({ length: 20 }, () => flat(10, true)),
      flat(30, true),   // index 20: up-spike (30 > 10*1.8)
      flat(40, false),  // index 21: down-spike
    ];
    const res = computeVolSpike(candles, { id: 'vol_spike', settings: { inputs: { length: 20, mult: 1.8 }, styles: {}, visibility: {} } });
    const up = res.markers?.find((m) => m.index === 20);
    const down = res.markers?.find((m) => m.index === 21);
    expect(up).toMatchObject({ position: 'belowBar', shape: 'arrowUp' });
    expect(down).toMatchObject({ position: 'aboveBar', shape: 'arrowDown' });
    // warm-up bars (< length) produce no marks
    expect(res.markers?.some((m) => m.index < 20)).toBe(false);
    expect(res.plots).toEqual([]);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
  });
});
