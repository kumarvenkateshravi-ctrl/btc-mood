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
import type { StandardMtfCategories } from '../standardMtfContract';
import type { MarketGrade, QualityLevel, RiskLevel } from './marketTypes';

const clampScore = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
const qualityLevel = (score: number): QualityLevel =>
  score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 45 ? 'average' : score >= 25 ? 'poor' : 'dangerous';
const opportunityGrade = (score: number): MarketGrade =>
  score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
const riskLevel = (score: number): RiskLevel =>
  score < 15 ? 'very_low' : score < 30 ? 'low' : score < 50 ? 'medium' : score < 70 ? 'high' : 'extreme';

/**
 * Applies the Standard MTF category context to M8's existing market picture.
 * It is deliberately bounded and non-directional: category evidence can
 * reduce quality/opportunity and increase risk, but cannot replace hierarchy's
 * bias or Board direction. Unavailable sources are excluded rather than treated
 * as neutral or bearish votes.
 */
export function applyStandardCategoryContext(base: MarketIntelligenceResult, categories?: StandardMtfCategories): MarketIntelligenceResult {
  if (!categories) return base;
  const available = Object.values(categories).filter((category) => category.availability === 'available');
  if (!available.length) return base;
  const profile = categories.volumeProfile;
  const volatility = categories.volatility;
  const structure = categories.marketStructure;
  const trend = categories.trend;
  const confluence = categories.confluence;
  let qualityPenalty = 0;
  let opportunityPenalty = 0;
  let riskPoints = 0;
  const reasons: string[] = [];
  const penalize = (quality: number, opportunity: number, risk: number, reason: string) => {
    qualityPenalty += quality;
    opportunityPenalty += opportunity;
    riskPoints += risk;
    reasons.push(reason);
  };
  if (profile.availability === 'available' && profile.state === 'mixed_range') {
    penalize(12, 18, 10, 'mixed POC range/trap context');
  }
  if (volatility.availability === 'available' && volatility.state === 'compressed') {
    penalize(8, 16, 5, 'volatility compression without a confirmed trigger');
  }
  if (volatility.availability === 'available' && volatility.state === 'expanding') {
    penalize(3, 4, 8, 'expanding volatility context');
  }
  const directionalConflict =
    trend.availability === 'available' &&
    structure.availability === 'available' &&
    trend.verdict !== 'neutral' &&
    structure.verdict !== 'neutral' &&
    trend.verdict !== structure.verdict;
  if (directionalConflict) penalize(12, 15, 12, 'trend and SMC structure conflict');
  if (confluence.availability === 'available' && confluence.state === 'mixed') {
    penalize(5, 7, 4, 'mixed FVG confluence context');
  }
  if (!reasons.length) return base;
  const qualityScore = clampScore(base.quality.score - qualityPenalty);
  const opportunityScore = clampScore(base.opportunity.score - opportunityPenalty);
  const riskScore = clampScore(base.risk.score + riskPoints);
  const quality = { score: qualityScore, level: qualityLevel(qualityScore), reasons: [...base.quality.reasons, ...reasons] };
  const opportunity = { score: opportunityScore, grade: opportunityGrade(opportunityScore) };
  const risk = { score: riskScore, level: riskLevel(riskScore), reasons: [...base.risk.reasons, ...reasons] };
  const readiness = base.readiness.state === 'ready' && (quality.level === 'poor' || opportunity.grade === 'D' || opportunity.grade === 'F')
    ? { state: 'wait' as const, reason: 'awaiting confirmation — Phase 5 category context reduced tradeability' }
    : base.readiness;
  return { ...base, quality, opportunity, risk, readiness };
}

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

export interface MarketIntelligenceInputOptions {
  /**
   * Default callers pass a forming tail and retain the existing behaviour.
   * The official Standard MTF boundary has already selected closed bars, so it
   * opts in to avoid silently dropping one more candle.
   */
  readonly candlesAreClosed?: boolean;
  /** Standard MTF's already-composed execution-timeframe category context. */
  readonly categories?: StandardMtfCategories;
}

/** The single public entry point: candles → the entire frozen v1.0 stack → M8 synthesis. */
export function computeFullMarketIntelligence(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  options: MarketIntelligenceInputOptions = {},
): FullMarketIntelligence {
  const closedByTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, arr] of Object.entries(candlesByTf) as [Timeframe, Candle[]][]) {
    if (arr && arr.length) closedByTf[tf] = options.candlesAreClosed ? arr.slice() : closed(arr);
  }

  const snapshots = buildTimeframeSnapshots(closedByTf);
  const hierarchy = computeTimeframeHierarchy(snapshots);
  const lifecycle = computeTrendLifecycle(snapshots, hierarchy);

  const indicators = createDefaultRegistry().evaluate(closedByTf[hierarchy.controller] ?? []);
  const categories = Object.values(computeCategoryIntelligence(indicators).categories);
  const agreement = computeAgreement(indicators, categories);
  const confidence = computeConfidence(indicators, categories, agreement);
  const probability = computeProbability(lifecycle, hierarchy);

  const result = applyStandardCategoryContext(
    computeMarketIntelligence(agreement, confidence, hierarchy, lifecycle, probability),
    options.categories,
  );
  return { result, layers: { snapshots, hierarchy, lifecycle, agreement, confidence, probability } };
}
