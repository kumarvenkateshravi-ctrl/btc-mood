import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { CategoryResult } from '../categoryTypes';
import { createDefaultRegistry } from '../registry';
import { computeCategoryIntelligence } from '../categoryEngine';
import { computeAgreement } from '../agreement/agreementEngine';
import { computeConfidence } from './confidenceEngine';
import { explainConfidence, type ExplainConfidenceContext } from './explanation';

const cat = (id: CategoryResult['id'], confidence: number, strength = confidence): CategoryResult => ({
  id, score: 50, verdict: 'neutral', confidence, strength, state: 'ranging' as CategoryResult['state'],
  contributors: [], diagnostics: {}, signals: [], warnings: [],
});
const ctx = (o: Partial<ExplainConfidenceContext>): ExplainConfidenceContext =>
  ({ confidence: 85, raw: 85, indConf: 90, catConf: 80, agrConf: 88, completeness: 1, categories: [], penaltyContribs: [], ...o });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('explainConfidence', () => {
  it('strong state → consensus + pillar + evidence signals', () => {
    const s = codes(explainConfidence(ctx({})).signals);
    expect(s).toContain('CONF_STRONG');
    expect(s).toContain('CONF_HIGH_INDICATOR_CONFIDENCE');
    expect(s).toContain('CONF_COMPLETE_EVIDENCE');
  });

  it('penalties surface as warnings; weak pillar names the layer', () => {
    const w = explainConfidence(ctx({
      penaltyContribs: [
        { id: 'conflict', layer: 'agreement', kind: 'penalty', contribution: -9 },
        { id: 'weak_pillar:category', layer: 'category', kind: 'penalty', contribution: -14 },
        { id: 'low_quality', layer: 'category', kind: 'penalty', contribution: -7 },
      ],
    })).warnings;
    expect(codes(w)).toEqual(expect.arrayContaining(['CONF_HIGH_CONFLICT', 'CONF_WEAK_PILLAR', 'CONF_LOW_QUALITY']));
    expect(w.find((x) => x.code === 'CONF_WEAK_PILLAR')!.message).toContain('category');
  });

  it('sub-threshold category → CONF_WEAK_CATEGORY naming the id', () => {
    const w = explainConfidence(ctx({ categories: [cat('trend', 50)] })).warnings; // min 60
    expect(w.find((x) => x.code === 'CONF_WEAK_CATEGORY')!.message).toContain('trend');
  });

  it('insufficient evidence + clamp signals', () => {
    expect(codes(explainConfidence(ctx({ completeness: 0.3 })).warnings)).toContain('CONF_INSUFFICIENT_EVIDENCE');
    expect(codes(explainConfidence(ctx({ raw: 112 })).warnings)).toContain('CONF_CLAMPED_HIGH');
    expect(codes(explainConfidence(ctx({ raw: -5 })).warnings)).toContain('CONF_CLAMPED_LOW');
  });
});

describe('confidence — real M1→M2→M3→M4 pipeline', () => {
  const series = (n: number, base: number, step: number): Candle[] =>
    Array.from({ length: n }, (_, i) => {
      const close = base + i * step;
      const o = close - step;
      return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
    });
  const build = (c: Candle[]) => {
    const indicators = createDefaultRegistry().evaluate(c);
    const categories = Object.values(computeCategoryIntelligence(indicators).categories);
    const agreement = computeAgreement(indicators, categories);
    return computeConfidence(indicators, categories, agreement);
  };

  it('audit identity + traceability + well-formed', () => {
    const r = build(series(260, 100, 0.5));
    const raw = r.contributors.reduce((s, c) => s + c.contribution, 0);
    expect(r.confidence).toBe(Math.max(0, Math.min(100, raw))); // clamp(raw) === confidence
    expect(r.schemaVersion).toBe(1);
    expect(['very_high', 'high', 'medium', 'low', 'very_low']).toContain(r.state);
    for (const w of r.warnings.filter((x) => x.code === 'CONF_WEAK_PILLAR'))
      expect(['indicator', 'category', 'agreement'].some((l) => w.message.includes(l))).toBe(true);
  });

  it('is deterministic end-to-end', () => {
    const c = series(120, 200, -0.5);
    expect(build(c)).toEqual(build(c));
  });
});
