import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { toMap } from './shared';
import {
  evaluateTrendCategory, buildTrendConfidence, buildTrendStrength,
  TREND_CONTRIBUTORS, type TrendCategoryDiagnostics,
} from './trend';

const ind = (id: string, score: number, diagnostics: object): IndicatorResult => ({
  id, category: 'trend', score, verdict: 'neutral', confidence: score, strength: score,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);
const placeholders = () => toMap([ind('ema', 50, {}), ind('supertrend', 50, {}), ind('adx', 50, {})]);

describe('evaluateTrendCategory', () => {
  it('bullish consensus → strong_bullish + TREND_STRONG', () => {
    const map = toMap([
      ind('ema', 100, { alignment: 100, separation: 80 }),
      ind('supertrend', 100, { side: 100, persistence: 90, flipFreshness: 30 }),
      ind('adx', 90, { direction: 100, trendStrength: 80 }),
    ]);
    const r = evaluateTrendCategory(map);
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('bullish');
    expect(r.state).toBe('strong_bullish');
    expect(r.contributors).toEqual(TREND_CONTRIBUTORS);
    const strong = r.signals.find((s) => s.code === 'TREND_STRONG')!;
    expect(strong.source).toEqual(['ema', 'supertrend', 'adx']);
    expect(strong.category).toBe('trend');
    expect(r.warnings).toEqual([]);
  });

  it('bearish consensus → strong_bearish', () => {
    const map = toMap([
      ind('ema', 0, { alignment: 0, separation: 80 }),
      ind('supertrend', 0, { side: 0, persistence: 90, flipFreshness: 30 }),
      ind('adx', 90, { direction: 0, trendStrength: 80 }),
    ]);
    const r = evaluateTrendCategory(map);
    expect(r.score).toBe(0);
    expect(r.state).toBe('strong_bearish');
  });

  it('fresh flip against alignment + weak/choppy → reversing signal + warnings', () => {
    const map = toMap([
      ind('ema', 65, { alignment: 65, separation: 20 }),
      ind('supertrend', 0, { side: 0, persistence: 40, flipFreshness: 80 }),
      ind('adx', 50, { direction: 50, trendStrength: 30 }),
    ]);
    const r = evaluateTrendCategory(map);
    const rev = r.signals.find((s) => s.code === 'TREND_REVERSING')!;
    expect(rev.source).toEqual(['supertrend', 'ema']);
    expect(codes(r.warnings).sort()).toEqual(['TREND_CHOPPY', 'TREND_DISAGREEMENT', 'TREND_WEAKENING']);
  });

  it('no evidence → ranging, confidence 50, strength 0, no signals/warnings', () => {
    const r = evaluateTrendCategory(placeholders());
    expect(r.state).toBe('ranging');
    expect(r.score).toBe(50);
    expect(r.confidence).toBe(50);
    expect(r.strength).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('deterministic', () => {
    const map = placeholders();
    expect(evaluateTrendCategory(map)).toEqual(evaluateTrendCategory(map));
  });

  it('builders: exact weighted mixes from diagnostics only', () => {
    const d: TrendCategoryDiagnostics = { alignment: 100, direction: 100, persistence: 80, agreement: 100, quality: 70 };
    // 0.30·conv(100)=30 + 0.25·conv(100)=25 + 0.20·100=20 + 0.15·80=12 + 0.10·70=7 → 94
    expect(buildTrendConfidence(d)).toBe(94);
    // 0.35·70=24.5 + 0.30·80=24 + 0.20·100=20 + 0.15·conv(100)=15 → 83.5 → 84
    expect(buildTrendStrength(d)).toBe(84);
  });
});
