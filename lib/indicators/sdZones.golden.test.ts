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

  it('minStrength filters out weak current zones (their on-zone label is omitted)', () => {
    const candles = makeDeterministicCandles(600, 5);
    const cfg = (minStrength: number) => computeSdZones(candles, {
      id: 'sd_zones',
      settings: { inputs: { tf1: 'D', targetFactor: 1.5, minStrength }, styles: {}, visibility: {} },
    });
    const labelCount = (r: ReturnType<typeof computeSdZones>) =>
      r.plots.filter((p) => p.zoneStyle?.label).length;
    const many = labelCount(cfg(0));
    const few = labelCount(cfg(101)); // nothing scores > 100
    expect(few).toBeLessThan(many);
  });

  it('entry zones carry boundary-first zone styling; targets stay subtle', () => {
    const candles = makeDeterministicCandles(600, 5);
    const res = computeSdZones(candles, {
      id: 'sd_zones',
      settings: { inputs: { tf1: 'D', tf2: '4H', tf3: 'None', targetFactor: 1.5, minStrength: 0 }, styles: {}, visibility: {} },
    });
    const byId = new Map(res.plots.map((p) => [p.id, p]));
    // Boundary faces price: supply → lower edge, demand → upper edge.
    expect(byId.get('D Su')?.zoneStyle?.boundary).toBe('lower');
    expect(byId.get('D De')?.zoneStyle?.boundary).toBe('upper');
    // Target bands are context only — no boundary, no label.
    expect(byId.get('D Su T')?.zoneStyle?.boundary).toBeUndefined();
    expect(byId.get('D Su T')?.zoneStyle?.label).toBeUndefined();
    // Timeframes are differentiated by dash style.
    expect(byId.get('D Su')?.zoneStyle?.lineStyle).toBe('solid');
    expect(byId.get('4H Su')?.zoneStyle?.lineStyle).toBe('dashed');
    // Labels read "TF Kind ★score".
    const label = byId.get('D Su')?.zoneStyle?.label ?? byId.get('D De')?.zoneStyle?.label ?? '';
    expect(label).toMatch(/^D (Supply|Demand) ★\d+$/);
  });
});
