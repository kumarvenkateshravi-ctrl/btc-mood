import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeSuperTrend } from '../../indicators/superTrend';
import { evaluateSupertrend, buildStConfidence, buildStStrength, type SupertrendDiagnostics } from './supertrend';

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
  const data = computeSuperTrend(candles).plots.find((p) => p.id === 'supertrend')?.data ?? [];
  let line: number | null = null;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    const v = d == null ? null : typeof d === 'number' ? d : (d as { value?: number }).value;
    if (v != null && Number.isFinite(v)) { line = v; break; }
  }
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  return line == null ? 50 : lastClose > line ? 100 : 0;
}

describe('evaluateSupertrend', () => {
  const scenarios: Record<string, Candle[]> = {
    up: mk(rise(120, 100, 0.5)),
    down: mk(rise(120, 200, -0.5)),
    wavy: mk(wavy(120)),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };

  for (const [name, c] of Object.entries(scenarios)) {
    it(`score frozen: ${name}`, () => {
      expect(evaluateSupertrend(c).score).toBe(frozen(c));
    });
  }

  it('steady uptrend: bullish side with persistent hold', () => {
    const r = evaluateSupertrend(mk(rise(120, 100, 0.5)));
    const d = r.diagnostics as SupertrendDiagnostics;
    expect(r.score).toBe(100);
    expect(d.side).toBe(100);
    expect(d.persistence).toBeGreaterThanOrEqual(85);
    expect(codes(r.signals!)).toContain('ST_BULLISH');
    expect(codes(r.signals!)).toContain('ST_PERSISTENT');
  });

  it('steady downtrend: bearish side', () => {
    const r = evaluateSupertrend(mk(rise(120, 200, -0.5)));
    const d = r.diagnostics as SupertrendDiagnostics;
    expect(r.score).toBe(0);
    expect(d.side).toBe(0);
    expect(codes(r.signals!)).toContain('ST_BEARISH');
  });

  it('empty candles: neutral dims', () => {
    const d = evaluateSupertrend([]).diagnostics as SupertrendDiagnostics;
    expect(d).toEqual({ side: 50, distance: 0, flipFreshness: 50, persistence: 50 });
  });

  it('deterministic + dims in range', () => {
    const c = mk(wavy(120));
    const a = evaluateSupertrend(c);
    expect(a).toEqual(evaluateSupertrend(c));
    const d = a.diagnostics as SupertrendDiagnostics;
    for (const v of [a.confidence!, a.strength!, d.side, d.distance, d.flipFreshness, d.persistence]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('builders: bull/bear symmetric from diagnostics only', () => {
    const bull: SupertrendDiagnostics = { side: 100, distance: 60, flipFreshness: 80, persistence: 90 };
    const bear: SupertrendDiagnostics = { side: 0, distance: 60, flipFreshness: 80, persistence: 90 };
    expect(buildStConfidence(bull)).toBe(buildStConfidence(bear));
    expect(buildStStrength(bull)).toBe(buildStStrength(bear));
    // 0.35·conv(100)=35 + 0.25·60=15 + 0.25·90=22.5 + 0.15·80=12 → 85 (rounded)
    expect(buildStConfidence(bull)).toBe(85);
  });
});
