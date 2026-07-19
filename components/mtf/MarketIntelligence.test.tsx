import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgreementResult } from '@/lib/mtf/agreement/agreementTypes';
import type { ConfidenceResult } from '@/lib/mtf/confidence/confidenceTypes';
import type { CategoryResult } from '@/lib/mtf/categoryTypes';
import type { HierarchyResult, TimeframeEntry } from '@/lib/mtf/timeframe/timeframeTypes';
import type { TradeContext } from '@/lib/mtf/marketIntelligence';
import { MTFIntelligenceBoard, AgreementConfidencePanel, CategoryStrip, TradeContextCard } from './MarketIntelligence';

const entry = (timeframe: TimeframeEntry['timeframe'], authority: number, agreesWithHTF = true): TimeframeEntry => ({
  timeframe, bias: 'bullish', confidence: authority, regime: 'trending_up', regimeClarity: 60, role: 'context', authority, agreesWithHTF,
});
const hierarchy: HierarchyResult = {
  schemaVersion: 1, htfBias: 'bullish', alignment: 82, conflict: 12, controller: '4h', controllerAuthority: 86,
  overallMarketState: 'bullish_pullback', transition: false,
  perTimeframe: { '1d': entry('1d', 40), '4h': entry('4h', 86) },
  contributors: [{ timeframe: '1d', bias: 'bullish', confidence: 40, weight: 6, authority: 40 }, { timeframe: '4h', bias: 'bullish', confidence: 86, weight: 5, authority: 86 }],
  signals: [], warnings: [],
};
const agreement: AgreementResult = {
  schemaVersion: 1, agreement: 78, conflict: 12, dominantBias: 'bullish', state: 'strong', consensus: 'strong_bullish',
  indicatorAgreement: 80, categoryAgreement: 75, contributors: [], signals: [], warnings: [],
  diagnostics: { bullishVotes: 5, bearishVotes: 1, neutralVotes: 0, agreementRatio: 0.78, dominantShare: 0.7, minorityShare: 0.1 },
};
const confidence: ConfidenceResult = {
  schemaVersion: 1, confidence: 72, state: 'high', contributors: [], signals: [{ code: 'CONF_STRONG', message: 'High-confidence market state.', severity: 'strong' }], warnings: [{ code: 'CONF_HIGH_CONFLICT', message: 'Directional conflict reduces trust.', severity: 'warning' }],
  diagnostics: { indicatorConfidence: 80, categoryConfidence: 70, agreementConfidence: 68, evidence: 8, penalties: 4 },
};
const cat = (id: CategoryResult['id']): CategoryResult => ({ id, score: 60, verdict: 'bullish', confidence: 70, strength: 65, state: 'bullish' as CategoryResult['state'], contributors: [], diagnostics: {}, signals: [], warnings: [] });
const categories = ['trend', 'momentum', 'volume', 'volatility', 'quality', 'participation'].map((id) => cat(id as CategoryResult['id']));
const context: TradeContext = { overallMarketState: 'bullish_pullback', controller: '4h', executionTf: '15m', opportunity: 'Trend Pullback', action: 'Wait For Continuation', risk: 'Medium' };

describe('MarketIntelligence components render', () => {
  it('board shows state, controller, transfer, per-TF rows', () => {
    const html = renderToStaticMarkup(<MTFIntelligenceBoard hierarchy={hierarchy} />);
    expect(html).toContain('Bullish Pullback');
    expect(html).toContain('Control transferred');
  });
  it('agreement/confidence panel shows both numbers + a note', () => {
    const html = renderToStaticMarkup(<AgreementConfidencePanel agreement={agreement} confidence={confidence} timeframe="1h" />);
    expect(html).toContain('78%');
    expect(html).toContain('72%');
    expect(html).toContain('High-confidence market state.');
  });
  it('category strip lists all six categories', () => {
    const html = renderToStaticMarkup(<CategoryStrip categories={categories} />);
    for (const id of ['trend', 'momentum', 'volume', 'volatility', 'quality', 'participation']) expect(html).toContain(id);
  });
  it('trade context card shows the read-only mapping', () => {
    const html = renderToStaticMarkup(<TradeContextCard context={context} />);
    expect(html).toContain('Trend Pullback');
    expect(html).toContain('Wait For Continuation');
    expect(html).toContain('not a trade signal');
  });
});
