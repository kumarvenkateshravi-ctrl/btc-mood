import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types';
import type { AlignmentMatrix } from '../../alignment';
import type { Consensus, WeightedScore } from '../../multiTimeframe';
import { computeBoardDecision } from './boardEngine';

// Same zigzag builder as lib/multiTimeframe.test.ts's detectStructure suite —
// a strictly monotonic series has no confirmable pivots, so real swing shape
// is needed to exercise detectStructure through the Board.
const swing = (n: number, base: number, trend: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * trend + 5 * Math.sin(i * 0.6);
    return { time: i * 300, open: close, high: close + 1.5, low: close - 1.5, close, volume: 1000 };
  });

const matrixOf = (
  tfVerdict: AlignmentMatrix['tfVerdict'],
  tfScore: AlignmentMatrix['tfScore'],
): AlignmentMatrix => ({ rows: [], tfScore, tfVerdict, sub: {} });

const consensusOf = (bull: number, bear: number, neutral: number): Consensus => {
  const total = bull + bear + neutral;
  return {
    bull, bear, neutral, total,
    pctBull: total ? Math.round((bull / total) * 100) : 0,
    overall: bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral',
  };
};

const weightedOf = (overall: number, outlook: WeightedScore['outlook'], perTf: WeightedScore['perTf']): WeightedScore =>
  ({ overall, outlook, perTf });

describe('computeBoardDecision — Arch v2 sole direction authority', () => {
  it('aligned bullish stack across all 6 TFs → long, full conviction, strong trend, structure from 5m candles', () => {
    const matrix = matrixOf(
      { '1d': 'bullish', '4h': 'bullish', '1h': 'bullish', '30m': 'bullish', '15m': 'bullish', '5m': 'bullish' },
      { '1d': 88, '4h': 86, '1h': 84, '30m': 83, '15m': 82, '5m': 80 },
    );
    const consensus = consensusOf(6, 0, 0);
    const weighted = weightedOf(85, 'bullish', [
      { tf: '1d' as Timeframe, weight: 0.2, score: 88 }, { tf: '4h' as Timeframe, weight: 0.2, score: 86 },
      { tf: '1h' as Timeframe, weight: 0.2, score: 84 }, { tf: '30m' as Timeframe, weight: 0.15, score: 83 },
      { tf: '15m' as Timeframe, weight: 0.15, score: 82 }, { tf: '5m' as Timeframe, weight: 0.1, score: 80 },
    ]);
    const board = computeBoardDecision(matrix, consensus, weighted, { '5m': swing(60, 100, 1) });

    expect(board.schemaVersion).toBe(1);
    expect(board.direction).toBe('long');
    expect(board.bias).toBe('bullish');
    expect(board.conviction).toBe(100); // no dissenters → no penalty
    expect(board.trendStrength).toEqual({ score: 70, label: 'strong' });
    expect(board.marketStructure.verdict).toBe('bullish');
    expect(board.executionTimeframe).toBe('5m');
    expect(board.contributors).toHaveLength(6);
    expect(board.contributors.find((c) => c.timeframe === '1d')).toEqual({ timeframe: '1d', verdict: 'bullish', score: 88, weight: 0.2 });
    expect(board.warnings).toEqual([]);
  });

  it('split stack (low cross-TF agreement, mild dissenters) → no_trade even with a directional bias', () => {
    const matrix = matrixOf(
      { '1d': 'bullish', '4h': 'bearish', '1h': 'bullish', '30m': 'bearish', '15m': 'neutral', '5m': 'bullish' },
      { '1d': 60, '4h': 40, '1h': 58, '30m': 42, '15m': 50, '5m': 56 },
    );
    const consensus = consensusOf(3, 2, 1); // agreementPct = round(3/6*100) = 50
    const weighted = weightedOf(52, 'bullish', [{ tf: '5m' as Timeframe, weight: 0.1, score: 56 }]);
    const board = computeBoardDecision(matrix, consensus, weighted, { '5m': swing(60, 100, 1) });

    // dissenters (bearish vs dominant bullish): '4h'=40, '30m'=42 → extremity (0.2+0.16)/2=0.18
    // conviction = round(50 * (1 - 0.3*0.18)) = round(50*0.946) = 47
    expect(board.conviction).toBe(47);
    expect(board.direction).toBe('no_trade');
    expect(board.bias).toBe('bullish'); // bias still reported even when direction collapses
    expect(board.warnings).toEqual([]); // dissent is mild (0.18 < strongDissentThreshold 0.5) — no warning
  });

  it('conviction accounts for dissent INTENSITY, not just vote count (mild vs extreme dissenter)', () => {
    const base = {
      '1d': 'bullish', '4h': 'bullish', '1h': 'bullish', '30m': 'bullish', '15m': 'bullish',
    } as const;
    const scores = { '1d': 70, '4h': 70, '1h': 70, '30m': 70, '15m': 70 };
    const consensus = consensusOf(5, 1, 0); // agreementPct = round(5/6*100) = 83
    const weighted = weightedOf(65, 'bullish', []);

    const mild = computeBoardDecision(
      matrixOf({ ...base, '5m': 'bearish' }, { ...scores, '5m': 44 }), // just below neutral
      consensus, weighted, {},
    );
    const strong = computeBoardDecision(
      matrixOf({ ...base, '5m': 'bearish' }, { ...scores, '5m': 10 }), // extreme
      consensus, weighted, {},
    );

    expect(mild.conviction).toBe(80);   // round(83 * (1 - 0.3 * (6/50)))
    expect(strong.conviction).toBe(63); // round(83 * (1 - 0.3 * (40/50)))
    expect(strong.conviction).toBeLessThan(mild.conviction);
    expect(mild.warnings).toEqual([]);
    expect(strong.warnings).toEqual([{
      code: 'BOARD_STRONG_DISSENT', severity: 'warning',
      message: '1 timeframe(s) strongly oppose the bullish bias — conviction reduced from 83% to 63%',
    }]);
  });

  it('neutral weighted outlook → no_trade regardless of conviction', () => {
    const matrix = matrixOf({}, {});
    const consensus = consensusOf(0, 0, 6);
    const weighted = weightedOf(50, 'neutral', []);
    const board = computeBoardDecision(matrix, consensus, weighted, {});
    expect(board.direction).toBe('no_trade');
    expect(board.trendStrength).toEqual({ score: 0, label: 'weak' });
    expect(board.warnings).toEqual([]); // neutral bias short-circuits dissent scoring entirely
  });

  it('empty inputs (no candles yet) never throw and default to a safe no_trade', () => {
    const matrix = matrixOf({}, {});
    const consensus = consensusOf(0, 0, 0);
    const weighted = weightedOf(0, 'bearish', []); // computeWeightedScore's real empty-input fallback
    expect(() => computeBoardDecision(matrix, consensus, weighted, {})).not.toThrow();
    const board = computeBoardDecision(matrix, consensus, weighted, {});
    expect(board.direction).toBe('no_trade');
    expect(board.warnings).toEqual([]);
  });

  it('contributors mirror weighted.perTf and pull verdict from the matrix', () => {
    const matrix = matrixOf({ '5m': 'bearish' }, { '5m': 30 });
    const consensus = consensusOf(0, 1, 0);
    const weighted = weightedOf(30, 'bearish', [{ tf: '5m' as Timeframe, weight: 0.1, score: 30 }]);
    const board = computeBoardDecision(matrix, consensus, weighted, { '5m': swing(60, 100, 1) });
    expect(board.contributors).toEqual([{ timeframe: '5m', verdict: 'bearish', score: 30, weight: 0.1 }]);
  });
});
