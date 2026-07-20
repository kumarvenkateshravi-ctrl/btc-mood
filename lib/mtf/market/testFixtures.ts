// M8 — TEST-ONLY fixtures: neutral factories for the five frozen v1.0 result
// objects, with partial overrides. Imported exclusively by *.test.ts files in
// this folder (not part of the engine; never imported by production code).

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';

export const agr = (o?: Partial<AgreementResult>): AgreementResult => ({
  schemaVersion: 1, agreement: 50, conflict: 0, dominantBias: 'neutral', state: 'moderate',
  consensus: 'moderate_neutral', indicatorAgreement: 50, categoryAgreement: 50,
  contributors: [], signals: [], warnings: [],
  diagnostics: { bullishVotes: 0, bearishVotes: 0, neutralVotes: 0, agreementRatio: 0.5, dominantShare: 0.4, minorityShare: 0.2 },
  ...o,
});

export const conf = (o?: Partial<ConfidenceResult>): ConfidenceResult => ({
  schemaVersion: 1, confidence: 50, state: 'medium', contributors: [], signals: [], warnings: [],
  diagnostics: { indicatorConfidence: 50, categoryConfidence: 50, agreementConfidence: 50, evidence: 0, penalties: 0 },
  ...o,
});

export const hier = (o?: Partial<HierarchyResult>): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'neutral', alignment: 50, conflict: 0, controller: '1d', controllerAuthority: 60,
  overallMarketState: 'range_bound', transition: false, perTimeframe: {}, contributors: [], signals: [], warnings: [],
  ...o,
});

export const lcyc = (o?: Partial<TrendLifecycleResult>): TrendLifecycleResult => ({
  schemaVersion: 1, timeframe: '1d', stage: 'trend_establishment', direction: 'neutral',
  lifecycleStrength: 50, freshness: 50, exhaustion: 0, stageConfidence: 50, nextStageConfidence: 50,
  progression: { previous: null, current: 'trend_establishment', trajectory: 'advancing' },
  expectation: { expected: 'healthy_pullback', rationale: 'r' },
  invalidation: { invalidated: false, condition: null },
  perTimeframe: {}, signals: [], warnings: [],
  ...o,
});

export const prob = (o?: Partial<ProbabilityResult>): ProbabilityResult => ({
  schemaVersion: 1, calibration: 'prior', modelVersion: '1.0', sampleSize: 0,
  stageTransitions: [], directional: [
    { direction: 'bullish', probability: 1 / 3 }, { direction: 'bearish', probability: 1 / 3 }, { direction: 'sideways', probability: 1 / 3 },
  ],
  marketOutcomes: [{ outcome: 'continuation', probability: 0.5 }, { outcome: 'pullback', probability: 0.5 }],
  dominantTransition: { outcome: 'advance', stage: 'healthy_pullback', probability: 0.45 },
  dominantDirection: { direction: 'bullish', probability: 1 / 3 },
  mostLikelyOutcome: { outcome: 'continuation', probability: 0.5 },
  opportunity: { score: 40, grade: 'D' }, contributors: [], signals: [], warnings: [],
  ...o,
});
