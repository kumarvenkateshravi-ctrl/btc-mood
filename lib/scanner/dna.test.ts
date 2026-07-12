import { describe, it, expect } from 'vitest';
import { computeStrategyDna } from './dna';
import type { Condition, GroupNode } from './types';

const c = (source: string, tf: Condition['tf'], output = 'value'): Condition =>
  ({ left: { source, output, params: {} }, op: 'gt', right: 50, tf });
const tree = (...children: Condition[]): GroupNode => ({ logic: 'AND', children });

describe('computeStrategyDna', () => {
  it('infers scalper from a 5m signal timeframe', () => {
    const dna = computeStrategyDna({ tree: tree(c('ema', '5m'), c('volume', '5m')), direction: 'long' });
    expect(dna.style).toBe('scalper');
    expect(dna.styleInferred).toBe(true);
    expect(dna.holding).toBe('minutes');
  });

  it('infers swing from a 4h signal timeframe', () => {
    const dna = computeStrategyDna({ tree: tree(c('ema', '4h'), c('ema', '1d')), direction: 'long' });
    expect(dna.style).toBe('swing');
  });

  it('detects SMC usage and prefers the SMC style', () => {
    const dna = computeStrategyDna({
      tree: tree({ left: { source: 'smc_structure', output: 'bullBos', params: {} }, op: 'lte', right: 10, tf: '15m' }),
      direction: 'long',
    });
    expect(dna.usesSmc).toBe(true);
    expect(dna.style).toBe('smc');
  });

  it('honors a declared style over inference', () => {
    const dna = computeStrategyDna({ tree: tree(c('ema', '5m')), direction: 'short', style: 'position' });
    expect(dna.style).toBe('position');
    expect(dna.styleInferred).toBe(false);
  });

  it('ranks category emphasis by usage', () => {
    const dna = computeStrategyDna({
      tree: tree(c('ema', '15m'), c('sma', '15m'), c('rsi', '15m')),
      direction: 'long',
    });
    expect(dna.emphasis[0]).toBe('trend'); // ema + sma = 2
    expect(dna.emphasis).toContain('momentum'); // rsi
  });

  it('scales risk profile with position sizing', () => {
    const low = computeStrategyDna({ tree: tree(c('ema', '15m')), direction: 'long', risk: { breakEven: true, trailingAtr: 1, positionRiskPct: 0.5, maxDailyLossPct: 2, maxTradesPerDay: 3 } });
    const high = computeStrategyDna({ tree: tree(c('ema', '15m')), direction: 'long', risk: { breakEven: false, trailingAtr: null, positionRiskPct: 3, maxDailyLossPct: 6, maxTradesPerDay: 8 } });
    expect(low.riskProfile).toBe('low');
    expect(high.riskProfile).toBe('high');
  });

  it('grades complexity by condition count', () => {
    expect(computeStrategyDna({ tree: tree(c('ema', '15m')), direction: 'long' }).complexity).toBe('simple');
    expect(computeStrategyDna({ tree: tree(c('ema', '15m'), c('sma', '15m'), c('rsi', '15m'), c('adx', '15m'), c('atr', '15m'), c('obv', '15m')), direction: 'long' }).complexity).toBe('advanced');
  });
});
