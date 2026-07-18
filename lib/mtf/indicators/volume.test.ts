import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import { evaluateVolume, buildVolConfidence, buildVolStrength, type VolumeDiagnostics } from './volume';

const mkv = (volumes: number[]): Candle[] =>
  volumes.map((volume, i) => ({
    time: i * 300, open: 100, high: 101, low: 99, close: 100.5, volume,
  }));
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** Frozen M0 logic re-implemented for parity. */
function frozen(candles: Candle[]): { score: number; display: string } {
  const volumes = candles.map((c) => c.volume);
  const smaArr = pm.sma(volumes, 20);
  let volSma: number | null = null;
  for (let i = smaArr.length - 1; i >= 0; i--) {
    const v = smaArr[i];
    if (v != null && Number.isFinite(v)) { volSma = v; break; }
  }
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volPct = volSma && volSma > 0 ? (lastVol / volSma - 1) * 100 : 0;
  const score = Math.max(0, Math.min(100, 50 + volPct / 2));
  return { score, display: `${volPct >= 0 ? '+' : ''}${volPct.toFixed(0)}%` };
}

describe('evaluateVolume', () => {
  const flat = Array(40).fill(1000);
  const scenarios: Record<string, Candle[]> = {
    flat: mkv(flat),
    spike: mkv([...flat, 3000]),
    dry: mkv([...flat, 300]),
    rising: mkv(Array.from({ length: 40 }, (_, i) => 500 + i * 50)),
    short: mkv([1000, 1200]),
    empty: [],
  };

  for (const [name, c] of Object.entries(scenarios)) {
    it(`score/display frozen: ${name}`, () => {
      const r = evaluateVolume(c);
      const f = frozen(c);
      expect(r.score).toBe(f.score);
      expect(r.display).toBe(f.display);
    });
  }

  it('spike: surge saturates and VOL_SPIKE fires', () => {
    const r = evaluateVolume(mkv([...flat, 3000]));
    const d = r.diagnostics as VolumeDiagnostics;
    expect(d.surge).toBeGreaterThanOrEqual(70);
    expect(codes(r.signals!)).toContain('VOL_SPIKE');
  });

  it('dry-up: VOL_DRY_UP fires, surge 0', () => {
    const r = evaluateVolume(mkv([...flat, 300]));
    const d = r.diagnostics as VolumeDiagnostics;
    expect(d.surge).toBe(0);
    expect(codes(r.warnings!)).toContain('VOL_DRY_UP');
  });

  it('rising participation: trend above 50', () => {
    const r = evaluateVolume(mkv(Array.from({ length: 40 }, (_, i) => 500 + i * 50)));
    const d = r.diagnostics as VolumeDiagnostics;
    expect(d.trend).toBeGreaterThan(50);
    expect(codes(r.signals!)).toContain('VOL_RISING_PARTICIPATION');
  });

  it('empty candles: neutral dims', () => {
    const d = evaluateVolume([]).diagnostics as VolumeDiagnostics;
    expect(d).toEqual({ pressure: 50, surge: 0, trend: 50 });
  });

  it('deterministic + dims in range', () => {
    const c = mkv([...flat, 1500]);
    const a = evaluateVolume(c);
    expect(a).toEqual(evaluateVolume(c));
    const d = a.diagnostics as VolumeDiagnostics;
    for (const v of [a.confidence!, a.strength!, d.pressure, d.surge, d.trend]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('builders: exact weighted mix from diagnostics only', () => {
    const d: VolumeDiagnostics = { pressure: 90, surge: 80, trend: 70 };
    // 0.4·conv(90)=32 + 0.3·80=24 + 0.3·conv(70)=12 → 68
    expect(buildVolConfidence(d)).toBe(68);
    // 0.5·80=40 + 0.3·conv(70)=12 + 0.2·conv(90)=16 → 68
    expect(buildVolStrength(d)).toBe(68);
  });
});
