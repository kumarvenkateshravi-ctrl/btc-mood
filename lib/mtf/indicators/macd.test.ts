import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeMacd } from '../../indicators/macd';
import { evaluateMacd, buildMacdConfidence, buildMacdStrength, type MacdDiagnostics } from './macd';

const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 300, open: i ? closes[i - 1] : close,
    high: close + 1, low: close - 1, close, volume: 1000,
  }));
const rise = (n: number, base: number, step: number) => Array.from({ length: n }, (_, i) => base + i * step);
const wavy = (n: number) => Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.05);
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** Frozen M0 logic re-implemented for parity (independent lastNum per plot). */
function frozen(candles: Candle[]): number {
  const plots = computeMacd(candles).plots;
  const last = (id: string): number | null => {
    const data = plots.find((p) => p.id === id)?.data ?? [];
    for (let i = data.length - 1; i >= 0; i--) {
      const d = data[i];
      const v = d == null ? null : typeof d === 'number' ? d : (d as { value?: number }).value;
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  };
  const m = last('macd');
  const s = last('signal');
  return m == null || s == null ? 50 : m > s ? 100 : 0;
}

describe('evaluateMacd', () => {
  const scenarios: Record<string, Candle[]> = {
    up: mk(rise(120, 100, 0.5)),
    down: mk(rise(120, 200, -0.5)),
    wavy: mk(wavy(120)),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };

  for (const [name, c] of Object.entries(scenarios)) {
    it(`score frozen: ${name}`, () => {
      expect(evaluateMacd(c).score).toBe(frozen(c));
    });
  }

  it('steady uptrend: bullish cross above zero', () => {
    const r = evaluateMacd(mk(rise(120, 100, 0.5)));
    const d = r.diagnostics as MacdDiagnostics;
    expect(r.score).toBe(100);
    expect(d.crossState).toBe(100);
    expect(d.zeroLine).toBe(100);
    expect(codes(r.signals!)).toContain('MACD_BULLISH');
  });

  it('steady downtrend: bearish cross below zero', () => {
    const r = evaluateMacd(mk(rise(120, 200, -0.5)));
    const d = r.diagnostics as MacdDiagnostics;
    expect(r.score).toBe(0);
    expect(d.crossState).toBe(0);
    expect(d.zeroLine).toBe(0);
    expect(codes(r.signals!)).toContain('MACD_BEARISH');
  });

  it('empty candles: dims neutral, separation 0', () => {
    const d = evaluateMacd([]).diagnostics as MacdDiagnostics;
    expect(d).toEqual({ crossState: 50, histMomentum: 50, zeroLine: 50, separation: 0 });
  });

  it('deterministic + dims in range', () => {
    const c = mk(wavy(120));
    const a = evaluateMacd(c);
    expect(a).toEqual(evaluateMacd(c));
    const d = a.diagnostics as MacdDiagnostics;
    for (const v of [a.confidence!, a.strength!, d.crossState, d.histMomentum, d.zeroLine, d.separation]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('builders: bull/bear symmetric conviction from diagnostics only', () => {
    const bull: MacdDiagnostics = { crossState: 100, histMomentum: 80, zeroLine: 100, separation: 60 };
    const bear: MacdDiagnostics = { crossState: 0, histMomentum: 20, zeroLine: 0, separation: 60 };
    expect(buildMacdConfidence(bull)).toBe(buildMacdConfidence(bear));
    expect(buildMacdStrength(bull)).toBe(buildMacdStrength(bear));
    // 0.4·conv(100)=40 + 0.25·conv(80)=15 + 0.2·conv(100)=20 + 0.15·60=9 → 84
    expect(buildMacdConfidence(bull)).toBe(84);
  });
});
