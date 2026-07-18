import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeRsi } from '../../indicators/rsi';
import { evaluateRsi, buildRsiConfidence, buildRsiStrength, type RsiDiagnostics } from './rsi';

const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 300, open: i ? closes[i - 1] : close,
    high: close + 1, low: close - 1, close, volume: 1000,
  }));
const rise = (n: number, base: number, step: number) => Array.from({ length: n }, (_, i) => base + i * step);
const wavy = (n: number) => Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.05);
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** Frozen M0 logic re-implemented for parity. */
function frozen(candles: Candle[]): { score: number; display: string } {
  const data = computeRsi(candles).plots.find((p) => p.id === 'rsi')?.data ?? [];
  let rsi: number | null = null;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    const v = d == null ? null : typeof d === 'number' ? d : (d as { value?: number }).value;
    if (v != null && Number.isFinite(v)) { rsi = v; break; }
  }
  const score = rsi == null ? 50 : Math.max(0, Math.min(100, rsi));
  return { score, display: rsi == null ? '—' : rsi.toFixed(1) };
}

describe('evaluateRsi', () => {
  const scenarios: Record<string, Candle[]> = {
    up: mk(rise(120, 100, 0.5)),
    down: mk(rise(120, 200, -0.5)),
    wavy: mk(wavy(120)),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };

  for (const [name, c] of Object.entries(scenarios)) {
    it(`score/display frozen: ${name}`, () => {
      const r = evaluateRsi(c);
      const f = frozen(c);
      expect(r.score).toBe(f.score);
      expect(r.display).toBe(f.display);
    });
  }

  it('strong uptrend: overbought zone (RSI saturated & flat → momentum neutral)', () => {
    const r = evaluateRsi(mk(rise(120, 100, 0.5)));
    const d = r.diagnostics as RsiDiagnostics;
    expect(d.position).toBeGreaterThan(60);
    expect(d.zone).toBeGreaterThanOrEqual(70);
    expect(codes(r.signals!)).toContain('RSI_OVERBOUGHT');
  });

  it('emerging uptrend: rising RSI fires the bullish-momentum signal', () => {
    // Short steep rise: RSI is still mid-climb at the last bar (slope not yet decayed).
    const emerging = mk([...wavy(80), ...rise(10, 104, 2)]);
    const r = evaluateRsi(emerging);
    const d = r.diagnostics as RsiDiagnostics;
    expect(d.position).toBeGreaterThanOrEqual(60);
    expect(d.momentum).toBeGreaterThanOrEqual(60);
    expect(codes(r.signals!)).toContain('RSI_BULLISH_MOMENTUM');
  });

  it('strong downtrend: oversold zone', () => {
    const r = evaluateRsi(mk(rise(120, 200, -0.5)));
    const d = r.diagnostics as RsiDiagnostics;
    expect(d.position).toBeLessThan(40);
    expect(d.zone).toBeLessThanOrEqual(30);
  });

  it('empty candles: all dims neutral', () => {
    const d = evaluateRsi([]).diagnostics as RsiDiagnostics;
    expect(d).toEqual({ position: 50, zone: 50, momentum: 50 });
  });

  it('deterministic + dims in range', () => {
    const c = mk(wavy(120));
    const a = evaluateRsi(c);
    expect(a).toEqual(evaluateRsi(c));
    const d = a.diagnostics as RsiDiagnostics;
    for (const v of [a.confidence!, a.strength!, d.position, d.zone, d.momentum]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('builders: bull/bear symmetric conviction from diagnostics only', () => {
    const bull: RsiDiagnostics = { position: 80, zone: 100, momentum: 70 };
    const bear: RsiDiagnostics = { position: 20, zone: 0, momentum: 30 };
    expect(buildRsiConfidence(bull)).toBe(buildRsiConfidence(bear));
    expect(buildRsiStrength(bull)).toBe(buildRsiStrength(bear));
    // 0.5·conv(80)=30 + 0.3·conv(70)=12 + 0.2·conv(100)=20 → 62
    expect(buildRsiConfidence(bull)).toBe(62);
  });
});
