import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeAdx } from '../../indicators/adx';
import { evaluateAdx, buildAdxConfidence, buildAdxStrength, type AdxDiagnostics } from './adx';

const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 300, open: i ? closes[i - 1] : close,
    high: close + 1, low: close - 1, close, volume: 1000,
  }));
const rise = (n: number, base: number, step: number) => Array.from({ length: n }, (_, i) => base + i * step);
const wavy = (n: number) => Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.05);
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** Frozen M0 logic re-implemented for parity. */
function frozen(candles: Candle[]): number {
  const plots = computeAdx(candles).plots;
  const last = (id: string): number | null => {
    const data = plots.find((p) => p.id === id)?.data ?? [];
    for (let i = data.length - 1; i >= 0; i--) {
      const d = data[i];
      const v = d == null ? null : typeof d === 'number' ? d : (d as { value?: number }).value;
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  };
  const adx = last('adx');
  const p = last('plusDI');
  const m = last('minusDI');
  if (adx == null || p == null || m == null) return 50;
  return 50 + (p >= m ? 1 : -1) * Math.max(0, Math.min(50, adx));
}

describe('evaluateAdx', () => {
  const scenarios: Record<string, Candle[]> = {
    up: mk(rise(120, 100, 0.5)),
    down: mk(rise(120, 200, -0.5)),
    wavy: mk(wavy(120)),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };

  for (const [name, c] of Object.entries(scenarios)) {
    it(`score frozen: ${name}`, () => {
      expect(evaluateAdx(c).score).toBe(frozen(c));
    });
  }

  it('steady uptrend: strong trend, bullish direction, wide DI spread', () => {
    const r = evaluateAdx(mk(rise(120, 100, 0.5)));
    const d = r.diagnostics as AdxDiagnostics;
    expect(d.trendStrength).toBeGreaterThan(50);
    expect(d.direction).toBe(100);
    expect(d.diSpread).toBeGreaterThan(50);
    expect(codes(r.signals!)).toContain('ADX_STRONG_TREND');
  });

  it('steady downtrend: bearish direction, strength still high', () => {
    const r = evaluateAdx(mk(rise(120, 200, -0.5)));
    const d = r.diagnostics as AdxDiagnostics;
    expect(d.direction).toBe(0);
    expect(r.strength).toBeGreaterThan(40); // quality, not direction
  });

  it('empty candles: neutral/zero dims', () => {
    const d = evaluateAdx([]).diagnostics as AdxDiagnostics;
    expect(d).toEqual({ trendStrength: 0, direction: 50, diSpread: 0, adxMomentum: 50 });
  });

  it('deterministic + dims in range', () => {
    const c = mk(wavy(120));
    const a = evaluateAdx(c);
    expect(a).toEqual(evaluateAdx(c));
    const d = a.diagnostics as AdxDiagnostics;
    for (const v of [a.confidence!, a.strength!, d.trendStrength, d.direction, d.diSpread, d.adxMomentum]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('builders: exact weighted mix from diagnostics only', () => {
    const d: AdxDiagnostics = { trendStrength: 80, direction: 100, diSpread: 60, adxMomentum: 70 };
    // 0.35·80 + 0.25·conv(100)=25 + 0.25·60=15 + 0.15·conv(70)=6 → 74
    expect(buildAdxConfidence(d)).toBe(74);
    // 0.5·80 + 0.3·60 + 0.2·conv(70)=8 → 66
    expect(buildAdxStrength(d)).toBe(66);
  });
});
