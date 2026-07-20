import { describe, expect, it } from 'vitest';
import { collectEvidence } from './evidence';
import { agr, conf, hier, lcyc, prob } from './testFixtures';

describe('collectEvidence', () => {
  it('supporting rules fire with source tags and interpolated values', () => {
    const e = collectEvidence(
      agr({ agreement: 78, dominantBias: 'bullish' }),
      conf({ confidence: 70 }),
      hier({ alignment: 72, controller: '4h' }),
      lcyc({ stage: 'continuation', lifecycleStrength: 60 }),
      prob({ mostLikelyOutcome: { outcome: 'continuation', probability: 0.62 } }),
    );
    const by = (src: string) => e.supporting.filter((x) => x.source === src).map((x) => x.text).join(' | ');
    expect(by('M3')).toContain('bullish consensus (78%)');
    expect(by('M4')).toContain('high confidence (70%)');
    expect(by('M5')).toContain('4h');
    expect(by('M6')).toContain('continuation');
    expect(by('M7')).toContain('favors continuation (62%)');
    expect(e.opposing).toEqual([]);
  });

  it('opposing rules fire; each item source-tagged', () => {
    const e = collectEvidence(
      agr({ conflict: 55 }),
      conf({ confidence: 30 }),
      hier({ transition: true }),
      lcyc({ invalidation: { invalidated: true, condition: 'bias flip' }, exhaustion: 80 }),
      prob({ marketOutcomes: [{ outcome: 'continuation', probability: 0.5 }, { outcome: 'reversal', probability: 0.3 }] }),
    );
    const codes = e.opposing.map((x) => x.source);
    expect(codes).toEqual(expect.arrayContaining(['M3', 'M4', 'M5', 'M6', 'M7']));
    expect(e.opposing.map((x) => x.text).join(' | ')).toContain('bias flip');
    expect(e.opposing.map((x) => x.text).join(' | ')).toContain('exhaustion');
  });

  it('quiet neutral market → short lists', () => {
    const e = collectEvidence(agr(), conf(), hier(), lcyc(), prob());
    expect(e.supporting).toHaveLength(1); // only M7: P(continuation)=0.5 ≥ .50
    expect(e.opposing).toEqual([]);
  });
});
