import { describe, expect, it } from 'vitest';
import { marketQuality } from './quality';
import { agr, conf, hier, lcyc } from './testFixtures';

describe('marketQuality', () => {
  it('weighted blend (hand-computed) with reasons for strong components', () => {
    const q = marketQuality(agr({ agreement: 70 }), conf({ confidence: 80 }), hier({ alignment: 75, conflict: 20 }), lcyc({ lifecycleStrength: 60 }));
    // .30·80 + .25·70 + .20·75 + .15·60 + .10·80 = 73.5 → 74
    expect(q.score).toBe(74);
    expect(q.level).toBe('good');
    expect(q.reasons.join(' ')).toContain('strong confidence');
    expect(q.reasons.join(' ')).toContain('low conflict');
    expect(q.reasons.join(' ')).not.toContain('lifecycle');
  });

  it('band boundaries (uniform components → score = component)', () => {
    const at = (v: number) =>
      marketQuality(agr({ agreement: v }), conf({ confidence: v }), hier({ alignment: v, conflict: 100 - v }), lcyc({ lifecycleStrength: v })).level;
    expect(at(80)).toBe('excellent');
    expect(at(65)).toBe('good');
    expect(at(45)).toBe('average');
    expect(at(30)).toBe('poor');
    expect(at(20)).toBe('dangerous');
  });

  it('weak components produce weak reasons', () => {
    const q = marketQuality(agr({ agreement: 20 }), conf({ confidence: 20 }), hier({ alignment: 20, conflict: 80 }), lcyc({ lifecycleStrength: 20 }));
    expect(q.level).toBe('dangerous');
    expect(q.reasons.join(' ')).toContain('weak confidence');
    expect(q.reasons.join(' ')).toContain('high conflict');
  });
});
