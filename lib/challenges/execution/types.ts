import type {
  Brand,
  BtcQuantity,
  DecimalText,
  ExecutionPolicy,
  ExecutionScope,
  InstantMs,
  InstrumentPolicy,
  Money,
  SymbolId,
} from "../domain/types";

export type CommandId = Brand<string, "ExecutionCommandId">;
export type FactId = Brand<string, "ExecutionFactId">;
export type FillId = Brand<string, "CanonicalFillId">;
export type PositionId = Brand<string, "PositionId">;
export type LifecycleId = Brand<string, "LifecycleId">;
export type WorkingOrderId = Brand<string, "WorkingOrderId">;
export type ReservationId = Brand<string, "ReservationId">;
export type ExecutionPolicyVersion = Brand<string, "ExecutionPolicyVersion">;

export type PositionSide = "long" | "short";
export type FillSide = "buy" | "sell";
export type FillClassification = "entry" | "increase" | "exit";
export type FillReason =
  | "market"
  | "manual"
  | "stopLoss"
  | "takeProfit"
  | "trailingStop"
  | "workingLimit"
  | "workingStop";

export interface ProtectionState {
  stopLoss: DecimalText | null;
  takeProfit: DecimalText | null;
  trailingEnabled: boolean;
  trailingDistance: DecimalText | null;
  trailingBestPrice: DecimalText | null;
}

export interface PositionState {
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
}

export interface MarginState {
  used: Money;
  reserved: Money;
}

export interface ReservationState {
  reservationId: ReservationId;
  workingOrderId: WorkingOrderId;
  requiredMargin: Money;
}

export interface WorkingEntryOrder {
  orderId: WorkingOrderId;
  reservationId: ReservationId;
  side: FillSide;
  type: "limit" | "stop";
  quantity: DecimalText;
  triggerPrice: DecimalText;
  expectedFillPrice: DecimalText;
  leverage: DecimalText;
  newPositionId: PositionId;
  newLifecycleId: LifecycleId;
  protection: ProtectionInput | null;
  ocoGroupId: string | null;
}

export interface ExecutionState {
  scope: ExecutionScope;
  symbol: SymbolId;
  executionPolicyVersion: ExecutionPolicyVersion;
  instrumentPolicyVersion: string;
  position: PositionState | null;
  margin: MarginState;
  reservations: readonly ReservationState[];
  workingOrders: readonly WorkingEntryOrder[];
  lastObservedPrice: DecimalText | null;
  processedCommandIds: readonly CommandId[];
  nextFactSequence: number;
}

interface CommandBase {
  commandId: CommandId;
  scope: ExecutionScope;
  symbol: SymbolId;
  occurredAt: InstantMs;
}

export interface ProtectionInput {
  stopLoss?: string | null;
  takeProfit?: string | null;
  trailingEnabled?: boolean;
}

export interface MarketOrderCommand extends CommandBase {
  kind: "marketOrder";
  side: FillSide;
  quantity: string;
  observedPrice: string;
  leverage: string;
  availableMarginForAdmission: Money;
  reason: "market" | "manual";
  newPositionId?: PositionId;
  newLifecycleId?: LifecycleId;
  protection?: ProtectionInput;
}

export interface UpdateProtectionCommand extends CommandBase {
  kind: "updateProtection";
  update: ProtectionInput;
}

export interface ObservePriceCommand extends CommandBase {
  kind: "observePrice";
  price: string;
  transition: "gap" | "segment";
  pathIndex: number;
}

export interface PlaceWorkingEntryCommand extends CommandBase {
  kind: "placeWorkingEntry";
  orderId: WorkingOrderId;
  reservationId: ReservationId;
  side: FillSide;
  orderType: "limit" | "stop";
  quantity: string;
  triggerPrice: string;
  leverage: string;
  availableMarginForAdmission: Money;
  newPositionId: PositionId;
  newLifecycleId: LifecycleId;
  protection?: ProtectionInput;
  ocoGroupId?: string | null;
}

export interface CancelWorkingOrderCommand extends CommandBase {
  kind: "cancelWorkingOrder";
  orderId: WorkingOrderId;
  reason: "user" | "oco" | "administrative";
}

export type ExecutionCommand =
  | MarketOrderCommand
  | UpdateProtectionCommand
  | ObservePriceCommand
  | PlaceWorkingEntryCommand
  | CancelWorkingOrderCommand;

export interface CanonicalFill {
  fillId: FillId;
  positionId: PositionId;
  lifecycleId: LifecycleId;
  side: FillSide;
  classification: FillClassification;
  reason: FillReason;
  quantity: DecimalText;
  price: DecimalText;
  notional: Money;
  grossRealizedPnl: Money;
}

export interface PositionTransition {
  transition: "opened" | "increased" | "reduced" | "closed";
  positionBefore: PositionState | null;
  positionAfter: PositionState | null;
  closedQuantity: DecimalText;
  lifecycleBoundary: "none" | "opened" | "closed";
}

export interface MarginTransition {
  reason:
    | "positionOpened"
    | "positionIncreased"
    | "positionReduced"
    | "positionClosed"
    | "reservationCreated"
    | "reservationReleased";
  before: MarginState;
  after: MarginState;
  requiredMargin: Money;
  releasedMargin: Money;
}

export interface ReservationTransition {
  transition: "created" | "released";
  reservation: ReservationState;
  reason: "workingOrderPlaced" | "workingOrderFilled" | "cancelled" | "oco";
}

interface ExecutionFactBase {
  factId: FactId;
  sequence: number;
  commandId: CommandId;
  scope: ExecutionScope;
  symbol: SymbolId;
  occurredAt: InstantMs;
  executionPolicyVersion: ExecutionPolicyVersion;
}

export interface ObservationFact extends ExecutionFactBase {
  kind: "MarketObserved";
  price: DecimalText;
  transition: "gap" | "segment";
  pathIndex: number;
}

export interface FillFact extends ExecutionFactBase {
  kind: "FillCommitted";
  fill: CanonicalFill;
}

export interface CommissionFact extends ExecutionFactBase {
  kind: "CommissionAssessed";
  fillId: FillId;
  classification: "entry" | "exit";
  amount: Money;
  ledgerEffect: "debitCash";
}

export interface EntryFeeAllocationFact extends ExecutionFactBase {
  kind: "EntryFeeAllocated";
  positionId: PositionId;
  lifecycleId: LifecycleId;
  closeFillId: FillId;
  allocatedAmount: Money;
  remainingAmount: Money;
  finalAllocation: boolean;
  ledgerEffect: "none";
}

export interface PositionTransitionFact extends ExecutionFactBase {
  kind: "PositionTransitioned";
  value: PositionTransition;
}

export interface MarginTransitionFact extends ExecutionFactBase {
  kind: "MarginTransitioned";
  value: MarginTransition;
}

export interface ReservationTransitionFact extends ExecutionFactBase {
  kind: "ReservationTransitioned";
  value: ReservationTransition;
}

export interface ProtectionChangedFact extends ExecutionFactBase {
  kind: "ProtectionChanged";
  positionId: PositionId;
  before: ProtectionState;
  after: ProtectionState;
  source: "entry" | "command" | "trailingUpdate";
}

export interface WorkingOrderPlacedFact extends ExecutionFactBase {
  kind: "WorkingOrderPlaced";
  readonly order: WorkingEntryOrder;
}

export interface WorkingOrderCancelledFact extends ExecutionFactBase {
  kind: "WorkingOrderCancelled";
  orderId: WorkingOrderId;
  reason: "user" | "oco" | "administrative";
}

export type ExecutionRejectionCode =
  | "DUPLICATE_COMMAND"
  | "SCOPE_MISMATCH"
  | "INVALID_COMMAND"
  | "INVALID_PRICE"
  | "INVALID_QUANTITY"
  | "OFF_TICK"
  | "OFF_STEP"
  | "BELOW_MINIMUM_QUANTITY"
  | "BELOW_MINIMUM_NOTIONAL"
  | "LEVERAGE_EXCEEDED"
  | "LEVERAGE_MISMATCH"
  | "INSUFFICIENT_MARGIN"
  | "POSITION_REQUIRED"
  | "POSITION_ID_REQUIRED"
  | "IDENTITY_COLLISION"
  | "INVALID_PROTECTION"
  | "WORKING_ORDER_NOT_FOUND"
  | "WORKING_ENTRY_REQUIRES_FLAT";

export interface ExecutionRejection {
  code: ExecutionRejectionCode;
  commandId: CommandId;
  message: string;
  field?: string;
}

export interface RejectionFact extends ExecutionFactBase {
  kind: "CommandRejected";
  rejection: ExecutionRejection;
}

export type ExecutionFact =
  | ObservationFact
  | FillFact
  | CommissionFact
  | EntryFeeAllocationFact
  | PositionTransitionFact
  | MarginTransitionFact
  | ReservationTransitionFact
  | ProtectionChangedFact
  | WorkingOrderPlacedFact
  | WorkingOrderCancelledFact
  | RejectionFact;

export type ExecutionResult =
  | {
      ok: true;
      state: ExecutionState;
      facts: readonly ExecutionFact[];
    }
  | {
      ok: false;
      state: ExecutionState;
      facts: readonly ExecutionFact[];
      rejection: ExecutionRejection;
    };

export interface ChallengeExecutionEnvironment {
  instrumentPolicy: InstrumentPolicy;
  executionPolicy: ExecutionPolicy;
  maximumLeverage: DecimalText;
}

export interface ReplayCandleInput {
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface ReplayObservationSeed {
  commandIdPrefix: string;
  scope: ExecutionScope;
  symbol: SymbolId;
  occurredAt: InstantMs;
}

export interface QuantityAllocation {
  quantity: BtcQuantity;
  finalAllocation: boolean;
}
