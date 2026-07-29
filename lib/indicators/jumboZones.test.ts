import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeJumboZones, median, expansionZones } from './jumboZones';

const DAY = 86400;
const oc = (time: number, o: number, h: number, l: number): Candle => ({ time, open: o, high: h, low: l, close: o, volume: 1 });

describe('median', () => {
  it('odd / even / unsorted / empty', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('expansionZones', () => {
  it('matches the creator worked example (O 64000, EB 780, ES 760, 21/29/53/62)', () => {
    const z = expansionZones(64000, 780, 760, [21, 29], [53, 62]);
    expect(z.R1.lower).toBeCloseTo(64163.8, 6); expect(z.R1.upper).toBeCloseTo(64226.2, 6);
    expect(z.R2.lower).toBeCloseTo(64413.4, 6); expect(z.R2.upper).toBeCloseTo(64483.6, 6);
    expect(z.S1.lower).toBeCloseTo(63779.6, 6); expect(z.S1.upper).toBeCloseTo(63840.4, 6);
    expect(z.S2.lower).toBeCloseTo(63528.8, 6); expect(z.S2.upper).toBeCloseTo(63597.2, 6);
  });
  it('validates crossing percentiles via min/max (never flips)', () => {
    const z = expansionZones(1000, 100, 100, [35, 29], [53, 62]);
    expect(z.R1.lower).toBeLessThan(z.R1.upper);
    expect(z.R1.lower).toBeCloseTo(1029, 6); // min(1035, 1029)
    expect(z.R1.upper).toBeCloseTo(1035, 6);
  });
});
