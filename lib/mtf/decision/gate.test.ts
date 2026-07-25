import { describe, expect, it } from 'vitest';
import type { BoardDecision } from '../board/boardTypes';
import { boardGate } from './gate';

const board = (patch: Partial<BoardDecision> = {}): BoardDecision => ({
  schemaVersion: 1,
  direction: 'long',
  bias: 'bullish',
  conviction: 70,
  trendStrength: { score: 60, label: 'moderate' },
  marketStructure: { label: 'Bull Trend', sublabel: 'Higher Highs / Higher Lows', verdict: 'bullish' },
  executionTimeframe: '5m',
  contributors: [],
  warnings: [],
  ...patch,
});

describe('M9 board gate — direction deferred entirely to the Board (Arch v2)', () => {
  it('board direction long/short → passes, blockedBy null', () => {
    expect(boardGate(board({ direction: 'long' }))).toEqual({
      passed: true, blockedBy: null, reason: 'board direction long at 70% conviction',
    });
    expect(boardGate(board({ direction: 'short', bias: 'bearish' })).passed).toBe(true);
  });

  it('board direction no_trade + neutral bias → neutral reason', () => {
    const g = boardGate(board({ direction: 'no_trade', bias: 'neutral', conviction: 40 }));
    expect(g).toEqual({
      passed: false, blockedBy: 'board_no_trade', reason: 'board bias is neutral — no directional edge',
    });
  });

  it('board direction no_trade + directional bias but low conviction → conviction reason', () => {
    const g = boardGate(board({ direction: 'no_trade', bias: 'bullish', conviction: 40 }));
    expect(g).toEqual({
      passed: false, blockedBy: 'board_no_trade',
      reason: 'board conviction 40% is below the 55% minimum',
    });
  });
});
