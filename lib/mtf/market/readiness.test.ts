import { describe, expect, it } from 'vitest';
import { tradeReadiness } from './readiness';
import { hier, prob } from './testFixtures';

const q = (level: Parameters<typeof tradeReadiness>[0]['level']) => ({ score: 50, level, reasons: [] });
const o = (grade: Parameters<typeof tradeReadiness>[1]['grade']) => ({ score: 70, grade });
const r = (level: Parameters<typeof tradeReadiness>[2]['level']) => ({ score: 20, level, reasons: [] });
const bull = prob({ dominantDirection: { direction: 'bullish', probability: 0.6 } });
const side = prob({ dominantDirection: { direction: 'sideways', probability: 0.5 } });

describe('tradeReadiness (environment gate — never a trade decision)', () => {
  it('avoid: high/extreme risk, dangerous quality, or reversal risk', () => {
    expect(tradeReadiness(q('good'), o('A'), r('high'), hier(), bull).state).toBe('avoid');
    expect(tradeReadiness(q('dangerous'), o('A'), r('low'), hier(), bull).state).toBe('avoid');
    expect(tradeReadiness(q('good'), o('A'), r('low'), hier({ overallMarketState: 'reversal_risk' }), bull).state).toBe('avoid');
  });

  it('no_trade: poor quality or sideways dominance', () => {
    expect(tradeReadiness(q('poor'), o('A'), r('low'), hier(), bull).state).toBe('no_trade');
    expect(tradeReadiness(q('good'), o('A'), r('low'), hier(), side).state).toBe('no_trade');
  });

  it('ready: quality ≥ good ∧ grade ≥ B ∧ risk ≤ medium', () => {
    expect(tradeReadiness(q('good'), o('B'), r('medium'), hier(), bull).state).toBe('ready');
    expect(tradeReadiness(q('excellent'), o('A+'), r('very_low'), hier(), bull).state).toBe('ready');
  });

  it('wait: fallback when thresholds are not met', () => {
    expect(tradeReadiness(q('average'), o('A'), r('low'), hier(), bull).state).toBe('wait');   // quality below good
    expect(tradeReadiness(q('good'), o('C'), r('low'), hier(), bull).state).toBe('wait');      // grade below B
  });

  it('precedence: avoid beats ready when both would match', () => {
    const res = tradeReadiness(q('excellent'), o('A+'), r('extreme'), hier(), bull);
    expect(res.state).toBe('avoid');
    expect(res.reason.length).toBeGreaterThan(0);
  });
});
