import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import {
  evaluateEma, barsSinceCross, buildConfidence, buildStrength,
  EMA_FRESH_DECAY, EMA_FRESH_FLOOR, type EmaDiagnostics,
} from './ema';

// ---- fixtures ----
const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 300, open: i ? closes[i - 1] : close,
    high: close + 1, low: close - 1, close, volume: 1000,
  }));
const rise = (n: number, base: number, step: number) => Array.from({ length: n }, (_, i) => base + i * step);
const fall = (n: number, base: number, step: number) => rise(n, base, -step);

/** Re-implements the frozen M0 bucket so every scenario proves score parity. */
function expectedFrozenScore(candles: Candle[]): number {
  const closes = candles.map((c) => c.close);
  const last = (a: (number | null)[]) => (a.length ? a[a.length - 1] : null);
  const e20 = last(pm.emaPine(closes, 20));
  const e50 = last(pm.emaPine(closes, 50));
  const e200 = last(pm.emaPine(closes, 200));
  if (e20 == null || e50 == null) return 50;
  const longTerm = e200 ?? e50;
  if (e20 > e50 && e50 >= longTerm) return 100;
  if (e20 < e50 && e50 <= longTerm) return 0;
  return e20 > e50 ? 65 : 35;
}

const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('evaluateEma — frozen score parity (all scenarios)', () => {
  const scenarios: Record<string, Candle[]> = {
    perfectBull: mk(rise(300, 100, 0.5)),
    strongBear: mk(fall(300, 300, 0.5)),
    mixed: mk([...fall(260, 300, 0.5), ...rise(40, 170, 2)]),
    flat: mk(Array(260).fill(100)),
    sideways: mk(Array.from({ length: 260 }, (_, i) => 100 + 10 * Math.sin(i / 5))),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };
  for (const [name, candles] of Object.entries(scenarios)) {
    it(`score frozen: ${name}`, () => {
      expect(evaluateEma(candles).score).toBe(expectedFrozenScore(candles));
    });
  }
});

describe('evaluateEma — scenarios', () => {
  it('Perfect Bull: full alignment, price above all, mature trend is not penalized', () => {
    const r = evaluateEma(mk(rise(300, 100, 0.5)));
    const d = r.diagnostics as EmaDiagnostics;
    expect(r.score).toBe(100);
    expect(d.alignment).toBe(100);
    expect(d.pricePosition).toBe(100);
    expect(d.slope).toBeGreaterThan(60);
    expect(d.freshness).toBe(50); // monotone rise → no cross ever → neutral, NOT 0
    expect(codes(r.signals!)).toContain('EMA_ALIGNMENT_STRONG');
    expect(codes(r.signals!)).toContain('EMA_PRICE_ABOVE_ALL');
    expect(r.confidence).toBeGreaterThan(50);
    expect(r.strength).toBeGreaterThan(50);
  });

  it('Strong Bear: mirrored — strength high despite bearish direction', () => {
    const r = evaluateEma(mk(fall(300, 300, 0.5)));
    const d = r.diagnostics as EmaDiagnostics;
    expect(r.score).toBe(0);
    expect(d.alignment).toBe(0);
    expect(d.pricePosition).toBe(0);
    expect(d.slope).toBeLessThan(40);
    expect(codes(r.signals!)).toContain('EMA_PRICE_BELOW_ALL');
    expect(r.strength).toBeGreaterThan(50); // trend QUALITY, not direction
  });

  it('Mixed Alignment: partial bucket + mixed-alignment warning', () => {
    const r = evaluateEma(mk([...fall(260, 300, 0.5), ...rise(40, 170, 2)]));
    const d = r.diagnostics as EmaDiagnostics;
    expect([35, 65]).toContain(r.score);
    expect([35, 65]).toContain(d.alignment);
    expect(codes(r.warnings!)).toContain('EMA_MIXED_ALIGNMENT');
  });

  it('Old Cross: long-ago cross floors freshness and warns EMA_AGING', () => {
    const r = evaluateEma(mk([...fall(60, 300, 1), ...rise(240, 240, 1)]));
    const d = r.diagnostics as EmaDiagnostics;
    expect(d.freshness).toBe(EMA_FRESH_FLOOR);
    expect(codes(r.warnings!)).toContain('EMA_AGING');
  });

  it('Flat Market: compression + flat-slope warnings, minimal strength', () => {
    const r = evaluateEma(mk(Array(260).fill(100)));
    const d = r.diagnostics as EmaDiagnostics;
    expect(d.alignment).toBe(50);   // exact equality → neutral (diagnostic only)
    expect(d.separation).toBe(0);
    expect(d.slope).toBe(50);
    expect(d.freshness).toBe(50);
    expect(codes(r.warnings!)).toContain('EMA_COMPRESSION');
    expect(codes(r.warnings!)).toContain('EMA_FLAT_SLOPE');
    expect(r.strength).toBe(0);
  });

  it('Insufficient Data: empty candles → all-neutral diagnostics', () => {
    const r = evaluateEma([]);
    const d = r.diagnostics as EmaDiagnostics;
    expect(r.score).toBe(50);
    expect(d).toEqual({ alignment: 50, separation: 0, slope: 50, pricePosition: 50, freshness: 50 });
  });

  it('Sideways: everything stays in range and is deterministic', () => {
    const c = mk(Array.from({ length: 260 }, (_, i) => 100 + 10 * Math.sin(i / 5)));
    const a = evaluateEma(c);
    expect(a).toEqual(evaluateEma(c));
    const d = a.diagnostics as EmaDiagnostics;
    for (const v of [a.score, a.confidence!, a.strength!, d.alignment, d.separation, d.slope, d.pricePosition, d.freshness]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('barsSinceCross', () => {
  it('finds the last sign flip of e20−e50', () => {
    expect(barsSinceCross([1, 1, 3, 3], [2, 2, 2, 2])).toBe(2);   // flip between i=1 and i=2
    expect(barsSinceCross([3, 3, 3], [2, 2, 2])).toBeNull();      // never flips
    expect(barsSinceCross([2, 2], [2, 2])).toBeNull();            // always equal → no sign
    expect(barsSinceCross([], [])).toBeNull();
  });
});

describe('confidence & strength builders (from diagnostics only)', () => {
  const d: EmaDiagnostics = { alignment: 100, separation: 80, slope: 90, pricePosition: 100, freshness: 90 };
  it('conviction magnitude: perfect bull and perfect bear score identically', () => {
    const bear: EmaDiagnostics = { alignment: 0, separation: 80, slope: 10, pricePosition: 0, freshness: 90 };
    expect(buildConfidence(bear)).toBe(buildConfidence(d));
    expect(buildStrength(bear)).toBe(buildStrength(d));
  });
  it('confidence follows the documented weights', () => {
    // 0.40·100 + 0.20·80 + 0.20·80 + 0.10·100 + 0.10·90 = 91
    expect(buildConfidence(d)).toBe(91);
  });
  it('freshness constants guard accidental retuning', () => {
    expect(EMA_FRESH_DECAY).toBe(4);
    expect(EMA_FRESH_FLOOR).toBe(20);
  });
});
