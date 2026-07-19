// M4 — Market Confidence contract. Confidence is TRUST, not agreement: it measures
// whether the current market state is worth acting on. Consumes M1/M2/M3 outputs
// only; every point of confidence is a signed, auditable contribution.
// Spec: docs/superpowers/specs/2026-07-19-m4-market-confidence-engine-design.md

export type ConfidenceState = 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
export type ContributionKind = 'base' | 'evidence' | 'penalty';
export type ConfidenceLayer = 'indicator' | 'category' | 'agreement';

export interface ConfidenceSignal {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'strong';
}

/** Signed, auditable contribution. Penalty amounts are negative; Σ contribution = raw. */
export interface ConfidenceContributor {
  id: string;
  layer: ConfidenceLayer;
  kind: ContributionKind;
  contribution: number;
}

export interface ConfidenceResult {
  schemaVersion: 1;
  confidence: number;   // 0–100 (clamped)
  state: ConfidenceState;
  contributors: ConfidenceContributor[];
  signals: ConfidenceSignal[];
  warnings: ConfidenceSignal[];
  diagnostics: {
    indicatorConfidence: number;   // pillar values (pre-weight)
    categoryConfidence: number;
    agreementConfidence: number;
    evidence: number;              // Σ evidence contributions (≥ 0)
    penalties: number;             // Σ |penalty contributions| (≥ 0)
  };
  previousConfidence?: number;
  confidenceDelta?: number;
}
