import { describe, it, expect } from 'vitest';
import { generateTradeSetup, type TradeSetupInput, type Side } from './tradeSetup';
import { FACTOR_WEIGHT, type Factor, type FactorKey } from './stackScoreFactors';
import type { Consensus, MarketStructure } from './multiTimeframe';
import type { Verdict } from './alignment';

const KEYS: FactorKey[] = ['trend', 'momentum', 'volume', 'structure', 'volatility', 'consensus', 'sentiment'];
function factors(score: number, v: Verdict): Factor[] {
  return KEYS.map((key) => ({ key, label: key, sub: '', score, weight: FACTOR_WEIGHT[key], rating: '', verdict: v, explanation: '', detail: '', impact: 'Medium' }));
}
const consensusOf = (bull: number): Consensus => ({ bull, bear: 6 - bull, neutral: 0, total: 6, pctBull: Math.round((bull / 6) * 100), overall: bull > 3 ? 'bullish' : 'bearish' });
const structOf = (verdict: Verdict): MarketStructure => ({ label: 'x', sublabel: 'x', verdict });

const base = (side: Side, score: number, v: Verdict): TradeSetupInput => ({
  price: 62_600, atr: 230, side, structure: structOf(v), factors: factors(score, v), qualityScore: score,
  consensus: consensusOf(v === 'bullish' ? 6 : 0), confidence: score, regimeState: 'Trending', balance: 10_000, riskPct: 1, leverage: 5,
});

describe('generateTradeSetup — long', () => {
  const s = generateTradeSetup(base('long', 92, 'bullish'));
  it('entry zone sits below price (a pullback to buy)', () => {
    expect(s.entry.upper).toBeLessThan(62_600);
    expect(s.entry.lower).toBeLessThan(s.entry.upper);
    expect(s.entry.status).toBe('Wait for Pullback');
  });
  it('stop is below entry; TP ladder rises 1R/2R/3R', () => {
    expect(s.stopLoss.price).toBeLessThan(s.entry.mid);
    expect(s.takeProfits.map((t) => t.r)).toEqual([1, 2, 3]);
    expect(s.takeProfits[0].price).toBeLessThan(s.takeProfits[1].price);
    expect(s.takeProfits[1].price).toBeLessThan(s.takeProfits[2].price);
    expect(s.takeProfits.map((t) => t.alloc)).toEqual([40, 30, 30]);
    expect(s.rr).toBe(3);
  });
  it('position size loses exactly the risk amount at the stop', () => {
    expect(s.sizing.riskAmount).toBeCloseTo(100, 6);
    expect(s.sizing.size * s.sizing.stopDistance).toBeCloseTo(s.sizing.riskAmount, 6);
    expect(s.risk.breakEvenWinRate).toBeCloseTo(0.25, 9);
  });
  it('quality bars max out at 100 and an elite score is "Elite Setup"', () => {
    expect(s.quality.bars.reduce((a, b) => a + b.max, 0)).toBe(100);
    expect(s.quality.rating).toBe('Elite Setup');
  });
  it('a clean high-quality long is READY TO EXECUTE', () => {
    expect(s.execution.verdict).toBe('READY TO EXECUTE');
    expect(s.execution.score).toBeGreaterThanOrEqual(80);
  });
  it('lifecycle: SL loses 1R, TP3 gains 3R', () => {
    expect(s.lifecycle.ifSl).toBeCloseTo(-100, 6);
    expect(s.lifecycle.ifTp3).toBeCloseTo(300, 6);
    expect(s.lifecycle.accountAfterSl).toBeCloseTo(9_900, 6);
    expect(s.lifecycle.accountAfterTp3).toBeCloseTo(10_300, 6);
  });
});

describe('generateTradeSetup — short', () => {
  const s = generateTradeSetup(base('short', 22, 'bearish'));
  it('entry zone sits above price; stop above entry; TPs fall', () => {
    expect(s.entry.lower).toBeGreaterThan(62_600);
    expect(s.stopLoss.price).toBeGreaterThan(s.entry.mid);
    expect(s.takeProfits[0].price).toBeGreaterThan(s.takeProfits[2].price);
  });
  it('a weak setup is not READY', () => {
    expect(s.execution.verdict).not.toBe('READY TO EXECUTE');
  });
});
