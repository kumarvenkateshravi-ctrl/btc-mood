// M3 — Agreement orchestrator. One pure, deterministic function projecting M1
// indicator results + M2 category results into an AgreementResult. Generic: it
// consumes only Voter public properties, never naming an indicator or category.
// Spec: docs/superpowers/specs/2026-07-19-m3-market-agreement-engine-design.md

import type { Verdict } from '../types';
import type { IndicatorResult } from '../intelligence';
import type { CategoryResult } from '../categoryTypes';
import { clamp } from '../indicators/shared';
import type { AgreementResult, AgreementState, ConsensusLabel } from './agreementTypes';
import { indicatorAgreement } from './indicatorAgreement';
import { categoryAgreement } from './categoryAgreement';
import { combine } from './dominance';
import { explain } from './explanation';

/** Default blend: categories are aggregated intelligence → slightly more influence. Tunable. */
export const AGREEMENT_BLEND = { indicator: 0.4, category: 0.6 };
export const AGREEMENT_THRESHOLDS = { strong: 75, moderate: 55, highConflict: 50, oneSided: 0.8, lowDirection: 0.3 };

/** Agreement quality; conflict is orthogonal and only reached when agreement is low. */
function stateOf(bullVotes: number, bearVotes: number, agreement: number, conflict: number): AgreementState {
  if (bullVotes === 0 && bearVotes === 0) return 'none';
  if (agreement >= AGREEMENT_THRESHOLDS.strong) return 'strong';
  if (agreement >= AGREEMENT_THRESHOLDS.moderate) return 'moderate';
  if (conflict >= AGREEMENT_THRESHOLDS.highConflict) return 'conflicted';
  return 'weak';
}

function consensusOf(state: AgreementState, agreement: number, dominantBias: Verdict): ConsensusLabel {
  if (state === 'none') return 'none';
  const strength = agreement >= AGREEMENT_THRESHOLDS.strong ? 'strong'
    : agreement >= AGREEMENT_THRESHOLDS.moderate ? 'moderate' : 'weak';
  return `${strength}_${dominantBias}` as ConsensusLabel;
}

export function computeAgreement(
  indicatorResults: IndicatorResult[],
  categoryResults: CategoryResult[],
  previousAgreement?: number,
): AgreementResult {
  const ind = indicatorAgreement(indicatorResults);
  const cat = categoryAgreement(categoryResults);

  // Blend weights, renormalized so an empty layer hands its weight to the other.
  let wi = ind.total > 0 ? AGREEMENT_BLEND.indicator : 0;
  let wc = cat.total > 0 ? AGREEMENT_BLEND.category : 0;
  const ws = wi + wc || 1;
  wi /= ws; wc /= ws;

  const agreement = Math.round(clamp(wi * ind.agreement + wc * cat.agreement, 0, 100));
  const conflict = Math.round(clamp(wi * ind.conflict + wc * cat.conflict, 0, 100));

  const combined = combine(ind, cat, AGREEMENT_BLEND);
  const contributors = [...ind.contributors, ...cat.contributors];

  let bullishVotes = 0, bearishVotes = 0, neutralVotes = 0;
  for (const c of contributors) {
    if (c.vote === 'bullish') bullishVotes++;
    else if (c.vote === 'bearish') bearishVotes++;
    else neutralVotes++;
  }

  const state = stateOf(bullishVotes, bearishVotes, agreement, conflict);
  const consensus = consensusOf(state, agreement, combined.dominantBias);
  const { signals, warnings } = explain({
    agreement, conflict, dominantBias: combined.dominantBias, state,
    dominantShare: combined.dominantShare, minorityShare: combined.minorityShare,
    ind, cat, contributors, thresholds: AGREEMENT_THRESHOLDS,
  });

  const result: AgreementResult = {
    schemaVersion: 1,
    agreement, conflict, dominantBias: combined.dominantBias, state, consensus,
    indicatorAgreement: ind.agreement, categoryAgreement: cat.agreement,
    contributors, signals, warnings,
    diagnostics: {
      bullishVotes, bearishVotes, neutralVotes,
      agreementRatio: agreement / 100,
      dominantShare: combined.dominantShare, minorityShare: combined.minorityShare,
    },
  };
  if (previousAgreement != null) {
    result.previousAgreement = previousAgreement;
    result.agreementDelta = agreement - previousAgreement;
  }
  return result;
}
