// M4 — Agreement confidence pillar. Agreement ≠ directional trust: scale agreement
// by how much of the vote is DIRECTIONAL, so a strong neutral consensus collapses
// to low confidence (Decision 3). Spec §Pillars.

import type { AgreementResult } from '../agreement/agreementTypes';

/** round(agreement × directionalShare), directionalShare = dominantShare + minorityShare (0–1). */
export function agreementConfidence(agreement: AgreementResult): number {
  const directionalShare = agreement.diagnostics.dominantShare + agreement.diagnostics.minorityShare;
  return Math.round(agreement.agreement * directionalShare);
}
