// M8 — Market Intelligence contract. The Institutional Intelligence Synthesizer:
// consumes exactly five frozen v1.0 result objects (Agreement, Confidence,
// Hierarchy, Lifecycle, Probability), never recomputes, and produces the ONE
// picture that UI/alerts/AI narration/M9 consume. Deterministic: no timestamps.
// Readiness is an ENVIRONMENT GATE, not a trade decision (M9 owns those).
// Spec: docs/superpowers/specs/2026-07-20-m8-market-intelligence-engine-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { OverallMarketState, RegimeType } from '../timeframe/timeframeTypes';
import type { TrendStage } from '../lifecycle/lifecycleTypes';
import type { MarketOutcome, OutcomeProbability } from '../probability/probabilityTypes';

export type LayerTag = 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8';
export type QualityLevel = 'excellent' | 'good' | 'average' | 'poor' | 'dangerous';
export type MarketGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'extreme';
export type ReadinessState = 'ready' | 'wait' | 'no_trade' | 'avoid';

export interface EvidenceItem { source: LayerTag; text: string }
export interface UnifiedSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; source: LayerTag }

export interface MarketIntelligenceResult {
  schemaVersion: 1;
  headline: {
    bias: Verdict;
    state: OverallMarketState;
    controller: Timeframe;
    regime: RegimeType;
    stage: TrendStage;
    mostLikelyOutcome: MarketOutcome;
    outcomeProbability: number;
    calibration: 'prior' | 'empirical';   // propagated M7 honesty flag — never hidden
  };
  quality: { score: number; level: QualityLevel; reasons: string[] };
  opportunity: { score: number; grade: MarketGrade };
  risk: { score: number; level: RiskLevel; reasons: string[] };
  /** Environment gate ONLY — no direction, entry, size, or RR (M9's job). */
  readiness: { state: ReadinessState; reason: string };
  evidence: { supporting: EvidenceItem[]; opposing: EvidenceItem[] };
  outlook: {
    expectedStage: TrendStage;
    rationale: string;
    nextStageConfidence: number;
    marketOutcomes: OutcomeProbability[];
    invalidation: { invalidated: boolean; condition: string | null };
    transition: boolean;
  };
  narrative: string[];
  signals: UnifiedSignal[];
  warnings: UnifiedSignal[];
  diagnostics: {
    schemaVersions: { agreement: number; confidence: number; hierarchy: number; lifecycle: number; probability: number };
    calibration: 'prior' | 'empirical';
    modelVersion: string;
    scores: {
      agreement: number; confidence: number; alignment: number; conflict: number;
      lifecycleStrength: number; probabilityOpportunity: number;
    };
  };
}
