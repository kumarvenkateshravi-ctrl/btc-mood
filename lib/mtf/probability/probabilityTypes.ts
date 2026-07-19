// M7 — Probability Engine contract. Estimates the probability distribution of
// future market outcomes from the interpreted stack (M6 lifecycle + M5 hierarchy)
// — deterministic, explainable, and HONEST: v1 is calibration:'prior' (model
// estimates, never measured frequencies; PROB_MODEL_PRIORS states this on every
// result). M7 never predicts price. M8 consumes only ProbabilityResult.
// Spec: docs/superpowers/specs/2026-07-19-m7-probability-engine-design.md

import type { TrendStage } from '../lifecycle/lifecycleTypes';

export type TransitionOutcome = 'advance' | 'stay' | 'regress' | 'break';
export type OutcomeDirection = 'bullish' | 'bearish' | 'sideways';
export type MarketOutcome = 'continuation' | 'pullback' | 'range' | 'reversal' | 'false_breakout' | 'expansion';
export type OpportunityGrade = 'A' | 'B' | 'C' | 'D';

export interface TransitionProbability { outcome: TransitionOutcome; stage: TrendStage; probability: number }
export interface DirectionalProbability { direction: OutcomeDirection; probability: number }
export interface OutcomeProbability { outcome: MarketOutcome; probability: number }

/** Multiplicative audit trail: final = prior × Π(factors) / Z, per layer. */
export interface ProbabilityContributor { layer: 'transition' | 'directional' | 'outcome'; outcome: string; source: string; factor: number }

export interface ProbabilitySignal { code: string; message: string; severity: 'info' | 'warning' | 'strong' }

export interface ProbabilityResult {
  schemaVersion: 1;
  calibration: 'prior' | 'empirical';   // v1: ALWAYS 'prior'
  modelVersion: string;                 // '1.0'
  sampleSize?: number;                  // reserved — populated when empirical
  confidenceInterval?: number;          // reserved — MUST stay undefined while calibration === 'prior'
  stageTransitions: TransitionProbability[];  // Σ = 1
  directional: DirectionalProbability[];      // Σ = 1
  marketOutcomes: OutcomeProbability[];       // Σ = 1 — the trader-facing layer
  dominantTransition: TransitionProbability;
  dominantDirection: DirectionalProbability;
  mostLikelyOutcome: OutcomeProbability;
  /** Distribution ACTIONABILITY (concentration × direction clarity) — NOT trade quality.
   *  expectedRR / execution quality are M9's job: they require price levels M7 cannot see. */
  opportunity: { score: number; grade: OpportunityGrade };
  contributors: ProbabilityContributor[];
  signals: ProbabilitySignal[];
  warnings: ProbabilitySignal[];
}
