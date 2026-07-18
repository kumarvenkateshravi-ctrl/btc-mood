import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { toMap } from './shared';
import {
  evaluateMomentumCategory, buildMomentumConfidence, buildMomentumStrength,
  type MomentumCategoryDiagnostics,
} from './momentum';

const ind = (id: string, score: number, diagnostics: object): IndicatorResult => ({
  id, category: 'momentum', score, verdict: 'neutral', confidence: score, strength: score,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);
const placeholders = () => toMap([ind('rsi', 50, {}), ind('macd', 50, {}), ind('adx', 50, {})]);

describe('evaluateMomentumCategory', () => {
  it('bullish acceleration → accelerating + MOM_ACCELERATING', () => {
    const map = toMap([
      ind('rsi', 65, { position: 65, momentum: 70 }),
      ind('macd', 100, { histMomentum: 80, crossState: 100 }),
      ind('adx', 70, { adxMomentum: 75 }),
    ]);
    const r = evaluateMomentumCategory(map);
    expect(r.state).toBe('accelerating');
    expect(codes(r.signals)).toContain('MOM_ACCELERATING');
    expect(r.warnings).toEqual([]);
  });

  it('overheated RSI with opposing acceleration → overheated + divergence', () => {
    const map = toMap([
      ind('rsi', 100, { position: 100, momentum: 20 }),
      ind('macd', 100, { histMomentum: 40, crossState: 100 }),
      ind('adx', 50, { adxMomentum: 50 }),
    ]);
    const r = evaluateMomentumCategory(map);
    expect(r.state).toBe('overheated');
    const oh = r.signals.find((s) => s.code === 'MOM_OVERHEATED')!;
    expect(oh.source).toEqual(['rsi']);
    expect(codes(r.warnings)).toContain('MOM_DIVERGENCE');
  });

  it('bullish but decelerating → fading', () => {
    const map = toMap([
      ind('rsi', 70, { position: 70, momentum: 30 }),
      ind('macd', 100, { histMomentum: 30, crossState: 100 }),
      ind('adx', 50, { adxMomentum: 50 }),
    ]);
    const r = evaluateMomentumCategory(map);
    expect(r.state).toBe('fading');
    expect(codes(r.signals)).toContain('MOM_FADING');
  });

  it('no evidence → flat, confidence 50, strength 0, no signals/warnings', () => {
    const r = evaluateMomentumCategory(placeholders());
    expect(r.state).toBe('flat');
    expect(r.score).toBe(50);
    expect(r.confidence).toBe(50);
    expect(r.strength).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('builders: exact weighted mixes from diagnostics only', () => {
    const d: MomentumCategoryDiagnostics = { speed: 80, acceleration: 90, continuation: 70, exhaustion: 40, consistency: 100 };
    // 0.30·conv(80)=18 + 0.25·conv(90)=20 + 0.25·conv(70)=10 + 0.20·100=20 → 68
    expect(buildMomentumConfidence(d)).toBe(68);
    // 0.35·conv(90)=28 + 0.35·100=35 + 0.30·conv(80)=18 → 81
    expect(buildMomentumStrength(d)).toBe(81);
  });
});
