import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { buildSetup, lastAtr } from './levels';

// Constant-range bars (high−low = 2, |Δmid| ≤ 1) ⇒ TR = 2 every bar ⇒ ATR = 2 exactly.
const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));

const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];
const MARKET = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 106.5, 106, 105.4];
const SHORT = [120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110, 111, 112, 113, 114, 113, 113, 113, 113, 113];
const MONO = Array.from({ length: 20 }, (_, i) => 100 + i);
const RRLOW = [100, 101, 102, 101, 100, 99, 100, 101, 100.5, 100, 100.5, 101, 101, 101, 101, 101, 101, 101, 101, 101];
const NOOBST = [104, 103, 102, 101, 100, ...Array.from({ length: 15 }, (_, i) => 101 + i)];
const BREAK = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 106, 105, 104, 103, 102.9];

describe('lastAtr', () => {
  it('constant-range fixture pins ATR at exactly 2', () => {
    expect(lastAtr(bars(LONG))).toBe(2);
  });
});

describe('buildSetup — long core', () => {
  it('canonical long: zone/stop/targets/RR hand-computed exactly', () => {
    const out = buildSetup('long', bars(LONG));
    expect(out.kind).toBe('setup');
    if (out.kind !== 'setup') return;
    expect(out.lastClose).toBe(107);
    expect(out.swingHigh).toBe(111);
    expect(out.swingLow).toBe(105);
    const s = out.setup;
    expect(s.entry.zone).toEqual([105, 105.5]);
    expect(s.entry.type).toBe('pullback');
    expect(s.entry.basis.source).toBe('swing');
    expect(s.stop.price).toBe(103);
    expect(s.stop.source).toBe('swing');
    expect(s.stop.distancePct).toBe(2.14);
    expect(s.targets).toHaveLength(2);
    expect(s.targets[0]).toMatchObject({ price: 111, source: 'swing', rr: 2.56 });
    expect(s.targets[1]).toMatchObject({ price: 109.75, source: 'atr', rr: 2 });
    expect(s.rr).toBe(2.56);
    expect(s.atr).toBe(2);
  });

  it('close inside the zone → market entry, same levels', () => {
    const out = buildSetup('long', bars(MARKET));
    expect(out.kind).toBe('setup');
    if (out.kind !== 'setup') return;
    expect(out.setup.entry.zone).toEqual([105, 105.5]);
    expect(out.setup.entry.type).toBe('market');
  });
});

describe('buildSetup — short mirror', () => {
  it('canonical short: exact mirror values', () => {
    const out = buildSetup('short', bars(SHORT));
    expect(out.kind).toBe('setup');
    if (out.kind !== 'setup') return;
    const s = out.setup;
    expect(s.entry.zone).toEqual([114.5, 115]);
    expect(s.entry.type).toBe('pullback');
    expect(s.stop.price).toBe(117);
    expect(s.stop.distancePct).toBe(1.96);
    expect(s.targets[0]).toMatchObject({ price: 109, source: 'swing', rr: 2.56 });
    expect(s.targets[1]).toMatchObject({ price: 110.25, source: 'atr', rr: 2 });
    expect(s.rr).toBe(2.56);
  });
});

describe('buildSetup — blocks', () => {
  it('monotone series has no anchoring swing → insufficient_structure', () => {
    expect(buildSetup('long', bars(MONO))).toEqual({
      kind: 'block', block: 'insufficient_structure', rawRR: null, swingHigh: null, swingLow: null,
    });
  });

  it('structural obstacle too close → rr_too_low with rawRR recorded', () => {
    expect(buildSetup('long', bars(RRLOW))).toEqual({
      kind: 'block', block: 'rr_too_low', rawRR: 1.22, swingHigh: 102, swingLow: 99,
    });
  });

  it('close at/beyond the stop = broken structure → insufficient_structure', () => {
    expect(buildSetup('long', bars(BREAK))).toEqual({
      kind: 'block', block: 'insufficient_structure', rawRR: null, swingHigh: 111, swingLow: 105,
    });
  });
});

describe('buildSetup — no structural obstacle', () => {
  it('measured move leads as the sole target, RR = targetRR', () => {
    const out = buildSetup('long', bars(NOOBST));
    expect(out.kind).toBe('setup');
    if (out.kind !== 'setup') return;
    const s = out.setup;
    expect(out.swingHigh).toBeNull();
    expect(s.entry.zone).toEqual([99, 99.5]);
    expect(s.stop.price).toBe(97);
    expect(s.stop.distancePct).toBe(2.27);
    expect(s.targets).toHaveLength(1);
    expect(s.targets[0]).toMatchObject({ price: 103.75, source: 'atr', rr: 2 });
    expect(s.rr).toBe(2);
  });
});
