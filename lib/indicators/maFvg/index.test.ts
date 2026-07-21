import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeMaFvg } from './index';

// 120 rising bars so the MAs, the 100-bar RSI range lookback, and RSI all warm up.
const series: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const base = 100 + i;
  return { time: i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + (i % 5) * 50 };
});

const C = (high: number, low: number, close: number, i: number): Candle => ({
  time: i * 3600, open: close, high, low, close, volume: 100,
});
// A bull gap [bottom 10, top 12] at bar 2 that price never fills → stays open.
const openGap = [C(10, 8, 9, 0), C(11, 9, 11, 1), C(20, 12, 18, 2), C(19, 13, 14, 3), C(19, 13, 14, 4)];
// Same gap, then close 9 < 10 → mitigated (must NOT render a box).
const mitigatedGap = [C(10, 8, 9, 0), C(11, 9, 11, 1), C(20, 12, 18, 2), C(9.5, 7, 9, 3)];

describe('computeMaFvg composite', () => {
  const r = computeMaFvg(series);

  it('emits the core overlay plots with 1:1 candle-length data', () => {
    const ids = r.plots.map((p) => p.id);
    for (const id of ['ma_1', 'ma_2', 'ma_3', 'ma_4', 'vwap', 'vwap1', 'rsiBaseline', 'rsiLine', 'rsiStrength', 'rsiSignal']) {
      expect(ids).toContain(id);
    }
    for (const p of r.plots) expect(p.data).toHaveLength(series.length);
  });

  it('renders only UNMITIGATED FVG boxes (mitigated gaps are dropped, like the Pine)', () => {
    const open = computeMaFvg(openGap).plots.filter((p) => p.id.startsWith('fvg_') && p.type === 'band');
    expect(open.length).toBeGreaterThan(0);
    expect((open[0].data as (unknown | null)[]).filter((d) => d !== null).length).toBeGreaterThan(0);

    const mit = computeMaFvg(mitigatedGap).plots.filter((p) => p.id.startsWith('fvg_'));
    expect(mit).toHaveLength(0);
  });

  it('renders one two-tone RSI fill band between the scaled RSI line and baseline', () => {
    const fill = r.plots.find((p) => p.id === 'rsiFill')!;
    expect(fill.type).toBe('band');
    expect(fill.areaFill).toBe(true);
    expect(fill.areaFillColors).toEqual({ above: expect.any(String), below: expect.any(String) });
    // Rising series → RSI warmed up → fill populated where scaled values exist.
    expect((fill.data as (unknown | null)[]).some((d) => d !== null)).toBe(true);
    // Superseded split bands must be gone.
    expect(r.plots.map((p) => p.id)).not.toContain('rsiFillAbove');
  });

  it('returns a valid, candle-length signals array and never signals the forming bar', () => {
    expect(r.signals).toHaveLength(series.length);
    for (const s of r.signals) expect(['buy', 'sell', 'neutral']).toContain(s);
    expect(r.signals[series.length - 1]).toBe('neutral');
  });

  it('respects show* toggles (hiding MA #3 drops its plot)', () => {
    const hidden = computeMaFvg(series, { showMa3: false } as never);
    expect(hidden.plots.map((p) => p.id)).not.toContain('ma_3');
    expect(hidden.plots.map((p) => p.id)).toContain('ma_1');
  });
});
