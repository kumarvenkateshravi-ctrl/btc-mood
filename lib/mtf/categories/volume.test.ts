import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { toMap } from './shared';
import {
  evaluateVolumeCategory, buildVolumeConfidence, buildVolumeStrength,
  type VolumeCategoryDiagnostics,
} from './volume';

const ind = (id: string, score: number, diagnostics: object): IndicatorResult => ({
  id, category: 'volume', score, verdict: 'neutral', confidence: score, strength: score,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('evaluateVolumeCategory', () => {
  it('strong buying + surge', () => {
    const map = toMap([
      ind('volume', 80, { pressure: 80, surge: 75, trend: 70 }),
      ind('obv', 100, { trend: 100, consistency: 90 }),
    ]);
    const r = evaluateVolumeCategory(map);
    expect(r.score).toBe(90);
    expect(r.state).toBe('buying_pressure');
    expect(codes(r.signals)).toContain('BUYING_PRESSURE');
    const surge = r.signals.find((s) => s.code === 'VOLUME_SURGE')!;
    expect(surge.source).toEqual(['volume']);
    expect(r.warnings).toEqual([]);
  });

  it('unconfirmed + quiet + choppy', () => {
    const map = toMap([
      ind('volume', 80, { pressure: 80, surge: 40, trend: 50 }),
      ind('obv', 0, { trend: 0, consistency: 20 }),
    ]);
    const r = evaluateVolumeCategory(map);
    expect(r.state).toBe('quiet');
    expect(codes(r.signals)).toContain('LOW_PARTICIPATION');
    expect(codes(r.warnings).sort()).toEqual(['VOLUME_CHOPPY', 'VOLUME_UNCONFIRMED']);
  });

  it('no evidence → balanced, confidence 50, strength 0, empty', () => {
    const r = evaluateVolumeCategory(toMap([ind('volume', 50, {}), ind('obv', 50, {})]));
    expect(r.state).toBe('balanced');
    expect(r.score).toBe(50);
    expect(r.confidence).toBe(50);
    expect(r.strength).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('builders: exact weighted mixes', () => {
    const d: VolumeCategoryDiagnostics = { pressure: 80, confirmation: 100, participation: 60, surge: 70, consistency: 90 };
    // 0.30·conv(80)=18 + 0.30·conv(100)=30 + 0.20·60=12 + 0.20·90=18 → 78
    expect(buildVolumeConfidence(d)).toBe(78);
    // 0.40·60=24 + 0.30·90=27 + 0.30·70=21 → 72
    expect(buildVolumeStrength(d)).toBe(72);
  });
});
