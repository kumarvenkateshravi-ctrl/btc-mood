import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeObv } from '../../indicators/obv';
import { evaluateObv, buildObvConfidence, buildObvStrength, type ObvDiagnostics } from './obv';

const mk = (closes: number[], vol = 1000): Candle[] =>
  closes.map((close, i) => ({
    time: i * 300, open: i ? closes[i - 1] : close,
    high: close + 1, low: close - 1, close, volume: vol + (i % 5) * 80,
  }));
const rise = (n: number, base: number, step: number) => Array.from({ length: n }, (_, i) => base + i * step);
const wavy = (n: number) => Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 5));
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** Frozen M0 logic re-implemented for parity (raw typeof prev check included). */
function frozen(candles: Candle[]): number {
  const obv = computeObv(candles).plots.find((p) => p.id === 'obv')?.data ?? [];
  let last: number | null = null;
  for (let i = obv.length - 1; i >= 0; i--) {
    const d = obv[i];
    const v = d == null ? null : typeof d === 'number' ? d : (d as { value?: number }).value;
    if (v != null && Number.isFinite(v)) { last = v; break; }
  }
  const prevIdx = Math.max(0, obv.length - 15);
  const prev = typeof obv[prevIdx] === 'number' ? (obv[prevIdx] as number) : null;
  return last == null || prev == null ? 50 : last > prev ? 100 : last < prev ? 0 : 50;
}

describe('evaluateObv', () => {
  const scenarios: Record<string, Candle[]> = {
    up: mk(rise(60, 100, 0.5)),
    down: mk(rise(60, 200, -0.5)),
    wavy: mk(wavy(60)),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };

  for (const [name, c] of Object.entries(scenarios)) {
    it(`score frozen: ${name}`, () => {
      expect(evaluateObv(c).score).toBe(frozen(c));
    });
  }

  it('steady accumulation: rising OBV with one-sided flow', () => {
    const r = evaluateObv(mk(rise(60, 100, 0.5)));
    const d = r.diagnostics as ObvDiagnostics;
    expect(r.score).toBe(100);
    expect(d.trend).toBe(100);
    expect(d.consistency).toBeGreaterThanOrEqual(70);
    expect(codes(r.signals!)).toContain('OBV_RISING');
    expect(codes(r.signals!)).toContain('OBV_ONE_SIDED_FLOW');
  });

  it('steady distribution: falling OBV', () => {
    const r = evaluateObv(mk(rise(60, 200, -0.5)));
    expect(r.score).toBe(0);
    expect(codes(r.signals!)).toContain('OBV_FALLING');
  });

  it('empty candles: neutral dims', () => {
    const d = evaluateObv([]).diagnostics as ObvDiagnostics;
    expect(d).toEqual({ trend: 50, consistency: 0, acceleration: 50 });
  });

  it('deterministic + dims in range', () => {
    const c = mk(wavy(60));
    const a = evaluateObv(c);
    expect(a).toEqual(evaluateObv(c));
    const d = a.diagnostics as ObvDiagnostics;
    for (const v of [a.confidence!, a.strength!, d.trend, d.consistency, d.acceleration]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('builders: bull/bear symmetric from diagnostics only', () => {
    const bull: ObvDiagnostics = { trend: 100, consistency: 80, acceleration: 100 };
    const bear: ObvDiagnostics = { trend: 0, consistency: 80, acceleration: 0 };
    expect(buildObvConfidence(bull)).toBe(buildObvConfidence(bear));
    expect(buildObvStrength(bull)).toBe(buildObvStrength(bear));
    // 0.5·conv(100)=50 + 0.3·80=24 + 0.2·conv(100)=20 → 94
    expect(buildObvConfidence(bull)).toBe(94);
  });
});
