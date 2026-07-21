import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeMaFvg } from './index';

// 60 rising-then-wobbling bars so MAs/VWAP/RSI all warm up and a gap can form.
const series: Candle[] = Array.from({ length: 60 }, (_, i) => {
  const base = 100 + i;
  return { time: i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + (i % 5) * 50 };
});
// Inject a clean bullish FVG at index 40 (low[40] gaps above high[38]).
series[40] = { time: 40 * 3600, open: 150, high: 165, low: 155, close: 160, volume: 2000 };

describe('computeMaFvg composite', () => {
  const r = computeMaFvg(series);

  it('emits the core overlay plots with 1:1 candle-length data', () => {
    const ids = r.plots.map((p) => p.id);
    for (const id of ['ma_1', 'ma_2', 'ma_3', 'ma_4', 'vwap', 'vwap1', 'rsiBaseline', 'rsiLine', 'rsiStrength', 'rsiSignal']) {
      expect(ids).toContain(id);
    }
    for (const p of r.plots) expect(p.data).toHaveLength(series.length);
  });

  it('renders at least one FVG band box', () => {
    const fvgBands = r.plots.filter((p) => p.id.startsWith('fvg_') && p.type === 'band');
    expect(fvgBands.length).toBeGreaterThan(0);
    const filled = (fvgBands[0].data as (unknown | null)[]).filter((d) => d !== null);
    expect(filled.length).toBeGreaterThan(0);
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
