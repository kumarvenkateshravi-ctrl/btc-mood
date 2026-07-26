import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { AlignmentMatrix, Verdict } from '../../alignment';
import { computeBoardDecision } from './boardEngine';

// Zigzag builder (same as lib/multiTimeframe.test.ts) — real swing shape so
// detectStructure has confirmable pivots.
const swing = (n: number, base: number, trend: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * trend + 5 * Math.sin(i * 0.6);
    return { time: i * 300, open: close, high: close + 1.5, low: close - 1.5, close, volume: 1000 };
  });

const matrixOf = (
  tfVerdict: AlignmentMatrix['tfVerdict'],
  tfScore: AlignmentMatrix['tfScore'],
): AlignmentMatrix => ({ rows: [], tfScore, tfVerdict, sub: {} });

const v = (s: number): Verdict => (s > 55 ? 'bullish' : s < 45 ? 'bearish' : 'neutral');
/** Build a full 6-TF matrix from a score-per-TF map (verdict derived). */
const full = (scores: Record<string, number>): AlignmentMatrix => {
  const tfVerdict: AlignmentMatrix['tfVerdict'] = {};
  const tfScore: AlignmentMatrix['tfScore'] = {};
  for (const [tf, s] of Object.entries(scores)) {
    tfScore[tf as keyof typeof tfScore] = s;
    tfVerdict[tf as keyof typeof tfVerdict] = v(s);
  }
  return matrixOf(tfVerdict, tfScore);
};

describe('computeBoardDecision — Arch v2.1 execution-primary weighting', () => {
  it('KEY FIX: execution cluster (5m/15m/30m) up while the daily is down → LONG (old higher-TF-heavy board went neutral here)', () => {
    // boardScore = 62·.30+68·.30+60·.20+45·.10+40·.06+42·.04 = 59.58 → bullish.
    // (Old TF_WEIGHT would give 50.8 → neutral → no_trade — the bug this fixes.)
    const board = computeBoardDecision(
      full({ '5m': 62, '15m': 68, '30m': 60, '1h': 45, '4h': 40, '1d': 42 }),
      { '5m': swing(60, 100, 1) },
    );
    expect(board.bias).toBe('bullish');
    expect(board.direction).toBe('long');
    // agreement = 0.80 (5m+15m+30m) / 1.0; dissent extremity ≈ 0.153 → conviction 76.
    expect(board.conviction).toBe(76);
    expect(board.trendStrength).toEqual({ score: 19, label: 'weak' });
    expect(board.executionTimeframe).toBe('5m');
    expect(board.warnings).toEqual([]);
  });

  it("mixed execution cluster (only the 15m leans, 5m & 30m flat) → no_trade, honestly (mirrors today's live chop)", () => {
    // boardScore = 49·.30+73·.30+45·.20+64·.10+32·.06+41·.04 = 55.56 → bullish bias,
    // but agreement only 0.40 (15m+1h) → conviction 37 < 55 → no_trade.
    const board = computeBoardDecision(
      full({ '5m': 49, '15m': 73, '30m': 45, '1h': 64, '4h': 32, '1d': 41 }),
      { '5m': swing(60, 100, 1) },
    );
    expect(board.bias).toBe('bullish');
    expect(board.conviction).toBe(37);
    expect(board.direction).toBe('no_trade');
  });

  it('higher TFs are CONTEXT, not a veto: an aligned execution cluster still fires despite extreme daily opposition', () => {
    // 5m/15m/30m strong bull; 1h/4h/1d extreme bear. boardScore 63.92 → bullish.
    // agreement 0.80; dissent extremity ≈ 0.647 → conviction 64 (downgraded, not vetoed).
    const board = computeBoardDecision(
      full({ '5m': 75, '15m': 78, '30m': 72, '1h': 20, '4h': 15, '1d': 18 }),
      { '5m': swing(60, 100, 1) },
    );
    expect(board.direction).toBe('long');
    expect(board.conviction).toBe(64);
    expect(board.warnings).toEqual([{
      code: 'BOARD_STRONG_DISSENT', severity: 'warning',
      message: '3 higher/opposing timeframe(s) push against the bullish execution bias — conviction reduced from 80% to 64%',
    }]);
  });

  it('genuinely flat tape (all TFs neutral) → no_trade, weak strength, no warning', () => {
    const board = computeBoardDecision(
      full({ '5m': 50, '15m': 50, '30m': 50, '1h': 50, '4h': 50, '1d': 50 }),
      { '5m': swing(60, 100, 1) },
    );
    expect(board.bias).toBe('neutral');
    expect(board.direction).toBe('no_trade');
    expect(board.trendStrength).toEqual({ score: 0, label: 'weak' });
    expect(board.warnings).toEqual([]);
  });

  it('empty inputs (no candles yet) never throw and default to a safe no_trade', () => {
    expect(() => computeBoardDecision(matrixOf({}, {}), {})).not.toThrow();
    const board = computeBoardDecision(matrixOf({}, {}), {});
    expect(board.direction).toBe('no_trade');
    expect(board.contributors).toEqual([]);
    expect(board.warnings).toEqual([]);
  });

  it('contributors list present TFs only, carrying their BOARD weight (not the global TF_WEIGHT)', () => {
    const board = computeBoardDecision(matrixOf({ '5m': 'bearish' }, { '5m': 30 }), { '5m': swing(60, 300, -1) });
    expect(board.contributors).toEqual([{ timeframe: '5m', verdict: 'bearish', score: 30, weight: 0.30 }]);
    expect(board.marketStructure.verdict).toBe('bearish');
    expect(board.direction).toBe('short');
  });
});
