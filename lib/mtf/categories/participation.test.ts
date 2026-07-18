import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { toMap } from './shared';
import {
  evaluateParticipationCategory, buildParticipationConfidence, buildParticipationStrength,
  type ParticipationCategoryDiagnostics,
} from './participation';

const ind = (id: string, score: number, diagnostics: object): IndicatorResult => ({
  id, category: 'volume', score, verdict: 'neutral', confidence: score, strength: score,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('evaluateParticipationCategory', () => {
  it('committed buying → strong_buying_interest + PART_STRONG', () => {
    const map = toMap([
      ind('volume', 80, { pressure: 80, surge: 80, trend: 70 }),
      ind('obv', 100, { trend: 100, consistency: 90 }),
      ind('ema', 100, { alignment: 100 }),
    ]);
    const r = evaluateParticipationCategory(map);
    expect(r.state).toBe('strong_buying_interest');
    expect(codes(r.signals)).toContain('PART_STRONG');
    expect(r.warnings).toEqual([]);
  });

  it('flow opposes trend → PART_UNSUPPORTED_TREND (trendSupport 0)', () => {
    const map = toMap([
      ind('volume', 70, { pressure: 70, surge: 30, trend: 50 }),
      ind('obv', 100, { trend: 100, consistency: 40 }),
      ind('ema', 0, { alignment: 0 }),
    ]);
    const r = evaluateParticipationCategory(map);
    const d = r.diagnostics as ParticipationCategoryDiagnostics;
    expect(d.trendSupport).toBe(0);
    expect(codes(r.warnings)).toContain('PART_UNSUPPORTED_TREND');
  });

  it('little activity → weak_participation', () => {
    const map = toMap([
      ind('volume', 55, { pressure: 55, surge: 10, trend: 50 }),
      ind('obv', 55, { trend: 55, consistency: 10 }),
      ind('ema', 55, { alignment: 55 }),
    ]);
    const r = evaluateParticipationCategory(map);
    expect(r.state).toBe('weak_participation');
    expect(codes(r.warnings)).toContain('PART_WEAK');
  });

  it('no evidence → neutral, confidence 50, strength 0, empty', () => {
    const r = evaluateParticipationCategory(toMap([ind('volume', 50, {}), ind('obv', 50, {}), ind('ema', 50, {})]));
    expect(r.state).toBe('neutral');
    expect(r.score).toBe(50);
    expect(r.confidence).toBe(50);
    expect(r.strength).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('builders: exact weighted mixes', () => {
    const d: ParticipationCategoryDiagnostics = { interest: 80, flowAlignment: 100, activity: 70, trendSupport: 100, commitment: 60 };
    // 0.30·conv(80)=18 + 0.20·conv(100)=20 + 0.20·100=20 + 0.15·70=10.5 + 0.15·60=9 → 77.5 → 78
    expect(buildParticipationConfidence(d)).toBe(78);
    // 0.35·70=24.5 + 0.35·60=21 + 0.30·100=30 → 75.5 → 76
    expect(buildParticipationStrength(d)).toBe(76);
  });
});
