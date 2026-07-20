// M8 — Market Intelligence orchestrator. Pure synthesis of the five frozen v1.0
// result objects into the single institutional picture (headline, quality,
// opportunity, risk, readiness, evidence, outlook, narrative, unified feed,
// diagnostics), plus computeFullMarketIntelligence — the single public entry
// point that runs the whole frozen stack from candles. Never recomputes a frozen
// layer; no timestamps (strict determinism).
// Spec: docs/superpowers/specs/2026-07-20-m8-market-intelligence-engine-design.md

import type { Candle, Timeframe } from '../../types';
import { createDefaultRegistry } from '../registry';
import { computeCategoryIntelligence } from '../categoryEngine';
import { computeAgreement } from '../agreement/agreementEngine';
import type { AgreementResult } from '../agreement/agreementTypes';
import { computeConfidence } from '../confidence/confidenceEngine';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import { buildTimeframeSnapshots } from '../timeframe/snapshots';
import { computeTimeframeHierarchy } from '../timeframe/hierarchy';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';
import { computeTrendLifecycle } from '../lifecycle/lifecycleEngine';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import { computeProbability } from '../probability/probabilityEngine';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import type { MarketIntelligenceResult, UnifiedSignal } from './marketTypes';
import { marketQuality } from './quality';
import { marketOpportunity } from './opportunity';
import { marketRisk } from './risk';
import { tradeReadiness } from './readiness';
import { collectEvidence } from './evidence';
import { composeNarrative } from './narrative';
import { unifySignals } from './unifiedSignals';

export function computeMarketIntelligence(
  agreement: AgreementResult,
  confidence: ConfidenceResult,
  hierarchy: HierarchyResult,
  lifecycle: TrendLifecycleResult,
  probability: ProbabilityResult,
): MarketIntelligenceResult {
  const quality = marketQuality(agreement, confidence, hierarchy, lifecycle);
  const opportunity = marketOpportunity(agreement, confidence, lifecycle, probability);
  const risk = marketRisk(agreement, confidence, hierarchy, lifecycle, probability);
  const readiness = tradeReadiness(quality, opportunity, risk, hierarchy, probability);
  const evidence = collectEvidence(agreement, confidence, hierarchy, lifecycle, probability);
  const narrative = composeNarrative(agreement, confidence, hierarchy, probability, quality, opportunity, readiness);

  const m8Own: UnifiedSignal[] = [{
    code: 'MI_READINESS',
    message: `Environment readiness: ${readiness.state} — ${readiness.reason}.`,
    severity: readiness.state === 'ready' ? 'strong' : 'info',
    source: 'M8',
  }];
  const { signals, warnings } = unifySignals(agreement, confidence, hierarchy, lifecycle, probability, m8Own);

  return {
    schemaVersion: 1,
    headline: {
      bias: hierarchy.htfBias,
      state: hierarchy.overallMarketState,
      controller: hierarchy.controller,
      regime: hierarchy.perTimeframe[hierarchy.controller]?.regime ?? 'ranging',
      stage: lifecycle.stage,
      mostLikelyOutcome: probability.mostLikelyOutcome.outcome,
      outcomeProbability: probability.mostLikelyOutcome.probability,
      calibration: probability.calibration,
    },
    quality, opportunity, risk, readiness, evidence,
    outlook: {
      expectedStage: lifecycle.expectation.expected,
      rationale: lifecycle.expectation.rationale,
      nextStageConfidence: lifecycle.nextStageConfidence,
      marketOutcomes: probability.marketOutcomes,
      invalidation: lifecycle.invalidation,
      transition: hierarchy.transition,
    },
    narrative, signals, warnings,
    diagnostics: {
      schemaVersions: {
        agreement: agreement.schemaVersion, confidence: confidence.schemaVersion,
        hierarchy: hierarchy.schemaVersion, lifecycle: lifecycle.schemaVersion,
        probability: probability.schemaVersion,
      },
      calibration: probability.calibration,
      modelVersion: probability.modelVersion,
      scores: {
        agreement: agreement.agreement,
        confidence: confidence.confidence,
        alignment: hierarchy.alignment,
        conflict: hierarchy.conflict,
        lifecycleStrength: lifecycle.lifecycleStrength,
        probabilityOpportunity: probability.opportunity.score,
      },
    },
  };
}

/** Drop the still-forming last bar (closed-bar determinism). */
const closed = (c: Candle[]): Candle[] => (c.length > 1 ? c.slice(0, -1) : c);

export interface FullMarketIntelligence {
  result: MarketIntelligenceResult;
  layers: {
    snapshots: TimeframeSnapshot[];
    hierarchy: HierarchyResult;
    lifecycle: TrendLifecycleResult;
    agreement: AgreementResult;
    confidence: ConfidenceResult;
    probability: ProbabilityResult;
  };
}

/** The single public entry point: candles → the entire frozen v1.0 stack → M8 synthesis. */
export function computeFullMarketIntelligence(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): FullMarketIntelligence {
  const closedByTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, arr] of Object.entries(candlesByTf) as [Timeframe, Candle[]][]) {
    if (arr && arr.length) closedByTf[tf] = closed(arr);
  }

  const snapshots = buildTimeframeSnapshots(closedByTf);
  const hierarchy = computeTimeframeHierarchy(snapshots);
  const lifecycle = computeTrendLifecycle(snapshots, hierarchy);

  const indicators = createDefaultRegistry().evaluate(closedByTf[hierarchy.controller] ?? []);
  const categories = Object.values(computeCategoryIntelligence(indicators).categories);
  const agreement = computeAgreement(indicators, categories);
  const confidence = computeConfidence(indicators, categories, agreement);
  const probability = computeProbability(lifecycle, hierarchy);

  const result = computeMarketIntelligence(agreement, confidence, hierarchy, lifecycle, probability);
  return { result, layers: { snapshots, hierarchy, lifecycle, agreement, confidence, probability } };
}
