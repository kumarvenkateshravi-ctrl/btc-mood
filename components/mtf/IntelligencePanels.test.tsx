import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeMarketIntelligence } from '@/lib/mtf/market/marketEngine';
import { agr, conf, hier, lcyc, prob } from '@/lib/mtf/market/testFixtures';
import {
  MarketIntelligenceVerdict, TrendLifecyclePanel, ProbabilityPanel, NarrativeEvidencePanel,
} from './MarketIntelligence';

const hierarchy = hier({
  htfBias: 'bullish', overallMarketState: 'bullish_continuation', controller: '4h', alignment: 72, conflict: 15,
  perTimeframe: { '4h': { timeframe: '4h', bias: 'bullish', confidence: 70, regime: 'trending_up', regimeClarity: 60, role: 'context', authority: 70, agreesWithHTF: true } },
});
const lifecycle = lcyc({ stage: 'continuation', direction: 'bullish', lifecycleStrength: 60, freshness: 55, exhaustion: 20 });
const probability = prob();
const result = computeMarketIntelligence(
  agr({ agreement: 74, dominantBias: 'bullish' }), conf({ confidence: 68 }), hierarchy, lifecycle, probability,
);

describe('Phase 1b intelligence panels render', () => {
  it('verdict shows headline, readiness, four verdicts, and the priors badge', () => {
    const html = renderToStaticMarkup(<MarketIntelligenceVerdict result={result} />);
    expect(html).toContain('Bullish Continuation');
    expect(html).toContain('4H controls');
    expect(html).toContain(result.readiness.state.replace('_', ' '));
    expect(html).toContain(result.quality.level);
    expect(html).toContain(result.opportunity.grade);
    expect(html).toContain('model priors');
  });

  it('lifecycle panel shows stage, trajectory, expected next, and the three bars', () => {
    const html = renderToStaticMarkup(<TrendLifecyclePanel lifecycle={lifecycle} />);
    expect(html).toContain('Continuation');
    expect(html).toContain('advancing');
    expect(html).toContain('Healthy Pullback');
    expect(html).toContain('Exhaustion');
  });

  it('probability panel shows outcome bars, directional row, and the priors note', () => {
    const html = renderToStaticMarkup(<ProbabilityPanel probability={probability} />);
    expect(html).toContain('Continuation');
    expect(html).toContain('50%');
    expect(html).toContain('Sideways');
    expect(html).toContain('model priors, not measured frequencies');
  });

  it('narrative/evidence panel shows the summary sentences and source-tagged evidence', () => {
    const html = renderToStaticMarkup(<NarrativeEvidencePanel result={result} />);
    expect(html).toContain('remains in control of the market structure');
    expect(html).toContain('[M3]');
    expect(html).toContain('Supporting');
    expect(html).toContain('Opposing');
  });
});
