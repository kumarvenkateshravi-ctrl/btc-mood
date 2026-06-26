import { describe, it, expect } from 'vitest';
import { computeTfCells, computeAlignmentMatrix, type AlignmentMatrix } from './alignment';
import { computeStackScore } from './stackScore';
import type { Candle, Timeframe } from './types';

function series(n: number, base: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return {
      time: i * 300,
      open: o,
      high: Math.max(o, close) + 1,
      low: Math.min(o, close) - 1,
      close,
      volume: 1000 + (i % 5) * 80,
    };
  });
}

const TFS: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

describe('computeTfCells', () => {
  it('reads a strong uptrend as bullish with a high score', () => {
    const { cells, score, verdict } = computeTfCells(series(260, 100, 0.5));
    expect(verdict).toBe('bullish');
    expect(score).toBeGreaterThan(60);
    expect(cells.ema.verdict).toBe('bullish');
    expect(cells.supertrend.verdict).toBe('bullish');
    expect(cells.macd.verdict).toBe('bullish');
  });

  it('reads a strong downtrend as bearish with a low score', () => {
    const { cells, score, verdict } = computeTfCells(series(260, 300, -0.5));
    expect(verdict).toBe('bearish');
    expect(score).toBeLessThan(40);
    expect(cells.ema.verdict).toBe('bearish');
    expect(cells.supertrend.verdict).toBe('bearish');
  });

  it('RSI/ADX cells display numeric values; label cells display words', () => {
    const { cells } = computeTfCells(series(260, 100, 0.5));
    expect(cells.rsi.display).toMatch(/^\d+\.\d$/);
    expect(cells.adx.display).toMatch(/^\d+\.\d$/);
    expect(['Bullish', 'Bearish', 'Neutral']).toContain(cells.ema.display);
    expect(cells.volume.display).toMatch(/%$/);
  });
});

describe('computeAlignmentMatrix', () => {
  it('builds 7 rows and a score per available timeframe', () => {
    const byTf = Object.fromEntries(TFS.map((tf) => [tf, series(260, 100, 0.5)])) as Record<Timeframe, Candle[]>;
    const m = computeAlignmentMatrix(byTf, TFS);
    expect(m.rows).toHaveLength(7);
    for (const tf of TFS) {
      expect(m.tfScore[tf]).toBeGreaterThan(60);
      expect(m.tfVerdict[tf]).toBe('bullish');
    }
  });
});

// --- Stack Score over hand-built matrices (isolates the formula) ---

function matrixFrom(sub: number, verdict: 'bullish' | 'bearish' | 'neutral'): AlignmentMatrix {
  const subRec: AlignmentMatrix['sub'] = {};
  const tfScore: AlignmentMatrix['tfScore'] = {};
  const tfVerdict: AlignmentMatrix['tfVerdict'] = {};
  for (const tf of TFS) {
    subRec[tf] = { ema: sub, supertrend: sub, rsi: sub, macd: sub, adx: sub, obv: sub, volume: sub };
    tfScore[tf] = sub;
    tfVerdict[tf] = verdict;
  }
  return { rows: [], tfScore, tfVerdict, sub: subRec };
}

describe('computeStackScore', () => {
  it('all-bullish, max sub-scores → 100 / STRONG BUY / 5 stars / 6 bull', () => {
    const s = computeStackScore(matrixFrom(100, 'bullish'), TFS);
    expect(s.score).toBe(100);
    expect(s.recommendation).toBe('STRONG BUY');
    expect(s.stars).toBe(5);
    expect(s.bullCount).toBe(6);
    expect(s.direction).toBe('buy');
  });

  it('all-bearish, min sub-scores → 0 / STRONG SELL', () => {
    const s = computeStackScore(matrixFrom(0, 'bearish'), TFS);
    expect(s.score).toBe(0);
    expect(s.recommendation).toBe('STRONG SELL');
    expect(s.direction).toBe('sell');
    expect(s.bearCount).toBe(6);
  });

  it('neutral mid → ~50 / NEUTRAL', () => {
    const s = computeStackScore(matrixFrom(50, 'neutral'), TFS);
    expect(s.score).toBe(50);
    expect(s.recommendation).toBe('NEUTRAL');
    expect(s.direction).toBe('neutral');
  });

  it('recommendation bands map correctly (consensus factored in)', () => {
    // bullish consensus adds +10: 58*0.9 + 10 = 62 → MODERATE.
    expect(computeStackScore(matrixFrom(58, 'bullish'), TFS).recommendation).toBe('MODERATE');
    // bearish consensus adds 0: 42*0.9 = 38 → WEAK SELL.
    expect(computeStackScore(matrixFrom(42, 'bearish'), TFS).recommendation).toBe('WEAK SELL');
  });
});
