import { describe, expect, it } from 'vitest';
import { marketOpportunity } from './opportunity';
import { agr, conf, lcyc, prob } from './testFixtures';

describe('marketOpportunity', () => {
  it('weighted blend (hand-computed)', () => {
    const o = marketOpportunity(
      agr({ agreement: 80 }), conf({ confidence: 70 }),
      lcyc({ lifecycleStrength: 60 }),
      prob({ mostLikelyOutcome: { outcome: 'continuation', probability: 0.6 }, opportunity: { score: 50, grade: 'C' } }),
    );
    // .30·80 + .25·70 + .25·60 + .10·60 + .10·50 = 67.5 → 68
    expect(o).toEqual({ score: 68, grade: 'B' });
  });

  it('all six grade bands (uniform components → score = component)', () => {
    const at = (v: number) => marketOpportunity(
      agr({ agreement: v }), conf({ confidence: v }), lcyc({ lifecycleStrength: v }),
      prob({ mostLikelyOutcome: { outcome: 'continuation', probability: v / 100 }, opportunity: { score: v, grade: 'C' } }),
    ).grade;
    expect(at(92)).toBe('A+');
    expect(at(85)).toBe('A');
    expect(at(70)).toBe('B');
    expect(at(55)).toBe('C');
    expect(at(40)).toBe('D');
    expect(at(20)).toBe('F');
  });
});
