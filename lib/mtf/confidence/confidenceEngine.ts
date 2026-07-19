// M4 — Confidence orchestrator. One pure function: pillars → weighted base →
// orthogonal evidence + penalties → clamp → state. The final number is literally
// the sum of its signed contributions (audit identity). Signals/warnings are
// populated by explanation.ts. Spec §Orchestrator.

import type { IndicatorResult } from '../intelligence';
import type { CategoryResult } from '../categoryTypes';
import type { AgreementResult } from '../agreement/agreementTypes';
import { clamp } from '../indicators/shared';
import type { ConfidenceContributor, ConfidenceResult, ConfidenceState } from './confidenceTypes';
import { CONFIDENCE_THRESHOLDS, CONFIDENCE_WEIGHTS } from './config';
import { indicatorConfidence } from './indicatorConfidence';
import { categoryConfidence } from './categoryConfidence';
import { agreementConfidence } from './agreementConfidence';
import { computeEvidence } from './evidence';
import { computePenalties } from './penalties';
import { explainConfidence } from './explanation';

function stateOf(confidence: number): ConfidenceState {
  const T = CONFIDENCE_THRESHOLDS;
  if (confidence >= T.veryHigh) return 'very_high';
  if (confidence >= T.high) return 'high';
  if (confidence >= T.medium) return 'medium';
  if (confidence >= T.low) return 'low';
  return 'very_low';
}

export function computeConfidence(
  indicatorResults: IndicatorResult[],
  categoryResults: CategoryResult[],
  agreementResult: AgreementResult,
  previousConfidence?: number,
): ConfidenceResult {
  const indConf = indicatorConfidence(indicatorResults);
  const catConf = categoryConfidence(categoryResults);
  const agrConf = agreementConfidence(agreementResult);
  const W = CONFIDENCE_WEIGHTS;

  const baseContribs: ConfidenceContributor[] = [
    { id: 'indicator', layer: 'indicator', kind: 'base', contribution: Math.round(W.indicator * indConf) },
    { id: 'category', layer: 'category', kind: 'base', contribution: Math.round(W.category * catConf) },
    { id: 'agreement', layer: 'agreement', kind: 'base', contribution: Math.round(W.agreement * agrConf) },
  ];
  const base = baseContribs.reduce((s, c) => s + c.contribution, 0);

  const { contributors: evidenceContribs, completeness } = computeEvidence(indicatorResults, categoryResults);
  const penaltyContribs = computePenalties({ agreement: agreementResult, categories: categoryResults, base, indConf, catConf, agrConf });

  const contributors = [...baseContribs, ...evidenceContribs, ...penaltyContribs];
  const raw = contributors.reduce((s, c) => s + c.contribution, 0);
  const confidence = clamp(Math.round(raw), 0, 100);

  const diagnostics = {
    indicatorConfidence: indConf,
    categoryConfidence: catConf,
    agreementConfidence: agrConf,
    evidence: evidenceContribs.reduce((s, c) => s + c.contribution, 0),
    penalties: penaltyContribs.reduce((s, c) => s + Math.abs(c.contribution), 0),
  };

  const { signals, warnings } = explainConfidence({
    confidence, raw, indConf, catConf, agrConf, completeness,
    categories: categoryResults, penaltyContribs,
  });

  const result: ConfidenceResult = {
    schemaVersion: 1, confidence, state: stateOf(confidence),
    contributors, signals, warnings, diagnostics,
  };
  if (previousConfidence != null) {
    result.previousConfidence = previousConfidence;
    result.confidenceDelta = confidence - previousConfidence;
  }
  return result;
}
