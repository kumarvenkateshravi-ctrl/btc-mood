import { describe, expect, it } from 'vitest';
import { composeNarrative } from './narrative';
import { agr, conf, hier, lcyc, prob } from './testFixtures';

const BANNED = /\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i;

const build = () => composeNarrative(
  agr({ agreement: 74 }),
  conf({ confidence: 68, state: 'high' }),
  hier({ controller: '1d', overallMarketState: 'bearish_continuation' }),
  prob({ mostLikelyOutcome: { outcome: 'continuation', probability: 0.72 } }),
  { score: 71, level: 'good', reasons: [] },
  { score: 68, grade: 'B' },
  { state: 'ready', reason: 'quality good, opportunity B, risk low' },
);

describe('composeNarrative', () => {
  it('six ordered sentences covering controller, state, scores, probability, quality, readiness', () => {
    const n = build();
    expect(n).toHaveLength(6);
    expect(n[0]).toContain('1d');
    expect(n[1]).toContain('Bearish Continuation');
    expect(n[2]).toContain('74%');
    expect(n[2]).toContain('68%');
    expect(n[3]).toContain('favors continuation (72%)');
    expect(n[4]).toContain('good');
    expect(n[4]).toContain('B');
    expect(n[5]).toContain('ready');
  });

  it('never uses banned predictive vocabulary', () => {
    for (const sentence of build()) expect(sentence).not.toMatch(BANNED);
  });

  it('is deterministic', () => {
    expect(build()).toEqual(build());
  });
});
