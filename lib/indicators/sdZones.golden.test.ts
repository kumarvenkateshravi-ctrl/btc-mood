// lib/indicators/sdZones.golden.test.ts
import { describe, it, expect } from 'vitest';
import { computeSdZones } from './sdZones';
import { defineGoldenTest } from '../testing/goldenRunner';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

describe('sd_zones golden master', () => {
  defineGoldenTest({
    name: 'sdZones',
    compute: computeSdZones,
    params: { tf1: 'D', tf2: 'None', tf3: 'None', targetFactor: 1.5 },
  });

  it('emits a band plot per zone kind for the active TF, all neutral signals', () => {
    const candles = makeDeterministicCandles(600, 5); // spans multiple UTC days
    const res = computeSdZones(candles, {
      id: 'sd_zones',
      settings: { inputs: { tf1: 'D', tf2: 'None', tf3: 'None', targetFactor: 1.5, minStrength: 0 }, styles: {}, visibility: {} },
    });
    const ids = res.plots.map((p) => p.id);
    expect(ids).toContain('D Su');
    expect(ids).toContain('D De');
    res.plots.forEach((p) => expect(p.type).toBe('band'));
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
    expect(res.signals.length).toBe(candles.length);
  });

  it('minStrength filters out weak current zones (their label level is omitted)', () => {
    const candles = makeDeterministicCandles(600, 5);
    const cfg = (minStrength: number) => computeSdZones(candles, {
      id: 'sd_zones',
      settings: { inputs: { tf1: 'D', targetFactor: 1.5, minStrength }, styles: {}, visibility: {} },
    });
    const many = cfg(0).levels?.length ?? 0;
    const few = cfg(101).levels?.length ?? 0; // nothing scores > 100
    expect(few).toBeLessThan(many);
  });
});
