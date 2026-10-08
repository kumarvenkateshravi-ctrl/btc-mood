import type {
  AccountId,
  Brand,
  ChallengeId,
  ChallengeMode,
  ChallengeStatus,
  DayId,
  DecimalText,
  ExecutionScope,
  FrozenChallengeDefinition,
  InstantMs,
  Money,
  PhaseId,
  PhaseStatus,
  RuleEnforcement,
  SymbolId,
} from "../domain/types";
import type { ExecutionCheckpointId, ChallengeAccountState } from "../accounting/types";
import type { FactId } from "../execution/types";

export type RuleDecisionId = Brand<string, "ChallengeRuleDecisionId">;
export type RuleStatus =
  | "SAFE"
  | "WARNING"
  | "DANGER"
  | "BREACHED"
  | "PASSED"
  | "NOT_APPLICABLE";
export type ChallengeHealth = "SAFE" | "WARNING" | "DANGER" | "BREACHED";

interface RuleEvaluationBase {
  ruleId: string;
  enforcement: RuleEnforcement;
  status: RuleStatus;
}

export interface LossRuleEvaluation extends RuleEvaluationBase {
  kind: "loss";
  window: "daily" | "phase";
  observedMetric: "equity";
  allowance: Money;
  floor: Money;
  observed: Money;
  headroom: Money;
  consumedAmount: Money;
  consumptionRatio: DecimalText;
}

export interface ProfitTargetRuleEvaluation extends RuleEvaluationBase {
  kind: "profitTarget";
  observedMetric: "cash";
  targetAmount: Money;
  requiredCash: Money;
  currentCash: Money;
  remaining: Money;
  reached: boolean;
  progress: DecimalText;
}

export interface ActiveDaysRuleEvaluation extends RuleEvaluationBase {
  kind: "activeDays";
  required: number;
  completed: number;
  remaining: number;
  dayIds: readonly DayId[];
}

export interface ProfitableDaysRuleEvaluation extends RuleEvaluationBase {
  kind: "profitableDays";
  required: number;
  completed: number;
  remaining: number;
  threshold: Money;
  dayIds: readonly DayId[];
}

export interface InactivityRuleEvaluation extends RuleEvaluationBase {
  kind: "inactivity";
  limitDays: number;
  lastQualifyingActivity: InstantMs;
  deadline: InstantMs;
  evaluatedAt: InstantMs;
  remainingDurationMs: number;
  breached: boolean;
}

export interface LeverageRuleEvaluation extends RuleEvaluationBase {
  kind: "leverage";
  configuredMaximum: DecimalText;
  enforcementPoint: "exposureAdmission";
}

export type RuleEvaluation =
  | LossRuleEvaluation
  | ProfitTargetRuleEvaluation
  | ActiveDaysRuleEvaluation
  | ProfitableDaysRuleEvaluation
  | InactivityRuleEvaluation
  | LeverageRuleEvaluation;

export interface BreachEvidence {
  evidenceId: string;
  ruleId: string;
  ruleKind: "loss" | "inactivity";
  challengeId: ChallengeId;
  accountId: AccountId;
  phaseId: PhaseId;
  checkpointId: ExecutionCheckpointId;
  accountRevision: number;
  definitionHash: string;
  occurredAt: InstantMs;
  metric: "equity" | "logicalTime";
  operator: "<=" | ">=";
  actual: Money | InstantMs;
  threshold: Money | InstantMs;
  headroom: Money | number;
  excess: Money | number;
  supportingFactIds: readonly FactId[];
}

export type RuleDecisionKind =
  | "ChallengeStarted"
  | "PhaseActivated"
  | "RuleStatusChanged"
  | "WarningRaised"
  | "DangerRaised"
  | "WarningRearmed"
  | "BreachRecorded"
  | "TargetReached"
  | "ActiveDayQualified"
  | "ProfitableDayQualified"
  | "PhasePassed"
  | "PhaseFailed"
  | "ChallengePassed"
  | "ChallengeFailed"
  | "NextPhaseEligible";

export interface RuleDecision {
  decisionId: RuleDecisionId;
  decisionSequence: number;
  kind: RuleDecisionKind;
  challengeId: ChallengeId;
  accountId: AccountId;
  phaseId: PhaseId;
  checkpointId: ExecutionCheckpointId;
  accountRevision: number;
  definitionHash: string;
  occurredAt: InstantMs;
  ruleId?: string;
  previousStatus?: RuleStatus;
  status?: RuleStatus;
  dayId?: DayId;
  evidence?: BreachEvidence;
  primaryBreachEvidenceId?: string;
  nextPhaseId?: PhaseId;
}

export interface PhaseLifecycleProjection {
  phaseId: PhaseId;
  sequence: number;
  status: PhaseStatus;
  accountId: AccountId | null;
  scope: ExecutionScope | null;
  phaseStartedAt: InstantMs | null;
  nextCheckpointSequence: number;
  lastCheckpointId: ExecutionCheckpointId | null;
  ruleEvaluations: readonly RuleEvaluation[];
  health: ChallengeHealth;
  activeDayIds: readonly DayId[];
  qualifyingFillFactIds: readonly FactId[];
  processedClosedDayIds: readonly DayId[];
  profitableDayIds: readonly DayId[];
  lastQualifyingActivityAt: InstantMs | null;
  targetReached: boolean;
  breaches: readonly BreachEvidence[];
  primaryBreach: BreachEvidence | null;
}

export interface ChallengeRuleLifecycleState {
  rulesVersion: string;
  definitionHash: string;
  challengeId: ChallengeId;
  mode: ChallengeMode;
  generation: number;
  symbol: SymbolId;
  rootScope: ExecutionScope;
  status: ChallengeStatus;
  currentPhaseId: PhaseId;
  phases: readonly PhaseLifecycleProjection[];
  processedCheckpointIds: readonly ExecutionCheckpointId[];
  decisions: readonly RuleDecision[];
  nextDecisionSequence: number;
}

export interface InitializeRuleLifecycleInput {
  definition: Readonly<FrozenChallengeDefinition>;
  initialAccount: ChallengeAccountState;
}

export type RuleEngineRejectionCode =
  | "ALREADY_EVALUATED"
  | "INTERMEDIATE_PROJECTION"
  | "NO_STABLE_CHECKPOINT"
  | "OUT_OF_ORDER"
  | "SCOPE_MISMATCH"
  | "DEFINITION_MISMATCH"
  | "VERSION_MISMATCH"
  | "UNSUPPORTED_RULE"
  | "INVALID_PROJECTION";

export interface RuleEngineRejection {
  code: RuleEngineRejectionCode;
  message: string;
  checkpointId?: ExecutionCheckpointId;
  field?: string;
}

export type RuleEngineResult =
  | {
      status: "applied";
      state: ChallengeRuleLifecycleState;
      decisions: readonly RuleDecision[];
    }
  | {
      status: "alreadyEvaluated";
      state: ChallengeRuleLifecycleState;
      decisions: readonly [];
      rejection: RuleEngineRejection;
    }
  | {
      status: "rejected";
      state: ChallengeRuleLifecycleState;
      decisions: readonly [];
      rejection: RuleEngineRejection;
    };

export interface RebuildRuleLifecycleInput extends InitializeRuleLifecycleInput {
  stableAccounts: readonly ChallengeAccountState[];
}

export interface RebuildRuleLifecycleResult {
  state: ChallengeRuleLifecycleState;
  results: readonly RuleEngineResult[];
}