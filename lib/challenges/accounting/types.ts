import type {
  AccountId,
  Brand,
  ChallengeId,
  DayId,
  DecimalText,
  ExecutionScope,
  FrozenChallengeDefinition,
  InstantMs,
  Money,
  PhaseId,
  SymbolId,
} from "../domain/types";
import type {
  CanonicalFill,
  CommandId,
  ExecutionFact,
  FactId,
  FillId,
  LifecycleId,
  PositionId,
  PositionSide,
  PositionState,
  ProtectionState,
  ReservationState,
} from "../execution/types";

export type LedgerInputId = Brand<string, "ChallengeLedgerInputId">;
export type LedgerPostingId = Brand<string, "ChallengeLedgerPostingId">;
export type ExecutionCheckpointId = Brand<string, "ExecutionCheckpointId">;

export interface ReplayAccountScope {
  replaySessionId: ExecutionScope extends infer Scope
    ? Scope extends { mode: "replay"; replaySessionId: infer Id } ? Id : never
    : never;
  branchId: ExecutionScope extends infer Scope
    ? Scope extends { mode: "replay"; branchId: infer Id } ? Id : never
    : never;
  datasetHash: string;
}

export interface AccountPositionProjection {
  positionId: PositionId;
  lifecycleId: LifecycleId;
  symbol: SymbolId;
  side: PositionSide;
  quantity: DecimalText;
  entryPrice: DecimalText;
  costBasis: Money;
  entryCommissionTotal: Money;
  entryCommissionRemaining: Money;
  leverage: DecimalText;
  openedAt: InstantMs;
  protection: ProtectionState;
  currentMark: DecimalText | null;
  unrealizedPnl: Money;
  grossExposure: Money;
}

export interface CurrentDayAccounting {
  currentDayId: DayId;
  dayStartCash: Money;
  dayStartEquity: Money;
  dayUnrealizedStart: Money;
  dayRealizedGrossPnl: Money;
  dayCommissions: Money;
  dayCapitalAdjustments: Money;
  daySettledNetPnl: Money;
  dayBalanceChange: Money;
  dayUnrealizedChange: Money;
  dayEquityChange: Money;
}

export interface ClosedDayAccounting {
  dayId: DayId;
  startCash: Money;
  startEquity: Money;
  startUnrealizedPnl: Money;
  endingCash: Money;
  endingEquity: Money;
  endingUnrealizedPnl: Money;
  realizedGrossPnl: Money;
  commissions: Money;
  capitalAdjustments: Money;
  settledNetPnl: Money;
  balanceChange: Money;
  unrealizedChange: Money;
  equityChange: Money;
  closedAt: InstantMs;
}

export interface AccountFillRecord {
  factId: FactId;
  executionFactSequence: number;
  ledgerSequence: number;
  occurredAt: InstantMs;
  dayId: DayId;
  fill: CanonicalFill;
}


export type ProjectionStability = "INTERMEDIATE" | "STABLE";

export interface PendingExecutionCommand {
  commandId: CommandId;
  firstFactSequence: number;
  lastFactSequence: number;
  factIds: readonly FactId[];
  occurredAt: InstantMs;
}

export interface StableAccountCheckpoint {
  checkpointId: ExecutionCheckpointId;
  checkpointSequence: number;
  kind: "executionCommand" | "dayBoundary";
  inputId: LedgerInputId;
  commandId: CommandId | null;
  firstFactSequence: number | null;
  lastFactSequence: number | null;
  factIds: readonly FactId[];
  committedAccountRevision: number;
  committedLedgerHash: string;
  stableAccountRevision: number;
  stableLedgerHash: string;
  occurredAt: InstantMs;
}


export interface LifecycleFeeAllocation {
  positionId: PositionId;
  lifecycleId: LifecycleId;
  allocatedEntryFees: Money;
  remainingEntryFees: Money;
  finalAllocationSeen: boolean;
}

export type LedgerPostingKind =
  | "realizedGrossPnl"
  | "commissionDebit"
  | "entryFeeAllocation"
  | "marginTransition"
  | "reservationTransition"
  | "mark"
  | "dayBoundary"
  | "executionCheckpoint";

export interface LedgerPosting {
  postingId: LedgerPostingId;
  inputId: LedgerInputId;
  ledgerSequence: number;
  sourceFactId: FactId | null;
  occurredAt: InstantMs;
  dayId: DayId;
  kind: LedgerPostingKind;
  amount: Money;
  cashDelta: Money;
  positionId: PositionId | null;
  lifecycleId: LifecycleId | null;
}

export interface ChallengeAccountState {
  challengeId: ChallengeId;
  accountId: AccountId;
  phaseId: PhaseId;
  mode: ExecutionScope["mode"];
  generation: number;
  symbol: SymbolId;
  scope: ExecutionScope;
  replayScope: ReplayAccountScope | null;
  checkpointVersion: string;
  executionVersion: string;
  executionPolicyVersion: string;
  accountingVersion: string;
  instrumentPolicyVersion: string;
  definitionHash: string;

  revision: number;
  nextInputSequence: number;
  lastExecutionFactSequence: number;
  phaseStartedAt: InstantMs;
  lastOccurredAt: InstantMs;
  appliedInputIds: readonly LedgerInputId[];
  appliedFactIds: readonly FactId[];
  appliedFillIds: readonly FillId[];
  commissionedFillIds: readonly FillId[];
  allocatedCloseFillIds: readonly FillId[];
  ledgerHash: string;
  projectionStability: ProjectionStability;
  pendingExecutionCommand: PendingExecutionCommand | null;
  stableCheckpointSequence: number;
  appliedCheckpointIds: readonly ExecutionCheckpointId[];
  committedCommandIds: readonly CommandId[];
  checkpoints: readonly StableAccountCheckpoint[];
  lastStableCheckpoint: StableAccountCheckpoint | null;

  phaseStartingCash: Money;
  cashBalance: Money;
  equity: Money;
  realizedGrossPnl: Money;
  totalCommissions: Money;
  cumulativeCapitalAdjustments: Money;
  unrealizedPnl: Money;
  usedMargin: Money;
  reservedMargin: Money;
  freeMargin: Money;
  grossExposure: Money;

  position: AccountPositionProjection | null;
  fills: readonly AccountFillRecord[];
  reservations: readonly ReservationState[];
  lastMarkPrice: DecimalText | null;
  feeAllocations: readonly LifecycleFeeAllocation[];
  postings: readonly LedgerPosting[];

  day: CurrentDayAccounting;
  closedDays: readonly ClosedDayAccounting[];
}

interface LedgerInputBase {
  inputId: LedgerInputId;
  sequence: number;
  accountingVersion: string;
  definitionHash: string;
}

export interface ExecutionFactLedgerInput extends LedgerInputBase {
  kind: "executionFact";
  fact: ExecutionFact;
}

export interface ExecutionCheckpointLedgerInput extends LedgerInputBase {
  kind: "executionCheckpoint";
  checkpointId: ExecutionCheckpointId;
  scope: ExecutionScope;
  symbol: SymbolId;
  commandId: CommandId;
  firstFactSequence: number;
  lastFactSequence: number;
  factIds: readonly FactId[];
  accountRevision: number;
  ledgerHash: string;
  checkpointVersion: string;
  executionVersion: string;
  instrumentPolicyVersion: string;
  occurredAt: InstantMs;
}


export interface DayBoundaryLedgerInput extends LedgerInputBase {
  kind: "dayBoundary";
  scope: ExecutionScope;
  symbol: SymbolId;
  occurredAt: InstantMs;
  markPrice?: string;
}

export type ChallengeLedgerInput =
  | ExecutionFactLedgerInput
  | ExecutionCheckpointLedgerInput
  | DayBoundaryLedgerInput;

export interface InitializeChallengeAccountInput {
  definition: FrozenChallengeDefinition;
  phaseId: string;
  scope: ExecutionScope;
  occurredAt: InstantMs;
}

export interface RebuildChallengeAccountInput
  extends InitializeChallengeAccountInput {
  inputs: readonly ChallengeLedgerInput[];
}

export type LedgerRejectionCode =
  | "ALREADY_APPLIED"
  | "MALFORMED_INPUT"
  | "OUT_OF_ORDER"
  | "EXECUTION_FACT_OUT_OF_ORDER"
  | "TIME_REGRESSION"
  | "DAY_BOUNDARY_REQUIRED"
  | "UNFINISHED_COMMAND"
  | "CHECKPOINT_MISMATCH"
  | "COMMAND_ALREADY_COMMITTED"
  | "INVALID_DAY_BOUNDARY"
  | "BOUNDARY_MARK_REQUIRED"
  | "SCOPE_MISMATCH"
  | "SYMBOL_MISMATCH"
  | "VERSION_MISMATCH"
  | "DEFINITION_MISMATCH"
  | "PROJECTION_MISMATCH"
  | "INVARIANT_VIOLATION";

export interface LedgerRejection {
  code: LedgerRejectionCode;
  message: string;
  inputId?: LedgerInputId;
  field?: string;
}

export type LedgerApplyResult =
  | {
      status: "applied";
      state: ChallengeAccountState;
      postings: readonly LedgerPosting[];
    }
  | {
      status: "alreadyApplied";
      state: ChallengeAccountState;
      postings: readonly [];
      rejection: LedgerRejection;
    }
  | {
      status: "rejected";
      state: ChallengeAccountState;
      postings: readonly [];
      rejection: LedgerRejection;
    };

export interface RebuildChallengeAccountResult {
  state: ChallengeAccountState;
  results: readonly LedgerApplyResult[];
}

export interface AccountInvariantResult {
  ok: boolean;
  errors: readonly string[];
}

export interface VerifiedAccountingDefinition {
  definition: Readonly<FrozenChallengeDefinition>;
  accountingVersion: string;
}

export type SourcePositionState = PositionState;
