import type { ChallengeHealth, BreachEvidence, RuleDecisionKind, RuleStatus } from '../rules/types';
import type { ChallengeStatus, Money } from '../domain/types';
import type { FillReason, PositionSide, ProtectionState } from '../execution/types';

export const CHALLENGE_REPORT_VERSION = 'mcs.challenge-report/1' as const;

export interface ChallengeReportSummary {
  challengeId: string; challengeType: 'oneStep' | 'twoStep'; symbol: 'BTCUSDT'; mode: 'replay';
  currentPhaseId: string; status: ChallengeStatus; health: ChallengeHealth;
  startingCash: Money; currentCash: Money; currentEquity: Money; grossPnl: Money;
  fees: Money; netPnl: Money; targetAmount: Money; targetProgress: string;
  activeDays: readonly [number, number]; profitableDays: readonly [number, number];
  replayStartedAt: number; replayEndedAt: number; timeframe: string;
}
export interface ChallengeReportPhase {
  phaseId: string; sequence: number; name: string; status: string; startedAt: number | null; endedAt: number | null;
  startCursor: number | null; endCursor: number | null; startingCash: Money; endingCash: Money | null; endingEquity: Money | null;
  grossPnl: Money; fees: Money; netPnl: Money; targetAmount: Money | null; targetReached: boolean;
  activeDays: readonly [number, number]; profitableDays: readonly [number, number];
  completedLifecycles: number; failure: BreachEvidence | null;
}
export interface ChallengeReportTrade {
  lifecycleId: string; positionId: string; phaseId: string; side: PositionSide; status: 'OPEN' | 'CLOSED';
  entryAt: number; exitAt: number | null; entryPrice: string; exitPrice: string | null;
  entryQuantity: string; closedQuantity: string; grossPnl: Money; entryFees: Money; exitFees: Money; netPnl: Money;
  durationMs: number; exitReason: FillReason | null; protection: ProtectionState | null;
  partialClose: boolean; reversal: boolean; relatedLifecycleIds: readonly string[]; fillIds: readonly string[];
  fills: readonly { fillId: string; occurredAt: number; classification: string; price: string; quantity: string; reason: FillReason; grossPnl: Money; commission: Money }[];
  protectionHistory: readonly { occurredAt: number; before: ProtectionState; after: ProtectionState; source: string }[];
}
export interface ChallengeReportDay {
  phaseId: string; dayId: string; state: 'FINALIZED' | 'IN_PROGRESS'; active: boolean;
  grossPnl: Money; fees: Money; settledNetPnl: Money; profitableThreshold: Money; qualified: boolean;
  startingCash: Money; lowestEquity: Money; dailyFloor: Money; maximumDailyLossUsage: Money;
  endingCash: Money; endingEquity: Money; finalizedAt: number | null;
}
export interface ChallengeReportRiskEvent {
  decisionId: string; sequence: number; phaseId: string; ruleId: string | null;
  kind: RuleDecisionKind; status: RuleStatus; occurredAt: number; checkpointId: string;
  observed: Money | number | null; floor: Money | number | null; headroom: Money | number | null;
}
export interface ChallengeReportDecision {
  decisionId: string; sequence: number; phaseId: string; kind: RuleDecisionKind; occurredAt: number;
  checkpointId: string; accountRevision: number; ruleId: string | null; status: RuleStatus | null;
  primaryBreachEvidenceId: string | null;
}
export interface ChallengeFailureAnalysis {
  primaryBreach: BreachEvidence; precedingRisk: readonly ChallengeReportRiskEvent[];
  priorHeadroom: Money | number | null; relevantLifecycleId: string | null;
  checkpoint: { checkpointId: string; accountRevision: number; definitionHash: string; supportingFactIds: readonly string[] };
}
export interface ChallengePassAnalysis {
  finalCash: Money; targetAmount: Money; excess: Money; activeDays: number; profitableDays: number;
  totalFees: Money; completedLifecycles: number; phaseTimeline: readonly { phaseId: string; startedAt: number | null; endedAt: number | null }[];
}
export interface ChallengeReportBranch {
  branchId: string; generation: number; active: boolean; parentBranchId: string | null;
  forkCursor: number | null; createdAt: number; creationReason: 'attempt-created' | 'rewind';
}
export interface ChallengeReportProvenance {
  reportVersion: typeof CHALLENGE_REPORT_VERSION; definitionHash: string; datasetId: string; datasetHash: string;
  branchId: string; generation: number; attemptRevision: number; commitKey: string; checkpointId: string;
  ledgerHash: string; stateWitnessHash: string; generatedAt: number;
  versions: Readonly<Record<string, string>>; source: 'frozen-definition+journal';
}
export interface ChallengeReportReadModel {
  summary: ChallengeReportSummary; phases: readonly ChallengeReportPhase[]; trades: readonly ChallengeReportTrade[];
  days: readonly ChallengeReportDay[]; riskTimeline: readonly ChallengeReportRiskEvent[];
  decisionTimeline: readonly ChallengeReportDecision[]; failureAnalysis: ChallengeFailureAnalysis | null;
  passAnalysis: ChallengePassAnalysis | null; branch: ChallengeReportBranch; provenance: ChallengeReportProvenance;
}
