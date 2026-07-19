import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { IndicatorResult } from '../intelligence';
import type { CategoryResult } from '../categoryTypes';
import { createDefaultRegistry } from '../registry';
import { computeCategoryIntelligence } from '../categoryEngine';
import { computeAgreement } from './agreementEngine';

const ind = (id: string, verdict: IndicatorResult['verdict'], confidence: number, weight = 1): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict, confidence, strength: confidence,
  display: '—', diagnostics: {}, signals: [], warnings: [], weight,
});
const cat = (id: CategoryResult['id'], verdict: CategoryResult['verdict'], confidence: number): CategoryResult => ({
  id, score: 50, verdict, confidence, strength: confidence, state: 'ranging' as CategoryResult['state'],
  contributors: [], diagnostics: {}, signals: [], warnings: [],
});
const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('computeAgreement — controlled values', () => {
  const indicators = [ind('ema', 'bullish', 80), ind('rsi', 'bullish', 80), ind('macd', 'bearish', 40)];
  const categories = [cat('trend', 'bullish', 90), cat('momentum', 'bullish', 90), cat('volume', 'neutral', 60)];
  const r = computeAgreement(indicators, categories);

  it('blends the two layers (0.4 / 0.6)', () => {
    expect(r.indicatorAgreement).toBe(80);
    expect(r.categoryAgreement).toBe(75);
    expect(r.agreement).toBe(77); // round(0.4·80 + 0.6·75)
    expect(r.conflict).toBe(16);  // round(0.4·40 + 0.6·0)
  });

  it('dominant bias from combined vote; shares reported', () => {
    expect(r.dominantBias).toBe('bullish');
    expect(r.diagnostics.dominantShare).toBe(0.77);
    expect(r.diagnostics.minorityShare).toBe(0.08);
  });

  it('state strong, consensus strong_bullish, votes counted', () => {
    expect(r.state).toBe('strong');
    expect(r.consensus).toBe('strong_bullish');
    expect(r.diagnostics).toMatchObject({ bullishVotes: 4, bearishVotes: 1, neutralVotes: 1, agreementRatio: 0.77 });
  });

  it('signals + a traceable dissent warning naming the dissenter', () => {
    expect(codes(r.signals)).toEqual(['AGR_STRONG_CONSENSUS', 'AGR_LAYERS_ALIGNED']);
    const dissent = r.warnings.find((w) => w.code === 'AGR_DISSENT')!;
    expect(dissent.message).toContain('macd');
  });
});

describe('computeAgreement — real M1→M2→M3 pipeline', () => {
  const build = (c: Candle[]) => {
    const indicators = createDefaultRegistry().evaluate(c);
    const categories = Object.values(computeCategoryIntelligence(indicators).categories);
    return { indicators, categories, r: computeAgreement(indicators, categories) };
  };

  it('well-formed result with 13 contributors', () => {
    const { r } = build(series(260, 100, 0.5));
    expect(r.schemaVersion).toBe(1);
    expect(r.agreement).toBeGreaterThanOrEqual(0);
    expect(r.agreement).toBeLessThanOrEqual(100);
    expect(r.contributors).toHaveLength(13);
    for (const s of [...r.signals, ...r.warnings]) expect(['indicator', 'category']).toContain(s.source);
  });

  it('explainability: contributors cover all inputs, dissent ids are traceable', () => {
    const { indicators, categories, r } = build(series(260, 100, 0.5));
    const inputIds = [...indicators.map((x) => x.id), ...categories.map((x) => x.id)].sort();
    expect(r.contributors.map((c) => c.id).sort()).toEqual(inputIds);
    const cids = new Set(r.contributors.map((c) => c.id));
    for (const w of r.warnings.filter((x) => x.code === 'AGR_DISSENT')) {
      for (const id of w.message.split(' diverge')[0].split(', ')) expect(cids.has(id)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const c = series(120, 200, -0.5);
    expect(build(c).r).toEqual(build(c).r);
  });
});

describe('computeAgreement — edge & precedence', () => {
  it('empty candles → none / none / neutral', () => {
    const indicators = createDefaultRegistry().evaluate([]);
    const categories = Object.values(computeCategoryIntelligence(indicators).categories);
    const r = computeAgreement(indicators, categories);
    expect(r.state).toBe('none');
    expect(r.consensus).toBe('none');
    expect(r.dominantBias).toBe('neutral');
  });

  it('conflicted state is reachable (low agreement + high conflict split)', () => {
    const r = computeAgreement(
      [ind('ema', 'bullish', 80), ind('rsi', 'bearish', 78)],
      [cat('trend', 'bullish', 80), cat('momentum', 'bearish', 78)],
    );
    expect(r.agreement).toBeLessThan(55);
    expect(r.conflict).toBeGreaterThanOrEqual(50);
    expect(r.state).toBe('conflicted');
  });

  it('high agreement stays strong regardless of conflict field (orthogonal state)', () => {
    const r = computeAgreement([ind('a', 'bullish', 90)], [cat('trend', 'bullish', 90)]);
    expect(r.agreement).toBe(100);
    expect(r.state).toBe('strong');
  });

  it('previousAgreement populates delta', () => {
    const r = computeAgreement([ind('a', 'bullish', 90)], [cat('trend', 'bullish', 90)], 60);
    expect(r.previousAgreement).toBe(60);
    expect(r.agreementDelta).toBe(r.agreement - 60);
  });
});
