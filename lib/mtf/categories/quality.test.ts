import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { toMap } from './shared';
import {
  evaluateQualityCategory, buildQualityConfidence, buildQualityStrength,
  type QualityCategoryDiagnostics,
} from './quality';

const ind = (id: string, diagnostics: object): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict: 'neutral', confidence: 50, strength: 50,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('evaluateQualityCategory', () => {
  it('is non-directional: score always 50', () => {
    const r = evaluateQualityCategory(toMap([
      ind('ema', { separation: 80 }), ind('adx', { trendStrength: 75 }),
      ind('supertrend', { persistence: 90 }), ind('macd', { separation: 70 }),
    ]));
    expect(r.score).toBe(50);
    expect(r.verdict).toBe('neutral');
  });

  it('strong uniform evidence → healthy + agreement', () => {
    const r = evaluateQualityCategory(toMap([
      ind('ema', { separation: 80 }), ind('adx', { trendStrength: 75 }),
      ind('supertrend', { persistence: 90 }), ind('macd', { separation: 70 }),
    ]));
    expect(r.state).toBe('healthy');
    expect(codes(r.signals).sort()).toEqual(['QUALITY_AGREEMENT', 'QUALITY_HEALTHY']);
  });

  it('low persistence + scattered evidence → choppy + mixed-evidence', () => {
    const r = evaluateQualityCategory(toMap([
      ind('ema', { separation: 10 }), ind('adx', { trendStrength: 20 }),
      ind('supertrend', { persistence: 30 }), ind('macd', { separation: 90 }),
    ]));
    expect(r.state).toBe('choppy');
    expect(codes(r.warnings).sort()).toEqual(['QUALITY_CHOPPY', 'QUALITY_MIXED_EVIDENCE']);
  });

  it('held but weak → weak', () => {
    const r = evaluateQualityCategory(toMap([
      ind('ema', { separation: 30 }), ind('adx', { trendStrength: 20 }),
      ind('supertrend', { persistence: 60 }), ind('macd', { separation: 30 }),
    ]));
    expect(r.state).toBe('weak');
    expect(codes(r.warnings)).toContain('QUALITY_WEAK');
  });

  it('no evidence → developing, confidence 50, strength 0, empty', () => {
    const r = evaluateQualityCategory(toMap([ind('ema', {}), ind('adx', {}), ind('supertrend', {}), ind('macd', {})]));
    expect(r.state).toBe('developing');
    expect(r.confidence).toBe(50);
    expect(r.strength).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('builders: exact weighted mixes', () => {
    const d: QualityCategoryDiagnostics = { separation: 80, strength: 70, persistence: 90, impulse: 60, agreement: 100 };
    // 0.30·100=30 + 0.25·70=17.5 + 0.20·80=16 + 0.15·90=13.5 + 0.10·60=6 → 83
    expect(buildQualityConfidence(d)).toBe(83);
    // 0.30·70=21 + 0.25·80=20 + 0.25·90=22.5 + 0.20·60=12 → 75.5 → 76
    expect(buildQualityStrength(d)).toBe(76);
  });
});
