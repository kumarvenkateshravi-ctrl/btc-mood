import { describe, expect, it } from 'vitest';
import type { Contributor, LayerAgreement } from './agreementTypes';
import { explain, type ExplainContext } from './explanation';

const THRESH = { highConflict: 50, oneSided: 0.8, lowDirection: 0.3 };
const layer = (dominantBias: LayerAgreement['dominantBias'], agreement = 80): LayerAgreement => ({
  agreement, conflict: 0, dominantBias,
  bull: 0, bear: 0, neutral: 0, total: 1, bullFrac: 0, bearFrac: 0, neutralFrac: 0, contributors: [],
});
const contrib = (id: string, vote: Contributor['vote'], layer: Contributor['layer'] = 'category'): Contributor =>
  ({ id, layer, vote, weight: 80 });
const ctx = (o: Partial<ExplainContext>): ExplainContext => ({
  agreement: 90, conflict: 10, dominantBias: 'bullish', state: 'strong',
  dominantShare: 0.85, minorityShare: 0.05,
  ind: layer('bullish'), cat: layer('bullish'), contributors: [], thresholds: THRESH, ...o,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('explain', () => {
  it('strong aligned bullish → consensus + aligned + one-sided, no warnings', () => {
    const r = explain(ctx({ contributors: [contrib('trend', 'bullish'), contrib('momentum', 'bullish')] }));
    expect(codes(r.signals)).toEqual(['AGR_STRONG_CONSENSUS', 'AGR_LAYERS_ALIGNED', 'AGR_ONE_SIDED']);
    expect(r.warnings).toEqual([]);
  });

  it('high conflict → AGR_HIGH_CONFLICT', () => {
    expect(codes(explain(ctx({ conflict: 60, dominantShare: 0.5, state: 'moderate' })).warnings)).toContain('AGR_HIGH_CONFLICT');
  });

  it('layer disagreement → AGR_LAYER_MISMATCH', () => {
    const r = explain(ctx({ ind: layer('bullish'), cat: layer('bearish'), dominantBias: 'bearish' }));
    expect(codes(r.warnings)).toContain('AGR_LAYER_MISMATCH');
  });

  it('dissenter id appears in the AGR_DISSENT message', () => {
    const r = explain(ctx({
      dominantBias: 'bullish',
      contributors: [contrib('trend', 'bullish'), contrib('momentum', 'bearish')],
    }));
    const dissent = r.warnings.find((w) => w.code === 'AGR_DISSENT')!;
    expect(dissent.message).toContain('momentum');
  });

  it('neutral dominance with high agreement → AGR_NEUTRAL_DOMINANCE', () => {
    const r = explain(ctx({ dominantBias: 'neutral', agreement: 82, ind: layer('neutral'), cat: layer('neutral') }));
    expect(codes(r.signals)).toContain('AGR_NEUTRAL_DOMINANCE');
  });

  it('little directional mass → AGR_LOW_DIRECTION', () => {
    const r = explain(ctx({ state: 'weak', agreement: 40, dominantShare: 0.1, minorityShare: 0.05, dominantBias: 'neutral' }));
    expect(codes(r.warnings)).toContain('AGR_LOW_DIRECTION');
  });
});
