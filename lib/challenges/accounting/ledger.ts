import {
  nextUtcDayBoundary,
  utcDayIdAt,
} from "../domain/calendar";
import {
  moneyFromAtoms,
  moneyFromDecimal,
  normalizeDecimalText,
} from "../domain/money";
import type {
  DecimalText,
  ExecutionScope,
  FrozenChallengeDefinition,
  Money,
} from "../domain/types";
import {
  canonicalHash,
  deepFreeze,
  ACCOUNTING_VERSION,
} from "../domain/versions";
import { verifyFrozenChallengeDefinition } from "../domain/templates";
import { notionalFor } from "../execution/policy";
import type {
  ExecutionFact,
  PositionState,
} from "../execution/types";
import { EXECUTION_CHECKPOINT_VERSION } from "./checkpoint";
import { assertAccountInvariants } from "./invariants";
import type {
  AccountPositionProjection,
  ChallengeAccountState,
  ChallengeLedgerInput,
  ClosedDayAccounting,
  CurrentDayAccounting,
  DayBoundaryLedgerInput,
  ExecutionCheckpointLedgerInput,
  ExecutionCheckpointId,
  ExecutionFactLedgerInput,
  LedgerApplyResult,
  LedgerInputId,
  LedgerPosting,
  LedgerPostingId,
  LedgerRejection,
  LedgerRejectionCode,
  StableAccountCheckpoint,
} from "./types";

const LEDGER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/;
export function ledgerInputId(value: string): LedgerInputId {
  if (!LEDGER_ID.test(value)) {
    throw new TypeError("LedgerInputId must be 1-160 safe identity characters.");
  }
  return value as LedgerInputId;
}
function postingId(value: string): LedgerPostingId {
  if (!LEDGER_ID.test(value)) {
    throw new TypeError("LedgerPostingId must be 1-160 safe identity characters.");
  }
  return value as LedgerPostingId;
}

export function executionFactLedgerInput(
  sequence: number,
  fact: ExecutionFact,
  definition: FrozenChallengeDefinition,
): ExecutionFactLedgerInput {
  return deepFreeze({
    kind: "executionFact",
    inputId: ledgerInputId("fact:" + String(fact.factId)),
    sequence,
    accountingVersion: definition.versions.accounting,
    definitionHash: definition.definitionHash,
    fact,
  });
}

function checkpointId(value: string): ExecutionCheckpointId {
  if (!LEDGER_ID.test(value)) {
    throw new TypeError(
      "ExecutionCheckpointId must be 1-160 safe identity characters.",
    );
  }
  return value as ExecutionCheckpointId;
}

function checkpointIdentity(input: {
  scope: ExecutionScope;
  symbol: ChallengeAccountState["symbol"];
  commandId: ExecutionCheckpointLedgerInput["commandId"];
  firstFactSequence: number;
  lastFactSequence: number;
  factIds: readonly ExecutionCheckpointLedgerInput["factIds"][number][];
  accountRevision: number;
  ledgerHash: string;
  definitionHash: string;
  checkpointVersion: string;
  executionVersion: string;
  accountingVersion: string;
  instrumentPolicyVersion: string;
  occurredAt: ExecutionCheckpointLedgerInput["occurredAt"];
}): ExecutionCheckpointId {
  return checkpointId("checkpoint:" + canonicalHash(input));
}

export function executionCheckpointLedgerInput(input: {
  sequence: number;
  facts: readonly ExecutionFact[];
  account: ChallengeAccountState;
  definition: FrozenChallengeDefinition;
}): ExecutionCheckpointLedgerInput {
  if (input.facts.length === 0) {
    throw new RangeError("Execution checkpoint requires at least one fact.");
  }
  const first = input.facts[0];
  const last = input.facts[input.facts.length - 1];
  for (let index = 0; index < input.facts.length; index += 1) {
    const fact = input.facts[index];
    if (fact.commandId !== first.commandId ||
        !scopesEqual(fact.scope, first.scope) ||
        fact.symbol !== first.symbol ||
        fact.sequence !== first.sequence + index) {
      throw new RangeError(
        "Execution checkpoint facts must be one contiguous command batch.",
      );
    }
  }
  const basis = {
    scope: first.scope,
    symbol: first.symbol,
    commandId: first.commandId,
    firstFactSequence: first.sequence,
    lastFactSequence: last.sequence,
    factIds: input.facts.map((fact) => fact.factId),
    accountRevision: input.account.revision,
    ledgerHash: input.account.ledgerHash,
    definitionHash: input.definition.definitionHash,
    checkpointVersion: EXECUTION_CHECKPOINT_VERSION,
    executionVersion: input.definition.versions.execution,
    accountingVersion: input.definition.versions.accounting,
    instrumentPolicyVersion: input.definition.instrumentPolicy.policyVersion,
    occurredAt: last.occurredAt,
  };
  const id = checkpointIdentity(basis);
  return deepFreeze({
    kind: "executionCheckpoint",
    inputId: ledgerInputId(String(id)),
    checkpointId: id,
    sequence: input.sequence,
    ...basis,
  });
}


export function dayBoundaryLedgerInput(input: {
  inputId: string;
  sequence: number;
  definition: FrozenChallengeDefinition;
  scope: ExecutionScope;
  occurredAt: DayBoundaryLedgerInput["occurredAt"];
  markPrice?: string;
}): DayBoundaryLedgerInput {
  return deepFreeze({
    kind: "dayBoundary",
    inputId: ledgerInputId(input.inputId),
    sequence: input.sequence,
    accountingVersion: input.definition.versions.accounting,
    definitionHash: input.definition.definitionHash,
    scope: input.scope,
    symbol: input.definition.selectedSymbol,
    occurredAt: input.occurredAt,
    ...(input.markPrice === undefined ? {} : { markPrice: input.markPrice }),
  });
}

const add = (a: Money, b: Money): Money => moneyFromAtoms(a + b);
const sub = (a: Money, b: Money): Money => moneyFromAtoms(a - b);
const zero = (): Money => moneyFromAtoms(BigInt(0));

function scopesEqual(a: ExecutionScope, b: ExecutionScope): boolean {
  if (
    a.mode !== b.mode || a.accountId !== b.accountId ||
    a.challengeId !== b.challengeId || a.phaseId !== b.phaseId ||
    a.generation !== b.generation
  ) return false;
  if (a.mode === "live" && b.mode === "live") return true;
  return a.mode === "replay" && b.mode === "replay" &&
    a.replaySessionId === b.replaySessionId &&
    a.branchId === b.branchId &&
    a.datasetHash === b.datasetHash;
}

function sourcePosition(
  position: AccountPositionProjection | null,
): PositionState | null {
  if (!position) return null;
  return {
    positionId: position.positionId,
    lifecycleId: position.lifecycleId,
    symbol: position.symbol,
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    costBasis: position.costBasis,
    entryCommissionTotal: position.entryCommissionTotal,
    entryCommissionRemaining: position.entryCommissionRemaining,
    leverage: position.leverage,
    openedAt: position.openedAt,
    protection: position.protection,
  };
}

function projectPosition(
  source: PositionState | null,
  mark: DecimalText | null,
  definition: FrozenChallengeDefinition,
): AccountPositionProjection | null {
  if (!source) return null;
  if (mark === null) {
    return {
      ...source,
      protection: { ...source.protection },
      currentMark: null,
      unrealizedPnl: zero(),
      grossExposure: source.costBasis,
    };
  }
  const exposure = notionalFor(
    definition.instrumentPolicy,
    mark,
    source.quantity,
  );
  return {
    ...source,
    protection: { ...source.protection },
    currentMark: mark,
    grossExposure: exposure,
    unrealizedPnl: moneyFromAtoms(
      source.side === "long"
        ? exposure - source.costBasis
        : source.costBasis - exposure,
    ),
  };
}

function currentDay(
  dayId: CurrentDayAccounting["currentDayId"],
  startCash: Money,
  startEquity: Money,
  startUnrealized: Money,
): CurrentDayAccounting {
  return {
    currentDayId: dayId,
    dayStartCash: startCash,
    dayStartEquity: startEquity,
    dayUnrealizedStart: startUnrealized,
    dayRealizedGrossPnl: zero(),
    dayCommissions: zero(),
    dayCapitalAdjustments: zero(),
    daySettledNetPnl: zero(),
    dayBalanceChange: zero(),
    dayUnrealizedChange: zero(),
    dayEquityChange: zero(),
  };
}

function reconcile(state: ChallengeAccountState): ChallengeAccountState {
  const cashBalance = moneyFromAtoms(
    state.phaseStartingCash +
      state.realizedGrossPnl -
      state.totalCommissions +
      state.cumulativeCapitalAdjustments,
  );
  const unrealizedPnl = state.position?.unrealizedPnl ?? zero();
  const grossExposure = state.position?.grossExposure ?? zero();
  const equity = add(cashBalance, unrealizedPnl);
  const freeMargin = moneyFromAtoms(
    equity - state.usedMargin - state.reservedMargin,
  );
  const day: CurrentDayAccounting = {
    ...state.day,
    daySettledNetPnl: sub(
      state.day.dayRealizedGrossPnl,
      state.day.dayCommissions,
    ),
    dayBalanceChange: moneyFromAtoms(
      cashBalance -
        state.day.dayStartCash -
        state.day.dayCapitalAdjustments,
    ),
    dayUnrealizedChange: sub(
      unrealizedPnl,
      state.day.dayUnrealizedStart,
    ),
    dayEquityChange: moneyFromAtoms(
      equity -
        state.day.dayStartEquity -
        state.day.dayCapitalAdjustments,
    ),
  };
  return {
    ...state,
    cashBalance,
    unrealizedPnl,
    grossExposure,
    equity,
    freeMargin,
    day,
  };
}

function immutable(state: ChallengeAccountState): ChallengeAccountState {
  return deepFreeze({
    ...state,
    scope: { ...state.scope },
    replayScope: state.replayScope ? { ...state.replayScope } : null,
    position: state.position
      ? { ...state.position, protection: { ...state.position.protection } }
      : null,
    fills: state.fills.map((record) => ({
      ...record,
      fill: { ...record.fill },
    })),
    reservations: state.reservations.map((x) => ({ ...x })),
    feeAllocations: state.feeAllocations.map((x) => ({ ...x })),
    postings: state.postings.map((x) => ({ ...x })),
    closedDays: state.closedDays.map((x) => ({ ...x })),
    pendingExecutionCommand: state.pendingExecutionCommand
      ? {
          ...state.pendingExecutionCommand,
          factIds: [...state.pendingExecutionCommand.factIds],
        }
      : null,
    appliedCheckpointIds: [...state.appliedCheckpointIds],
    committedCommandIds: [...state.committedCommandIds],
    checkpoints: state.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      factIds: [...checkpoint.factIds],
    })),
    lastStableCheckpoint: state.lastStableCheckpoint
      ? {
          ...state.lastStableCheckpoint,
          factIds: [...state.lastStableCheckpoint.factIds],
        }
      : null,
    appliedInputIds: [...state.appliedInputIds],
    appliedFactIds: [...state.appliedFactIds],
    appliedFillIds: [...state.appliedFillIds],
    commissionedFillIds: [...state.commissionedFillIds],
    allocatedCloseFillIds: [...state.allocatedCloseFillIds],
    day: { ...state.day },
  });
}

export function initializeChallengeAccount(input: {
  definition: FrozenChallengeDefinition;
  phaseId: string;
  scope: ExecutionScope;
  occurredAt: ChallengeAccountState["lastOccurredAt"];
}): ChallengeAccountState {
  const definition = verifyFrozenChallengeDefinition(input.definition);
  if (definition.versions.accounting !== ACCOUNTING_VERSION) {
    throw new RangeError("Unsupported Challenge accounting version.");
  }
  if (
    definition.mode !== input.scope.mode ||
    definition.selectedSymbol !== "BTCUSDT" ||
    input.scope.phaseId !== input.phaseId ||
    !definition.template.phases.some((phase) => phase.id === input.phaseId)
  ) {
    throw new RangeError("Initial scope does not match the frozen definition.");
  }
  const startingCash = moneyFromDecimal(definition.selectedCapital);
  const dayId = utcDayIdAt(input.occurredAt);
  const replayScope = input.scope.mode === "replay"
    ? {
        replaySessionId: input.scope.replaySessionId,
        branchId: input.scope.branchId,
        datasetHash: input.scope.datasetHash,
      }
    : null;
  const basis = {
    definitionHash: definition.definitionHash,
    scope: input.scope,
    phaseId: input.phaseId,
    occurredAt: input.occurredAt,
    startingCash,
    accountingVersion: definition.versions.accounting,
  };
  const state = reconcile({
    challengeId: input.scope.challengeId,
    accountId: input.scope.accountId,
    phaseId: input.scope.phaseId,
    mode: input.scope.mode,
    generation: input.scope.generation,
    symbol: definition.selectedSymbol,
    scope: { ...input.scope },
    replayScope,
    checkpointVersion: EXECUTION_CHECKPOINT_VERSION,
    executionVersion: definition.versions.execution,
    executionPolicyVersion: definition.executionPolicy.policyVersion,
    accountingVersion: definition.versions.accounting,
    instrumentPolicyVersion: definition.instrumentPolicy.policyVersion,
    definitionHash: definition.definitionHash,
    revision: 0,
    nextInputSequence: 1,
    lastExecutionFactSequence: 0,
    phaseStartedAt: input.occurredAt,
    lastOccurredAt: input.occurredAt,
    appliedInputIds: [],
    appliedFactIds: [],
    appliedFillIds: [],
    commissionedFillIds: [],
    allocatedCloseFillIds: [],
    ledgerHash: canonicalHash(basis),
    projectionStability: "STABLE",
    pendingExecutionCommand: null,
    stableCheckpointSequence: 0,
    appliedCheckpointIds: [],
    committedCommandIds: [],
    checkpoints: [],
    lastStableCheckpoint: null,
    phaseStartingCash: startingCash,
    cashBalance: startingCash,
    equity: startingCash,
    realizedGrossPnl: zero(),
    totalCommissions: zero(),
    cumulativeCapitalAdjustments: zero(),
    unrealizedPnl: zero(),
    usedMargin: zero(),
    reservedMargin: zero(),
    freeMargin: startingCash,
    grossExposure: zero(),
    position: null,
    fills: [],
    reservations: [],
    lastMarkPrice: null,
    feeAllocations: [],
    postings: [] as const,
    day: currentDay(dayId, startingCash, startingCash, zero()),
    closedDays: [],
  });
  assertAccountInvariants(state);
  return immutable(state);
}

function rejection(
  code: LedgerRejectionCode,
  message: string,
  inputId?: LedgerInputId,
  field?: string,
): LedgerRejection {
  return { code, message, ...(inputId ? { inputId } : {}),
    ...(field ? { field } : {}) };
}
function rejected(
  state: ChallengeAccountState,
  reason: LedgerRejection,
): LedgerApplyResult {
  return deepFreeze({ status: "rejected", state, postings: [] as const, rejection: reason });
}
function alreadyApplied(
  state: ChallengeAccountState,
  inputId: LedgerInputId,
  message: string,
): LedgerApplyResult {
  return deepFreeze({
    status: "alreadyApplied",
    state,
    postings: [] as const,
    rejection: rejection("ALREADY_APPLIED", message, inputId),
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function commonValidation(
  state: ChallengeAccountState,
  input: ChallengeLedgerInput,
  definition: FrozenChallengeDefinition,
): LedgerApplyResult | null {
  if (!LEDGER_ID.test(input.inputId)) {
    return rejected(state, rejection(
      "MALFORMED_INPUT",
      "Ledger input identity is invalid.",
      input.inputId,
      "inputId",
    ));
  }
  if (state.appliedInputIds.includes(input.inputId)) {
    return alreadyApplied(state, input.inputId, "Ledger input was already applied.");
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence !== state.nextInputSequence) {
    return rejected(state, rejection(
      "OUT_OF_ORDER",
      "Ledger input sequence must equal the next expected sequence.",
      input.inputId,
      "sequence",
    ));
  }
  if (input.accountingVersion !== state.accountingVersion ||
      input.accountingVersion !== definition.versions.accounting) {
    return rejected(state, rejection(
      "VERSION_MISMATCH", "Accounting version mismatch.",
      input.inputId, "accountingVersion"));
  }
  if (input.definitionHash !== state.definitionHash ||
      input.definitionHash !== definition.definitionHash) {
    return rejected(state, rejection(
      "DEFINITION_MISMATCH", "Frozen definition hash mismatch.",
      input.inputId, "definitionHash"));
  }
  if (definition.versions.execution !== state.executionVersion ||
      definition.executionPolicy.policyVersion !== state.executionPolicyVersion ||
      definition.instrumentPolicy.policyVersion !== state.instrumentPolicyVersion) {
    return rejected(state, rejection(
      "VERSION_MISMATCH", "Frozen policy version mismatch.", input.inputId));
  }
  return null;
}

interface DraftApplication {
  state: ChallengeAccountState;
  postings: LedgerPosting[];
}
function addPosting(
  draft: DraftApplication,
  input: ChallengeLedgerInput,
  fact: ExecutionFact | null,
  kind: LedgerPosting["kind"],
  amount: Money,
  cashDelta: Money,
  positionId: LedgerPosting["positionId"] = null,
  lifecycleId: LedgerPosting["lifecycleId"] = null,
): void {
  const posting: LedgerPosting = {
    postingId: postingId(
      String(input.inputId) + ":posting:" + (draft.postings.length + 1)),
    inputId: input.inputId,
    ledgerSequence: input.sequence,
    sourceFactId: fact?.factId ?? null,
    occurredAt: fact?.occurredAt ??
      (input.kind === "dayBoundary" ? input.occurredAt : draft.state.lastOccurredAt),
    dayId: draft.state.day.currentDayId,
    kind,
    amount,
    cashDelta,
    positionId,
    lifecycleId,
  };
  draft.postings.push(posting);
}

function updateFeeAllocation(
  state: ChallengeAccountState,
  fact: Extract<ExecutionFact, { kind: "EntryFeeAllocated" }>,
): ChallengeAccountState {
  const index = state.feeAllocations.findIndex(
    (item) => item.lifecycleId === fact.lifecycleId);
  const previous = index >= 0 ? state.feeAllocations[index] : null;
  const next = {
    positionId: fact.positionId,
    lifecycleId: fact.lifecycleId,
    allocatedEntryFees: add(
      previous?.allocatedEntryFees ?? zero(),
      fact.allocatedAmount,
    ),
    remainingEntryFees: fact.remainingAmount,
    finalAllocationSeen: fact.finalAllocation,
  };
  return {
    ...state,
    feeAllocations: index < 0
      ? [...state.feeAllocations, next]
      : state.feeAllocations.map((item, itemIndex) =>
          itemIndex === index ? next : item),
  };
}

function applyExecutionFact(
  initial: ChallengeAccountState,
  input: ExecutionFactLedgerInput,
  definition: FrozenChallengeDefinition,
): LedgerApplyResult {
  const fact = input.fact;
  if (!isRecord(fact) || typeof fact.kind !== "string" ||
      typeof fact.sequence !== "number" || typeof fact.occurredAt !== "number" ||
      typeof fact.factId !== "string") {
    return rejected(initial, rejection(
      "MALFORMED_INPUT", "Execution fact is malformed.", input.inputId, "fact"));
  }
  if (initial.appliedFactIds.includes(fact.factId)) {
    return alreadyApplied(initial, input.inputId, "Execution fact was already applied.");
  }
  if (initial.pendingExecutionCommand &&
      initial.pendingExecutionCommand.commandId !== fact.commandId) {
    return rejected(initial, rejection(
      "UNFINISHED_COMMAND",
      "Finish the pending execution command before applying another command.",
      input.inputId,
      "fact.commandId",
    ));
  }
  if (fact.sequence !== initial.lastExecutionFactSequence + 1) {
    return rejected(initial, rejection(
      "EXECUTION_FACT_OUT_OF_ORDER",
      "Execution fact sequence is not contiguous.",
      input.inputId,
      "fact.sequence",
    ));
  }
  if (initial.committedCommandIds.includes(fact.commandId)) {
    return rejected(initial, rejection(
      "COMMAND_ALREADY_COMMITTED",
      "Execution command already has a stable checkpoint.",
      input.inputId,
      "fact.commandId",
    ));
  }
  if (!scopesEqual(fact.scope, initial.scope)) {
    return rejected(initial, rejection(
      "SCOPE_MISMATCH", "Execution fact scope mismatch.",
      input.inputId, "fact.scope"));
  }
  if (fact.symbol !== initial.symbol) {
    return rejected(initial, rejection(
      "SYMBOL_MISMATCH", "Execution fact symbol mismatch.",
      input.inputId, "fact.symbol"));
  }
  if (fact.executionPolicyVersion !== initial.executionPolicyVersion) {
    return rejected(initial, rejection(
      "VERSION_MISMATCH", "Execution policy version mismatch.",
      input.inputId, "fact.executionPolicyVersion"));
  }
  if (fact.occurredAt < initial.lastOccurredAt) {
    return rejected(initial, rejection(
      "TIME_REGRESSION", "Execution fact time precedes the last ledger input.",
      input.inputId, "fact.occurredAt"));
  }
  if (utcDayIdAt(fact.occurredAt) !== initial.day.currentDayId) {
    return rejected(initial, rejection(
      "DAY_BOUNDARY_REQUIRED",
      "Advance the UTC day before applying facts from the next day.",
      input.inputId, "fact.occurredAt"));
  }

  const draft: DraftApplication = { state: initial, postings: [] };
  switch (fact.kind) {
    case "MarketObserved": {
      let mark: DecimalText;
      try {
        mark = normalizeDecimalText(fact.price);
        const marked = projectPosition(
          sourcePosition(draft.state.position), mark, definition);
        draft.state = {
          ...draft.state,
          lastMarkPrice: mark,
          position: marked,
        };
        addPosting(draft, input, fact, "mark",
          sub(marked?.unrealizedPnl ?? zero(), initial.unrealizedPnl),
          zero(), marked?.positionId ?? null, marked?.lifecycleId ?? null);
      } catch {
        return rejected(initial, rejection(
          "MALFORMED_INPUT", "Market observation price is invalid.",
          input.inputId, "fact.price"));
      }
      break;
    }
    case "FillCommitted": {
      if (draft.state.appliedFillIds.includes(fact.fill.fillId)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH", "Fill identity was already applied.",
          input.inputId, "fact.fill.fillId"));
      }
      draft.state = {
        ...draft.state,
        fills: [...draft.state.fills, {
          factId: fact.factId,
          executionFactSequence: fact.sequence,
          ledgerSequence: input.sequence,
          occurredAt: fact.occurredAt,
          dayId: draft.state.day.currentDayId,
          fill: { ...fact.fill },
        }],
        appliedFillIds: [...draft.state.appliedFillIds, fact.fill.fillId],
      };
      if (fact.fill.classification === "exit") {
        draft.state = {
          ...draft.state,
          realizedGrossPnl: add(
            draft.state.realizedGrossPnl,
            fact.fill.grossRealizedPnl,
          ),
          day: {
            ...draft.state.day,
            dayRealizedGrossPnl: add(
              draft.state.day.dayRealizedGrossPnl,
              fact.fill.grossRealizedPnl,
            ),
          },
        };
        addPosting(draft, input, fact, "realizedGrossPnl",
          fact.fill.grossRealizedPnl, fact.fill.grossRealizedPnl,
          fact.fill.positionId, fact.fill.lifecycleId);
      } else if (fact.fill.grossRealizedPnl !== BigInt(0)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Entry or increase fill cannot realize P&L.",
          input.inputId, "fact.fill.grossRealizedPnl"));
      }
      break;
    }
    case "CommissionAssessed": {
      if (!draft.state.appliedFillIds.includes(fact.fillId)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Commission must follow its canonical fill.",
          input.inputId, "fact.fillId"));
      }
      if (draft.state.commissionedFillIds.includes(fact.fillId)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "A fill may have only one commission debit.",
          input.inputId, "fact.fillId"));
      }
      if (fact.ledgerEffect !== "debitCash" || fact.amount < BigInt(0)) {
        return rejected(initial, rejection(
          "MALFORMED_INPUT", "Commission debit is invalid.",
          input.inputId, "fact.amount"));
      }
      draft.state = {
        ...draft.state,
        commissionedFillIds: [...draft.state.commissionedFillIds, fact.fillId],
        totalCommissions: add(draft.state.totalCommissions, fact.amount),
        day: {
          ...draft.state.day,
          dayCommissions: add(draft.state.day.dayCommissions, fact.amount),
        },
      };
      addPosting(draft, input, fact, "commissionDebit",
        fact.amount, moneyFromAtoms(-fact.amount));
      break;
    }
    case "EntryFeeAllocated": {
      if (fact.ledgerEffect !== "none" ||
          !draft.state.appliedFillIds.includes(fact.closeFillId)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Entry-fee allocation must follow its close fill and have no ledger effect.",
          input.inputId));
      }
      if (draft.state.allocatedCloseFillIds.includes(fact.closeFillId)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH", "Close fill was already allocated.",
          input.inputId, "fact.closeFillId"));
      }
      draft.state = updateFeeAllocation(draft.state, fact);
      draft.state = {
        ...draft.state,
        allocatedCloseFillIds: [
          ...draft.state.allocatedCloseFillIds,
          fact.closeFillId,
        ],
      };
      addPosting(draft, input, fact, "entryFeeAllocation",
        fact.allocatedAmount, zero(), fact.positionId, fact.lifecycleId);
      break;
    }
    case "PositionTransitioned": {
      const expectedBefore = sourcePosition(draft.state.position);
      if (canonicalHash(expectedBefore) !== canonicalHash(fact.value.positionBefore)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Position transition before-state does not match projection.",
          input.inputId, "fact.value.positionBefore"));
      }
      draft.state = {
        ...draft.state,
        position: projectPosition(
          fact.value.positionAfter,
          draft.state.lastMarkPrice,
          definition,
        ),
      };
      break;
    }
    case "MarginTransitioned": {
      if (fact.value.before.used !== draft.state.usedMargin ||
          fact.value.before.reserved !== draft.state.reservedMargin ||
          fact.value.after.used < BigInt(0) ||
          fact.value.after.reserved < BigInt(0)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Margin transition does not match projected margin.",
          input.inputId, "fact.value"));
      }
      draft.state = {
        ...draft.state,
        usedMargin: fact.value.after.used,
        reservedMargin: fact.value.after.reserved,
      };
      addPosting(draft, input, fact, "marginTransition",
        moneyFromAtoms(
          fact.value.after.used + fact.value.after.reserved -
          fact.value.before.used - fact.value.before.reserved),
        zero());
      break;
    }
    case "ReservationTransitioned": {
      const reservation = fact.value.reservation;
      const exists = draft.state.reservations.some(
        (item) => item.reservationId === reservation.reservationId);
      if ((fact.value.transition === "created" && exists) ||
          (fact.value.transition === "released" && !exists)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Reservation transition conflicts with projection.",
          input.inputId, "fact.value"));
      }
      draft.state = {
        ...draft.state,
        reservations: fact.value.transition === "created"
          ? [...draft.state.reservations, reservation]
          : draft.state.reservations.filter(
              (item) => item.reservationId !== reservation.reservationId),
      };
      addPosting(draft, input, fact, "reservationTransition",
        fact.value.transition === "created"
          ? reservation.requiredMargin
          : moneyFromAtoms(-reservation.requiredMargin),
        zero());
      break;
    }
    case "ProtectionChanged": {
      const currentProtection = draft.state.position?.protection;
      const matchesBefore = currentProtection !== undefined &&
        canonicalHash(currentProtection) === canonicalHash(fact.before);
      const alreadyProjected = currentProtection !== undefined &&
        canonicalHash(currentProtection) === canonicalHash(fact.after);
      if (draft.state.position?.positionId !== fact.positionId ||
          (!matchesBefore && !alreadyProjected)) {
        return rejected(initial, rejection(
          "PROJECTION_MISMATCH",
          "Protection fact does not match the current position.",
          input.inputId,
          "fact.positionId",
        ));
      }
      if (!alreadyProjected) {
        draft.state = {
          ...draft.state,
          position: {
            ...draft.state.position,
            protection: { ...fact.after },
          },
        };
      }
      break;
    }
    case "WorkingOrderPlaced":
    case "WorkingOrderCancelled":
    case "CommandRejected":
      break;
    default:
      return rejected(initial, rejection(
        "MALFORMED_INPUT",
        "Execution fact kind is unknown.",
        input.inputId,
        "fact.kind",
      ));
  }

  const pending = initial.pendingExecutionCommand;
  draft.state = {
    ...draft.state,
    projectionStability: "INTERMEDIATE",
    pendingExecutionCommand: pending
      ? {
          ...pending,
          lastFactSequence: fact.sequence,
          factIds: [...pending.factIds, fact.factId],
          occurredAt: fact.occurredAt,
        }
      : {
          commandId: fact.commandId,
          firstFactSequence: fact.sequence,
          lastFactSequence: fact.sequence,
          factIds: [fact.factId],
          occurredAt: fact.occurredAt,
        },
  };

  return finishApplied(initial, draft, input, fact);
}

function sameFactIds(
  left: readonly ExecutionCheckpointLedgerInput["factIds"][number][],
  right: readonly ExecutionCheckpointLedgerInput["factIds"][number][],
): boolean {
  return left.length === right.length &&
    left.every((factId, index) => factId === right[index]);
}

function nextLedgerHashFor(
  state: ChallengeAccountState,
  input: ChallengeLedgerInput,
): string {
  return canonicalHash({
    previousLedgerHash: state.ledgerHash,
    input,
  });
}

function applyExecutionCheckpoint(
  initial: ChallengeAccountState,
  input: ExecutionCheckpointLedgerInput,
): LedgerApplyResult {
  if (initial.appliedCheckpointIds.includes(input.checkpointId)) {
    return alreadyApplied(
      initial,
      input.inputId,
      "Execution checkpoint was already applied.",
    );
  }
  if (initial.committedCommandIds.includes(input.commandId)) {
    return rejected(initial, rejection(
      "COMMAND_ALREADY_COMMITTED",
      "Execution command already has a stable checkpoint.",
      input.inputId,
      "commandId",
    ));
  }
  if (!scopesEqual(input.scope, initial.scope)) {
    return rejected(initial, rejection(
      "SCOPE_MISMATCH",
      "Execution checkpoint scope mismatch.",
      input.inputId,
      "scope",
    ));
  }
  if (input.symbol !== initial.symbol) {
    return rejected(initial, rejection(
      "SYMBOL_MISMATCH",
      "Execution checkpoint symbol mismatch.",
      input.inputId,
      "symbol",
    ));
  }
  if (input.checkpointVersion !== EXECUTION_CHECKPOINT_VERSION ||
      input.checkpointVersion !== initial.checkpointVersion ||
      input.executionVersion !== initial.executionVersion ||
      input.instrumentPolicyVersion !== initial.instrumentPolicyVersion) {
    return rejected(initial, rejection(
      "VERSION_MISMATCH",
      "Execution checkpoint version mismatch.",
      input.inputId,
    ));
  }
  const pending = initial.pendingExecutionCommand;
  if (!pending) {
    return rejected(initial, rejection(
      "CHECKPOINT_MISMATCH",
      "No unfinished execution command is available to checkpoint.",
      input.inputId,
    ));
  }
  if (input.commandId !== pending.commandId) {
    return rejected(initial, rejection(
      "CHECKPOINT_MISMATCH",
      "Execution checkpoint command does not match the pending command.",
      input.inputId,
      "commandId",
    ));
  }
  if (input.firstFactSequence !== pending.firstFactSequence ||
      input.lastFactSequence !== pending.lastFactSequence ||
      input.lastFactSequence !== initial.lastExecutionFactSequence ||
      input.firstFactSequence > input.lastFactSequence ||
      input.factIds.length !==
        input.lastFactSequence - input.firstFactSequence + 1 ||
      !sameFactIds(input.factIds, pending.factIds) ||
      !input.factIds.every((factId) =>
        initial.appliedFactIds.includes(factId))) {
    return rejected(initial, rejection(
      "CHECKPOINT_MISMATCH",
      "Execution checkpoint fact range is incomplete or does not match.",
      input.inputId,
      "factIds",
    ));
  }
  if (input.accountRevision !== initial.revision ||
      input.ledgerHash !== initial.ledgerHash) {
    return rejected(initial, rejection(
      "CHECKPOINT_MISMATCH",
      "Execution checkpoint account revision or ledger hash is stale.",
      input.inputId,
      "accountRevision",
    ));
  }
  if (input.occurredAt !== pending.occurredAt) {
    return rejected(initial, rejection(
      "CHECKPOINT_MISMATCH",
      "Execution checkpoint timestamp does not match its final fact.",
      input.inputId,
      "occurredAt",
    ));
  }
  const expectedId = checkpointIdentity({
    scope: input.scope,
    symbol: input.symbol,
    commandId: input.commandId,
    firstFactSequence: input.firstFactSequence,
    lastFactSequence: input.lastFactSequence,
    factIds: input.factIds,
    accountRevision: input.accountRevision,
    ledgerHash: input.ledgerHash,
    definitionHash: input.definitionHash,
    checkpointVersion: input.checkpointVersion,
    executionVersion: input.executionVersion,
    accountingVersion: input.accountingVersion,
    instrumentPolicyVersion: input.instrumentPolicyVersion,
    occurredAt: input.occurredAt,
  });
  if (input.checkpointId !== expectedId ||
      input.inputId !== String(expectedId)) {
    return rejected(initial, rejection(
      "CHECKPOINT_MISMATCH",
      "Execution checkpoint identity is not canonical.",
      input.inputId,
      "checkpointId",
    ));
  }
  const stableLedgerHash = nextLedgerHashFor(initial, input);
  const checkpoint: StableAccountCheckpoint = {
    checkpointId: input.checkpointId,
    checkpointSequence: initial.stableCheckpointSequence + 1,
    kind: "executionCommand",
    inputId: input.inputId,
    commandId: input.commandId,
    firstFactSequence: input.firstFactSequence,
    lastFactSequence: input.lastFactSequence,
    factIds: [...input.factIds],
    committedAccountRevision: input.accountRevision,
    committedLedgerHash: input.ledgerHash,
    stableAccountRevision: initial.revision + 1,
    stableLedgerHash,
    occurredAt: input.occurredAt,
  };
  const draft: DraftApplication = {
    state: {
      ...initial,
      projectionStability: "STABLE",
      pendingExecutionCommand: null,
      stableCheckpointSequence: checkpoint.checkpointSequence,
      appliedCheckpointIds: [
        ...initial.appliedCheckpointIds,
        input.checkpointId,
      ],
      committedCommandIds: [
        ...initial.committedCommandIds,
        input.commandId,
      ],
      checkpoints: [...initial.checkpoints, checkpoint],
      lastStableCheckpoint: checkpoint,
    },
    postings: [],
  };
  addPosting(
    draft,
    input,
    null,
    "executionCheckpoint",
    zero(),
    zero(),
  );
  return finishApplied(initial, draft, input, null);
}


function closedDayFrom(
  state: ChallengeAccountState,
  closedAt: ClosedDayAccounting["closedAt"],
): ClosedDayAccounting {
  return {
    dayId: state.day.currentDayId,
    startCash: state.day.dayStartCash,
    startEquity: state.day.dayStartEquity,
    startUnrealizedPnl: state.day.dayUnrealizedStart,
    endingCash: state.cashBalance,
    endingEquity: state.equity,
    endingUnrealizedPnl: state.unrealizedPnl,
    realizedGrossPnl: state.day.dayRealizedGrossPnl,
    commissions: state.day.dayCommissions,
    capitalAdjustments: state.day.dayCapitalAdjustments,
    settledNetPnl: state.day.daySettledNetPnl,
    balanceChange: state.day.dayBalanceChange,
    unrealizedChange: state.day.dayUnrealizedChange,
    equityChange: state.day.dayEquityChange,
    closedAt,
  };
}

function applyDayBoundary(
  initial: ChallengeAccountState,
  input: DayBoundaryLedgerInput,
  definition: FrozenChallengeDefinition,
): LedgerApplyResult {
  if (initial.pendingExecutionCommand) {
    return rejected(initial, rejection(
      "UNFINISHED_COMMAND",
      "A day boundary cannot split an unfinished execution command.",
      input.inputId,
    ));
  }
  if (!scopesEqual(input.scope, initial.scope)) {
    return rejected(initial, rejection(
      "SCOPE_MISMATCH", "Day boundary scope mismatch.",
      input.inputId, "scope"));
  }
  if (input.symbol !== initial.symbol) {
    return rejected(initial, rejection(
      "SYMBOL_MISMATCH", "Day boundary symbol mismatch.",
      input.inputId, "symbol"));
  }
  const expectedBoundary = nextUtcDayBoundary(initial.lastOccurredAt);
  if (input.occurredAt !== expectedBoundary ||
      utcDayIdAt(input.occurredAt) === initial.day.currentDayId) {
    return rejected(initial, rejection(
      "INVALID_DAY_BOUNDARY",
      "Day boundary must equal the next 00:00 UTC boundary.",
      input.inputId, "occurredAt"));
  }
  if (initial.position && input.markPrice === undefined) {
    return rejected(initial, rejection(
      "BOUNDARY_MARK_REQUIRED",
      "An overnight open position requires an explicit boundary mark.",
      input.inputId, "markPrice"));
  }

  const draft: DraftApplication = { state: initial, postings: [] };
  if (input.markPrice !== undefined) {
    try {
      const mark = normalizeDecimalText(input.markPrice);
      const position = projectPosition(
        sourcePosition(initial.position), mark, definition);
      draft.state = {
        ...draft.state,
        lastMarkPrice: mark,
        position,
      };
      addPosting(draft, input, null, "mark",
        sub(position?.unrealizedPnl ?? zero(), initial.unrealizedPnl),
        zero(), position?.positionId ?? null, position?.lifecycleId ?? null);
    } catch {
      return rejected(initial, rejection(
        "MALFORMED_INPUT", "Boundary mark is invalid.",
        input.inputId, "markPrice"));
    }
  }
  draft.state = reconcile(draft.state);
  const closed = closedDayFrom(draft.state, input.occurredAt);
  addPosting(draft, input, null, "dayBoundary", zero(), zero());
  draft.state = {
    ...draft.state,
    closedDays: [...draft.state.closedDays, closed],
    day: currentDay(
      utcDayIdAt(input.occurredAt),
      draft.state.cashBalance,
      draft.state.equity,
      draft.state.unrealizedPnl,
    ),
  };
  const id = checkpointId("checkpoint:" + canonicalHash({
    kind: "dayBoundary",
    input,
  }));
  const checkpoint: StableAccountCheckpoint = {
    checkpointId: id,
    checkpointSequence: initial.stableCheckpointSequence + 1,
    kind: "dayBoundary",
    inputId: input.inputId,
    commandId: null,
    firstFactSequence: null,
    lastFactSequence: null,
    factIds: [],
    committedAccountRevision: initial.revision,
    committedLedgerHash: initial.ledgerHash,
    stableAccountRevision: initial.revision + 1,
    stableLedgerHash: nextLedgerHashFor(initial, input),
    occurredAt: input.occurredAt,
  };
  draft.state = {
    ...draft.state,
    projectionStability: "STABLE",
    stableCheckpointSequence: checkpoint.checkpointSequence,
    appliedCheckpointIds: [...initial.appliedCheckpointIds, id],
    checkpoints: [...initial.checkpoints, checkpoint],
    lastStableCheckpoint: checkpoint,
  };
  return finishApplied(initial, draft, input, null);
}

function finishApplied(
  initial: ChallengeAccountState,
  draft: DraftApplication,
  input: ChallengeLedgerInput,
  fact: ExecutionFact | null,
): LedgerApplyResult {
  const occurredAt = fact?.occurredAt ??
    (input.kind === "dayBoundary" ? input.occurredAt : initial.lastOccurredAt);
  let next = reconcile({
    ...draft.state,
    revision: initial.revision + 1,
    nextInputSequence: initial.nextInputSequence + 1,
    lastExecutionFactSequence: fact?.sequence ??
      initial.lastExecutionFactSequence,
    lastOccurredAt: occurredAt,
    appliedInputIds: [...initial.appliedInputIds, input.inputId],
    appliedFactIds: fact
      ? [...initial.appliedFactIds, fact.factId]
      : initial.appliedFactIds,
    postings: [...initial.postings, ...draft.postings],
    ledgerHash: canonicalHash({
      previousLedgerHash: initial.ledgerHash,
      input,
    }),
  });
  try {
    assertAccountInvariants(next);
  } catch (error) {
    return rejected(initial, rejection(
      "INVARIANT_VIOLATION",
      error instanceof Error ? error.message : "Accounting invariant failed.",
      input.inputId,
    ));
  }
  next = immutable(next);
  return deepFreeze({
    status: "applied",
    state: next,
    postings: [...draft.postings],
  });
}

export function applyChallengeAccountInput(
  state: ChallengeAccountState,
  value: unknown,
  definition: FrozenChallengeDefinition,
): LedgerApplyResult {
  if (!isRecord(value) ||
      (value.kind !== "executionFact" &&
       value.kind !== "executionCheckpoint" &&
       value.kind !== "dayBoundary") ||
      typeof value.inputId !== "string" ||
      typeof value.sequence !== "number" ||
      typeof value.accountingVersion !== "string" ||
      typeof value.definitionHash !== "string") {
    return rejected(state, rejection(
      "MALFORMED_INPUT", "Ledger input envelope is malformed."));
  }
  const input = value as unknown as ChallengeLedgerInput;
  if (definition.definitionHash !== state.definitionHash ||
      definition.versions.accounting !== ACCOUNTING_VERSION) {
    return rejected(state, rejection(
      "DEFINITION_MISMATCH",
      "Reducer definition does not match initialized account.",
      input.inputId,
    ));
  }
  const common = commonValidation(state, input, definition);
  if (common) return common;
  if (input.kind === "executionFact") {
    try {
      return applyExecutionFact(state, input, definition);
    } catch {
      return rejected(state, rejection(
        "MALFORMED_INPUT",
        "Execution fact payload is malformed.",
        input.inputId,
        "fact",
      ));
    }
  }
  if (input.kind === "executionCheckpoint") {
    if (typeof input.checkpointId !== "string" ||
        !isRecord(input.scope) ||
        input.symbol !== "BTCUSDT" ||
        typeof input.commandId !== "string" ||
        !Number.isSafeInteger(input.firstFactSequence) ||
        !Number.isSafeInteger(input.lastFactSequence) ||
        !Array.isArray(input.factIds) ||
        !input.factIds.every((factId) => typeof factId === "string") ||
        !Number.isSafeInteger(input.accountRevision) ||
        typeof input.ledgerHash !== "string" ||
        typeof input.checkpointVersion !== "string" ||
        typeof input.executionVersion !== "string" ||
        typeof input.instrumentPolicyVersion !== "string" ||
        typeof input.occurredAt !== "number") {
      return rejected(state, rejection(
        "MALFORMED_INPUT",
        "Execution checkpoint payload is malformed.",
        input.inputId,
      ));
    }
    try {
      return applyExecutionCheckpoint(state, input);
    } catch {
      return rejected(state, rejection(
        "MALFORMED_INPUT",
        "Execution checkpoint payload is malformed.",
        input.inputId,
      ));
    }
  }
  if (typeof input.occurredAt !== "number" ||
      !isRecord(input.scope) || input.symbol !== "BTCUSDT") {
    return rejected(state, rejection(
      "MALFORMED_INPUT", "Day boundary input is malformed.",
      input.inputId));
  }
  try {
    return applyDayBoundary(state, input, definition);
  } catch {
    return rejected(state, rejection(
      "MALFORMED_INPUT",
      "Day boundary payload is malformed.",
      input.inputId,
    ));
  }
}

