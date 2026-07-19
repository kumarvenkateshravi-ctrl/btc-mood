// M5 — buildTimeframeSnapshots. The ONLY place M5 touches candles: runs the frozen
// M0→M4 pipeline per timeframe and distills each into a TimeframeSnapshot. Lives
// OUTSIDE the M5 core engines (orchestration, not logic). Spec §Snapshot helper.

import type { Candle, Timeframe } from '../../types';
import { createDefaultRegistry } from '../registry';
import { computeCategoryIntelligence } from '../categoryEngine';
import { computeAgreement } from '../agreement/agreementEngine';
import { computeConfidence } from '../confidence/confidenceEngine';
import type { TimeframeSnapshot } from './timeframeTypes';
import { classifyRegime } from './regime';
import { TIMEFRAME_HIERARCHY } from './config';

export function buildTimeframeSnapshots(candlesByTf: Partial<Record<Timeframe, Candle[]>>): TimeframeSnapshot[] {
  const out: TimeframeSnapshot[] = [];
  for (const tf of TIMEFRAME_HIERARCHY) {
    const candles = candlesByTf[tf];
    if (!candles) continue;
    const indicators = createDefaultRegistry().evaluate(candles);
    const categories = computeCategoryIntelligence(indicators).categories;
    const catList = Object.values(categories);
    const agreement = computeAgreement(indicators, catList);
    const confidence = computeConfidence(indicators, catList, agreement);
    const regime = classifyRegime(categories.trend, categories.volatility);

    const stEntry = indicators.find((r) => r.id === 'supertrend');
    const stDiag = stEntry?.diagnostics as { flipFreshness?: number } | undefined;
    const trendFreshness = typeof stDiag?.flipFreshness === 'number' ? stDiag.flipFreshness : 0;

    const momDiag = categories.momentum.diagnostics as { exhaustion?: number };
    const momentumExhaustion = typeof momDiag.exhaustion === 'number' ? momDiag.exhaustion : 0;

    out.push({
      timeframe: tf,
      bias: agreement.dominantBias,
      agreement: agreement.agreement,
      conflict: agreement.conflict,
      confidence: confidence.confidence,
      regime: regime.regime,
      regimeClarity: regime.clarity,
      trendFreshness,
      momentumExhaustion,
    });
  }
  return out;
}
