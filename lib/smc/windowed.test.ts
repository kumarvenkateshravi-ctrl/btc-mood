import { describe, it, expect } from 'vitest';
import { computeSmc, computeSmcWindowed } from './engine';
import { makeDeterministicCandles } from '@/lib/testing/syntheticCandles';

describe('computeSmcWindowed', () => {
  const candles = makeDeterministicCandles(1200, 7);

  it('is identical to computeSmc when under the cap (modulo wall-clock diagnostics)', () => {
    const strip = ({ diagnostics: _d, ...rest }: ReturnType<typeof computeSmc>) => rest;
    expect(strip(computeSmcWindowed(candles, 5000))).toEqual(strip(computeSmc(candles)));
  });

  it('shifts every index back into full-array space when capped', () => {
    const full = computeSmcWindowed(candles, 800);
    const slice = computeSmc(candles.slice(-800));
    const off = 1200 - 800;
    expect(full.events.length).toBe(slice.events.length);
    for (let i = 0; i < slice.events.length; i++) {
      expect(full.events[i].barIndex).toBe(slice.events[i].barIndex + off);
    }
    for (const key of ['orderBlocks', 'fvgs', 'liquidityPools', 'structureLevels', 'zones'] as const) {
      for (let i = 0; i < slice.objects[key].length; i++) {
        expect(full.objects[key][i].createdAtBar).toBe(slice.objects[key][i].createdAtBar + off);
        expect(full.objects[key][i].updatedAtBar).toBe(slice.objects[key][i].updatedAtBar + off);
      }
    }
    expect(full.state.trailing.barIndex).toBe(slice.state.trailing.barIndex + off);
    // scores/state are untouched by the shift
    expect(full.scores).toEqual(slice.scores);
  });

  it('every shifted index stays within the full array bounds', () => {
    const full = computeSmcWindowed(candles, 300);
    for (const e of full.events) {
      expect(e.barIndex).toBeGreaterThanOrEqual(900);
      expect(e.barIndex).toBeLessThan(1200);
    }
  });
});
