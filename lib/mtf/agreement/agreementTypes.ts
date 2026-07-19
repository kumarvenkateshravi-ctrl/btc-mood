// M3 — Market Agreement contract. The engine measures how much the market agrees
// with itself; it is COMPLETELY unaware of specific indicators or categories and
// consumes only generic voters. Agreement, not Confidence (M4 owns Confidence).
// Spec: docs/superpowers/specs/2026-07-19-m3-market-agreement-engine-design.md

import type { Verdict } from '../types';

/** Anything M3 can count. Both IndicatorResult and CategoryResult satisfy this. */
export interface Voter { id: string; verdict: Verdict; confidence: number; weight?: number }

export type AgreementState = 'strong' | 'moderate' | 'weak' | 'conflicted' | 'none';

/** What the UI should display (strength × direction). */
export type ConsensusLabel =
  | 'strong_bullish' | 'moderate_bullish' | 'weak_bullish'
  | 'strong_bearish' | 'moderate_bearish' | 'weak_bearish'
  | 'strong_neutral' | 'moderate_neutral' | 'weak_neutral'
  | 'none';

export type ContributorLayer = 'indicator' | 'category';

/** Enriched contributor (reserved now to avoid API churn). */
export interface Contributor {
  id: string;
  layer: ContributorLayer;
  vote: Verdict;
  /** Effective tally weight: (weight ?? 1) × confidence. */
  weight: number;
}

export interface AgreementSignal {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'strong';
  source: ContributorLayer;
}

export interface AgreementDiagnostics {
  /** Unweighted head-counts across ALL contributors (indicators + categories). */
  bullishVotes: number;
  bearishVotes: number;
  neutralVotes: number;
  /** agreement / 100. */
  agreementRatio: number;
  /** Larger directional side, fraction of the combined vote 0–1. */
  dominantShare: number;
  /** Smaller directional side, fraction of the combined vote 0–1. */
  minorityShare: number;
}

export interface AgreementResult {
  schemaVersion: 1;
  agreement: number;          // 0–100 (blended)
  conflict: number;           // 0–100, INDEPENDENT metric (not 100 − agreement)
  dominantBias: Verdict;      // from the COMBINED weighted vote
  state: AgreementState;      // agreement quality; conflict does NOT override it
  consensus: ConsensusLabel;  // strength × direction, for display
  indicatorAgreement: number;
  categoryAgreement: number;
  contributors: Contributor[];
  signals: AgreementSignal[];
  warnings: AgreementSignal[];
  diagnostics: AgreementDiagnostics;
  /** Reserved trend-tracking: set only when a previous value is supplied. */
  previousAgreement?: number;
  agreementDelta?: number;
}

/** Internal per-layer result — exported for the engine, not part of the public output. */
export interface LayerAgreement {
  agreement: number;
  conflict: number;
  dominantBias: Verdict;
  bull: number; bear: number; neutral: number; total: number; // weighted masses
  bullFrac: number; bearFrac: number; neutralFrac: number;     // normalized; total 0 → all 0
  contributors: Contributor[];
}
