import type { ChallengeAccountState } from "../accounting/types";
import type {
  AccountId,
  BranchId,
  ChallengeId,
  ChallengeStatus,
  DecimalText,
  DayId,
  FrozenChallengeDefinition,
  InstantMs,
  Money,
  PhaseId,
  PhaseStatus,
  ReplaySessionId,
  SymbolId,
} from "../domain/types";
import type {
  ExecutionRejection,
  ExecutionState,
  FillSide,
  ProtectionInput,
  WorkingOrderId,
} from "../execution/types";
import type {
  BreachEvidence,
  ChallengeHealth,
  ChallengeRuleLifecycleState,
  InactivityRuleEvaluation,
  LossRuleEvaluation,
  ProfitTargetRuleEvaluation,
  RuleDecision,
} from "../rules/types";
import type { Candle, Timeframe } from "../../types";

export interface ChallengeReplayDataset {
  readonly datasetId: string;
  readonly datasetHash: string;
  readonly symbol: SymbolId;
  readonly executionTimeframe: Timeframe;
  readonly candles: readonly Readonly<Candle>[];
}

export interface ChallengeReplayIdentities {
  challengeId: ChallengeId;
  accountId: AccountId;
  phaseId: PhaseId;
  replaySessionId: ReplaySessionId;
  branchId: BranchId;
  generation: number;
}

export interface StartReplayChallengeInput {
  frozenDefinition: Readonly<FrozenChallengeDefinition>;
  selectedPhase: PhaseId;
  dataset: ChallengeReplayDataset;
  executionTimeframe: Timeframe;
  startingCursor: number;
  identities: ChallengeReplayIdentities;
}

export interface ChallengeReplayContext {
  replaySessionId: ReplaySessionId;
  branchId: BranchId;
  datasetHash: string;
  executionTimeframe: Timeframe;
  generation: number;
  accountId: AccountId;
  phaseId: PhaseId;
  cursor: number;
}

interface MarketIntent {
  kind: "market";
  side: FillSide;
  quantity: string;
  observedPrice: string;
  leverage: string;
  protection?: ProtectionInput;
}

export type ChallengeReplayTradingIntent =
  | MarketIntent
  | { kind: "closeFull"; observedPrice: string }
  | { kind: "closePartial"; quantity: string; observedPrice: string }
  | { kind: "updateProtection"; update: ProtectionInput }
  | {
      kind: "placeWorkingEntry";
      side: FillSide;
      orderType: "limit" | "stop";
      quantity: string;
      triggerPrice: string;
      leverage: string;
      protection?: ProtectionInput;
      ocoGroupId?: string | null;
    }
  | { kind: "cancelWorkingOrder"; orderId: WorkingOrderId };

export interface AcceptedChallengeReplayAction {
  readonly actionId: string;
  readonly cursor: number;
  readonly occurredAt: InstantMs;
  readonly intent: ChallengeReplayTradingIntent;
}

export type ChallengeReplayAvailability = "ACTIVE" | "DATASET_EXHAUSTED";

export interface ChallengeReplayPositionReadModel {
  positionId: string;
  lifecycleId: string;
  symbol: SymbolId;
  side: "long" | "short";
  quantity: DecimalText;
  entryPrice: DecimalText;
  currentMark: DecimalText | null;
  leverage: DecimalText;
  unrealizedPnl: Money;
  grossExposure: Money;
  protection: {
    stopLoss: DecimalText | null;
    takeProfit: DecimalText | null;
    trailingEnabled: boolean;
    trailingDistance: DecimalText | null;
    trailingBestPrice: DecimalText | null;
  };
}

export interface ChallengeReplayReadModel {
  identity: {
    challengeId: ChallengeId;
    challengeType: "oneStep" | "twoStep";
    currentPhaseId: PhaseId;
    mode: "replay";
    status: ChallengeStatus;
    health: ChallengeHealth;
  };
  account: {
    startingCash: Money;
    cash: Money;
    equity: Money;
    realizedGrossPnl: Money;
    commissions: Money;
    unrealizedPnl: Money;
    usedMargin: Money;
    reservedMargin: Money;
    freeMargin: Money;
  };
  progress: {
    profitTarget: Money;
    phaseNetPnl: Money;
    requiredCash: Money;
    targetProgress: DecimalText;
    targetRemaining: Money;
    targetReached: boolean;
    activeDaysCompleted: number;
    activeDaysRequired: number;
    profitableDaysCompleted: number;
    profitableDaysRequired: number;
    currentDay: {
      dayId: DayId;
      settledNetPnl: Money;
      profitableThreshold: Money;
      active: boolean;
      thresholdMet: boolean;
      finalized: false;
    };
  };
  risk: {
    dailyLoss: LossRuleEvaluation;
    maximumLoss: LossRuleEvaluation;
    inactivity: InactivityRuleEvaluation;
  };
  position: ChallengeReplayPositionReadModel | null;
  workingOrders: readonly {
    orderId: WorkingOrderId;
    side: FillSide;
    type: "limit" | "stop";
    quantity: DecimalText;
    triggerPrice: DecimalText;
    expectedFillPrice: DecimalText;
    ocoGroupId: string | null;
  }[];
  replay: {
    cursor: number;
    logicalTime: InstantMs;
    datasetId: string;
    datasetHash: string;
    executionTimeframe: Timeframe;
    replaySessionId: ReplaySessionId;
    branchId: BranchId;
    generation: number;
    availability: ChallengeReplayAvailability;
  };
  lifecycle: {
    phaseStatus: PhaseStatus;
    challengeStatus: ChallengeStatus;
    nextPhaseEligible: boolean;
    terminalBreachEvidence: BreachEvidence | null;
  };
  consistency: {
    coordinatorRevision: number;
    executionFactSequence: number;
    accountRevision: number;
    stableCheckpointSequence: number;
    stableCheckpointId: string;
    lifecycleCheckpointId: string;
  };
}

export interface ChallengeReplaySnapshot {
  readonly definition: Readonly<FrozenChallengeDefinition>;
  readonly dataset: ChallengeReplayDataset;
  readonly execution: ExecutionState;
  readonly account: ChallengeAccountState;
  readonly lifecycle: ChallengeRuleLifecycleState;
  readonly cursor: number;
  readonly logicalTime: InstantMs;
  readonly coordinatorRevision: number;
  readonly commandSequence: number;
  readonly availability: ChallengeReplayAvailability;
  readonly pendingPhaseTransition: boolean;
  readonly actions: readonly AcceptedChallengeReplayAction[];
  readonly readModel: ChallengeReplayReadModel;
}

export type ChallengeReplayStableState = Pick<
  ChallengeReplaySnapshot,
  | "execution"
  | "account"
  | "lifecycle"
  | "cursor"
  | "logicalTime"
  | "commandSequence"
  | "availability"
  | "pendingPhaseTransition"
  | "actions"
>;
export type ChallengeReplayRejectionCode =
  | "INVALID_DATASET"
  | "DATASET_HASH_MISMATCH"
  | "SYMBOL_MISMATCH"
  | "TIMEFRAME_MISMATCH"
  | "REPLAY_SESSION_MISMATCH"
  | "STALE_GENERATION"
  | "WRONG_BRANCH"
  | "WRONG_PHASE"
  | "WRONG_ACCOUNT"
  | "WRONG_CURSOR"
  | "OUT_OF_ORDER_CURSOR"
  | "TERMINAL_CHALLENGE"
  | "PHASE_TRANSITION_PENDING"
  | "EXECUTION_REJECTED"
  | "ACCOUNTING_REJECTED"
  | "RULE_ENGINE_REJECTED"
  | "NO_POSITION"
  | "DATASET_EXHAUSTED";

export interface ChallengeReplayRejection {
  code: ChallengeReplayRejectionCode;
  message: string;
  field?: string;
  executionRejection?: ExecutionRejection;
}

export type ChallengeReplayOperationResult =
  | {
      status: "applied";
      snapshot: ChallengeReplaySnapshot;
      decisions: readonly RuleDecision[];
    }
  | {
      status: "rejected";
      snapshot: ChallengeReplaySnapshot;
      decisions: readonly RuleDecision[];
      rejection: ChallengeReplayRejection;
    };

export interface ChallengeReplayJournal {
  readonly definition: Readonly<FrozenChallengeDefinition>;
  readonly dataset: ChallengeReplayDataset;
  readonly executionTimeframe: Timeframe;
  readonly startingCursor: number;
  readonly identities: ChallengeReplayIdentities;
  readonly actions: readonly AcceptedChallengeReplayAction[];
  readonly cursor: number;
}

export interface ArchivedChallengeReplayBranch {
  readonly branchId: BranchId;
  readonly generation: number;
  readonly cursor: number;
  readonly actions: readonly AcceptedChallengeReplayAction[];
  readonly readModel: ChallengeReplayReadModel;
}

export interface ReconstructedChallengeReplay {
  readonly snapshot: ChallengeReplaySnapshot;
  readonly journal: ChallengeReplayJournal;
}

export type RequiredRuleReadModels = {
  profitTarget: ProfitTargetRuleEvaluation;
  dailyLoss: LossRuleEvaluation;
  maximumLoss: LossRuleEvaluation;
  inactivity: InactivityRuleEvaluation;
};

