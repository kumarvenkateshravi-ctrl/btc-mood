declare const domainBrand: unique symbol;

export type Brand<T, Name extends string> = T & {
  readonly [domainBrand]: Name;
};

export type ChallengeId = Brand<string, "ChallengeId">;
export type AccountId = Brand<string, "AccountId">;
export type PhaseId = Brand<string, "PhaseId">;
export type BranchId = Brand<string, "BranchId">;
export type EventId = Brand<string, "EventId">;
export type ReplaySessionId = Brand<string, "ReplaySessionId">;
export type InstantMs = Brand<number, "InstantMs">;
export type DayId = Brand<string, "UtcDayId">;
export type DecimalText = Brand<string, "CanonicalDecimal">;
export type Money = Brand<bigint, "UsdMicros">;
export type Ppm = Brand<bigint, "PartsPerMillion">;
export type BtcQuantity = Brand<bigint, "BtcSatoshis">;

export type SymbolId = "BTCUSDT";
export type ChallengeMode = "replay" | "live";
export type ChallengeType = "oneStep" | "twoStep";

const DOMAIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function brandedId<Name extends string>(value: string, name: Name): Brand<string, Name> {
  if (!DOMAIN_ID.test(value)) {
    throw new TypeError(`${name} must be 1-128 characters using letters, digits, '.', '_', ':', or '-'.`);
  }
  return value as Brand<string, Name>;
}

export const challengeId = (value: string): ChallengeId => brandedId(value, "ChallengeId");
export const accountId = (value: string): AccountId => brandedId(value, "AccountId");
export const phaseId = (value: string): PhaseId => brandedId(value, "PhaseId");
export const branchId = (value: string): BranchId => brandedId(value, "BranchId");
export const eventId = (value: string): EventId => brandedId(value, "EventId");
export const replaySessionId = (value: string): ReplaySessionId => brandedId(value, "ReplaySessionId");

export function instantMs(value: number): InstantMs {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("InstantMs must be a safe integer.");
  }
  return value as InstantMs;
}

export type ExecutionScope =
  | {
      mode: "live";
      accountId: AccountId;
      challengeId: ChallengeId;
      phaseId: PhaseId;
      generation: number;
    }
  | {
      mode: "replay";
      accountId: AccountId;
      challengeId: ChallengeId;
      phaseId: PhaseId;
      generation: number;
      replaySessionId: ReplaySessionId;
      branchId: BranchId;
      datasetHash: string;
    };

export type ChallengeStatus =
  | "NOT_STARTED"
  | "ACTIVE"
  | "PASSED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export type PhaseStatus = "LOCKED" | "ACTIVE" | "PASSED" | "FAILED";
export type RuleEnforcement = "hard" | "advisory";
export type RuleMetric = "cash" | "equity";
export type RuleReference =
  | "phaseStartingCash"
  | "dayStartCash"
  | "peakEquity";

export interface PercentageAllowance {
  kind: "percentage";
  rate: DecimalText;
  basis: "phaseStartingCash";
}

export interface AbsoluteAllowance {
  kind: "absolute";
  amount: DecimalText;
}

export type Allowance = PercentageAllowance | AbsoluteAllowance;

export interface WarningPolicy {
  warningConsumed: DecimalText;
  dangerConsumed: DecimalText;
  rearmBelow: DecimalText;
}

interface RuleBase {
  id: string;
  enforcement: RuleEnforcement;
  enabled: boolean;
}

export interface LossRule extends RuleBase {
  kind: "loss";
  window: "daily" | "phase";
  method: "static" | "trailing";
  observed: "equity";
  anchor: RuleReference;
  allowance: Allowance;
  breachAt: "atOrBelowFloor";
  highWaterUpdate?: "eachObservation" | "dayClose";
  warnings: WarningPolicy;
}

export interface ProfitTargetRule extends RuleBase {
  kind: "profitTarget";
  observed: "cash";
  reference: "phaseStartingCash";
  amount: Allowance;
  reachedAt: "atOrAboveTarget";
  requireFlat: true;
  requireNoWorkingOrders: true;
}

export interface ActiveDaysRule extends RuleBase {
  kind: "activeDays";
  required: number;
  qualifiesOn: "exposureIncreasingFill";
  finalization: "dayClose";
}

export interface ProfitableDaysRule extends RuleBase {
  kind: "profitableDays";
  required: number;
  pnlBasis: "feeCompleteSettledPnl";
  threshold: PercentageAllowance;
  finalization: "dayClose";
  requireActiveDay: true;
}

export interface InactivityRule extends RuleBase {
  kind: "inactivity";
  limitDays: number;
  clock: "elapsedUtcDays";
  qualifiesOn: "exposureIncreasingFill";
  deadlineAt: "inclusive";
}

export interface LeverageRule extends RuleBase {
  kind: "leverage";
  maximum: DecimalText;
  enforcementPoint: "exposureAdmission";
  appliesTo: readonly ["entry", "increase", "reversalResidual"];
  reductionsAlwaysPermitted: true;
}

export type ChallengeRule =
  | LossRule
  | ProfitTargetRule
  | ActiveDaysRule
  | ProfitableDaysRule
  | InactivityRule
  | LeverageRule;

export interface InstrumentRoundingPolicy {
  command: "reject";
  derived: "adverse" | "towardZero";
}

export interface InstrumentPolicy {
  symbol: SymbolId;
  policyVersion: string;
  priceScale: number;
  quantityScale: number;
  priceTick: DecimalText;
  quantityStep: DecimalText;
  minimumQuantity: DecimalText;
  minimumNotional: DecimalText;
  priceRounding: InstrumentRoundingPolicy;
  quantityRounding: InstrumentRoundingPolicy;
}

export interface ExecutionPolicy {
  policyId: string;
  policyVersion: string;
  instrumentPolicyVersion: string;
  commissionRate: DecimalText;
  marketSlippageTicks: number;
  normalStopCrossing: "stopPrice";
  gapThroughStop: "firstObservableAdverse";
  commandGridValidation: "reject";
  reversalProtection: "reset";
  replayIntrabarPath: {
    upCandle: readonly ["open", "low", "high", "close"];
    downCandle: readonly ["open", "high", "low", "close"];
  };
}

export interface DayBoundaryPolicy {
  timezone: "UTC";
  localResetTime: "00:00:00";
  timezoneDataVersion: string;
  intervals: "startInclusiveEndExclusive";
  ambiguousTime: "earlier";
  nonexistentTime: "nextValid";
}

export interface PhaseDefinition {
  id: string;
  sequence: number;
  name: string;
  rules: readonly ChallengeRule[];
  completion: {
    allRuleIds: readonly string[];
    requireFlat: true;
    requireNoWorkingOrders: true;
    simultaneousOutcome: "hardBreachWins";
  };
  transition: {
    nextPhaseId: string | null;
    capital: "resetToSelectedCapital";
    counters: "reset";
    drawdownReferences: "reset";
    positionsAndOrders: "clear";
    nextPhaseTrading: "nextCausalObservation";
  };
}

export interface DomainVersions {
  snapshot: string;
  schema: string;
  accounting: string;
  rounding: string;
  calendar: string;
  rules: string;
  execution: string;
}

export interface ChallengeTemplate {
  templateId: string;
  templateVersion: string;
  displayName: string;
  challengeType: ChallengeType;
  status: "PUBLISHED";
  supportedSymbols: readonly SymbolId[];
  startingCapitalOptions: readonly DecimalText[];
  instrumentPolicies: readonly InstrumentPolicy[];
  executionPolicy: ExecutionPolicy;
  calendar: DayBoundaryPolicy;
  phases: readonly PhaseDefinition[];
  versions: DomainVersions;
  source: {
    origin: "internal";
    name: "MyCryptoStack";
  };
}

export interface FrozenChallengeDefinition {
  snapshotVersion: string;
  template: ChallengeTemplate;
  selectedCapital: DecimalText;
  selectedSymbol: SymbolId;
  mode: ChallengeMode;
  instrumentPolicy: InstrumentPolicy;
  executionPolicy: ExecutionPolicy;
  calendar: DayBoundaryPolicy;
  versions: DomainVersions;
  templateHash: string;
  instrumentPolicyHash: string;
  calendarHash: string;
  definitionHash: string;
}
