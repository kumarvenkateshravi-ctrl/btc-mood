import { decimalText, moneyFromAtoms, normalizeDecimalText } from "../domain/money";
import type { DecimalText, ExecutionScope, Money } from "../domain/types";
import { deepFreeze } from "../domain/versions";
import {
  allocateProportional, averageEntryPrice, commissionFor, executionPolicyVersion,
  factId, fillId, grossPnlForClose, leverageIsAtMost, marginFor,
  marketPriceWithSlippage, normalizeDerivedPrice, notionalFor, priceAtoms,
  priceFromAtoms, quantityAtoms, quantityFromAtoms, validateUserGridPrice,
  validateUserOrderValues, zeroMoney,
} from "./policy";
import type {
  CanonicalFill, ChallengeExecutionEnvironment, ExecutionCommand, ExecutionFact,
  ExecutionRejection, ExecutionRejectionCode, ExecutionResult, ExecutionState,
  FillReason, FillSide, LifecycleId, MarginState, PositionId, PositionSide,
  PositionState, ProtectionInput, ProtectionState, ReservationState,
  WorkingEntryOrder,
} from "./types";

type BaseKey = "factId" | "sequence" | "commandId" | "scope" | "symbol" |
  "occurredAt" | "executionPolicyVersion";
type FactPayload = ExecutionFact extends infer F
  ? F extends ExecutionFact ? Omit<F, BaseKey> : never : never;

interface FillRequest {
  side: FillSide;
  quantity: DecimalText;
  fillPrice: DecimalText;
  leverage: string;
  availableMarginForAdmission: Money;
  reason: FillReason;
  newPositionId?: PositionId;
  newLifecycleId?: LifecycleId;
  protection?: ProtectionInput | null;
}
type ProtectionResult =
  | { ok: true; value: ProtectionState }
  | { ok: false; message: string; field: string };

class FactWriter {
  readonly facts: ExecutionFact[] = [];
  private sequence: number;
  private local = 1;
  constructor(
    readonly command: ExecutionCommand,
    readonly environment: ChallengeExecutionEnvironment,
    firstSequence: number,
  ) { this.sequence = firstSequence; }
  add(payload: FactPayload): void {
    this.facts.push({
      factId: factId(String(this.command.commandId) + ":fact:" + this.local),
      sequence: this.sequence,
      commandId: this.command.commandId,
      scope: cloneScope(this.command.scope),
      symbol: this.command.symbol,
      occurredAt: this.command.occurredAt,
      executionPolicyVersion: executionPolicyVersion(
        this.environment.executionPolicy.policyVersion),
      ...payload,
    } as ExecutionFact);
    this.local += 1; this.sequence += 1;
  }
  get nextSequence(): number { return this.sequence; }
}

function cloneScope(scope: ExecutionScope): ExecutionScope {
  return scope.mode === "live" ? { ...scope } : {
    mode: "replay", accountId: scope.accountId, challengeId: scope.challengeId,
    phaseId: scope.phaseId, generation: scope.generation,
    replaySessionId: scope.replaySessionId, branchId: scope.branchId,
    datasetHash: scope.datasetHash,
  };
}
function sameScope(a: ExecutionScope, b: ExecutionScope): boolean {
  if (a.mode !== b.mode || a.accountId !== b.accountId ||
      a.challengeId !== b.challengeId || a.phaseId !== b.phaseId ||
      a.generation !== b.generation) return false;
  if (a.mode === "live" && b.mode === "live") return true;
  return a.mode === "replay" && b.mode === "replay" &&
    a.replaySessionId === b.replaySessionId &&
    a.branchId === b.branchId && a.datasetHash === b.datasetHash;
}
const addMoney = (a: Money, b: Money): Money => moneyFromAtoms(a + b);
const subMoney = (a: Money, b: Money): Money => moneyFromAtoms(a - b);
const zeroProtection = (): ProtectionState => ({
  stopLoss: null, takeProfit: null, trailingEnabled: false,
  trailingDistance: null, trailingBestPrice: null,
});
function freezeState(state: ExecutionState): ExecutionState {
  return deepFreeze({
    ...state, scope: cloneScope(state.scope), margin: { ...state.margin },
    position: state.position
      ? { ...state.position, protection: { ...state.position.protection } }
      : null,
    reservations: state.reservations.map((x) => ({ ...x })),
    workingOrders: state.workingOrders.map((x) => ({
      ...x, protection: x.protection ? { ...x.protection } : null,
    })),
    processedCommandIds: [...state.processedCommandIds],
  });
}
function assertEnvironment(env: ChallengeExecutionEnvironment): void {
  if (env.instrumentPolicy.symbol !== "BTCUSDT") {
    throw new RangeError("Challenge v1 execution supports BTCUSDT only.");
  }
  if (env.executionPolicy.instrumentPolicyVersion !== env.instrumentPolicy.policyVersion) {
    throw new RangeError("Frozen execution and instrument policies do not match.");
  }
  if (!leverageIsAtMost("1", env.maximumLeverage)) {
    throw new RangeError("Maximum leverage must be at least 1.");
  }
}
export function createExecutionState(
  scope: ExecutionScope, env: ChallengeExecutionEnvironment,
): ExecutionState {
  assertEnvironment(env);
  return freezeState({
    scope: cloneScope(scope), symbol: env.instrumentPolicy.symbol,
    executionPolicyVersion: executionPolicyVersion(env.executionPolicy.policyVersion),
    instrumentPolicyVersion: env.instrumentPolicy.policyVersion,
    position: null, margin: { used: zeroMoney(), reserved: zeroMoney() },
    reservations: [], workingOrders: [], lastObservedPrice: null,
    processedCommandIds: [], nextFactSequence: 1,
  });
}
function reject(
  command: ExecutionCommand, code: ExecutionRejectionCode,
  message: string, field?: string,
): ExecutionRejection {
  return { code, commandId: command.commandId, message, ...(field ? { field } : {}) };
}
function succeed(
  state: ExecutionState, command: ExecutionCommand, writer: FactWriter,
): ExecutionResult {
  const next = freezeState({
    ...state, processedCommandIds: [...state.processedCommandIds, command.commandId],
    nextFactSequence: writer.nextSequence,
  });
  return deepFreeze({ ok: true, state: next, facts: [...writer.facts] });
}
function fail(
  state: ExecutionState, command: ExecutionCommand,
  env: ChallengeExecutionEnvironment, reason: ExecutionRejection,
): ExecutionResult {
  if (reason.code === "DUPLICATE_COMMAND") {
    return deepFreeze({ ok: false, state, facts: [], rejection: reason });
  }
  const writer = new FactWriter(command, env, state.nextFactSequence);
  writer.add({ kind: "CommandRejected", rejection: reason });
  const next = freezeState({
    ...state, processedCommandIds: [...state.processedCommandIds, command.commandId],
    nextFactSequence: writer.nextSequence,
  });
  return deepFreeze({ ok: false, state: next, facts: [...writer.facts], rejection: reason });
}
function validationFailure(
  command: ExecutionCommand, error: unknown, field?: string,
): ExecutionRejection {
  const issue = (error as {
    issues?: readonly { code?: string; field?: string; message?: string }[];
  })?.issues?.[0];
  const raw = issue?.code;
  let code: ExecutionRejectionCode = "INVALID_COMMAND";
  if (raw === "INVALID_DECIMAL") {
    code = issue?.field === "quantity" ? "INVALID_QUANTITY" : "INVALID_PRICE";
  } else if (raw === "INVALID_PRICE" || raw === "INVALID_QUANTITY" ||
      raw === "OFF_TICK" || raw === "OFF_STEP" ||
      raw === "BELOW_MINIMUM_QUANTITY" || raw === "BELOW_MINIMUM_NOTIONAL") {
    code = raw;
  } else if (error instanceof Error && error.message.startsWith("OFF_TICK")) {
    code = "OFF_TICK";
  } else if (field === "price") code = "INVALID_PRICE";
  else if (field === "quantity") code = "INVALID_QUANTITY";
  return reject(command, code,
    issue?.message ?? (error instanceof Error ? error.message : "Validation failed."),
    issue?.field ?? field);
}
function baseFailure(
  state: ExecutionState, command: ExecutionCommand,
  env: ChallengeExecutionEnvironment,
): ExecutionRejection | null {
  try { assertEnvironment(env); } catch (error) {
    return reject(command, "INVALID_COMMAND",
      error instanceof Error ? error.message : "Invalid environment.");
  }
  if (command.symbol !== state.symbol ||
      command.symbol !== env.instrumentPolicy.symbol ||
      !sameScope(command.scope, state.scope) ||
      !Number.isSafeInteger(command.scope.generation) ||
      command.scope.generation < 0) {
    return reject(command, "SCOPE_MISMATCH",
      "Command scope or symbol does not match execution state.", "scope");
  }
  if (state.executionPolicyVersion !== env.executionPolicy.policyVersion ||
      state.instrumentPolicyVersion !== env.instrumentPolicy.policyVersion) {
    return reject(command, "SCOPE_MISMATCH",
      "Execution state is bound to different frozen policies.",
      "executionPolicyVersion");
  }
  return null;
}
function marginFact(
  writer: FactWriter,
  reason: "positionOpened" | "positionIncreased" | "positionReduced" |
    "positionClosed" | "reservationCreated" | "reservationReleased",
  before: MarginState, after: MarginState,
  requiredMargin: Money, releasedMargin: Money,
): void {
  writer.add({ kind: "MarginTransitioned",
    value: { reason, before, after, requiredMargin, releasedMargin } });
}
const entrySide = (side: PositionSide): FillSide => side === "long" ? "buy" : "sell";
const exitSide = (side: PositionSide): FillSide => side === "long" ? "sell" : "buy";
const positionSide = (side: FillSide): PositionSide => side === "buy" ? "long" : "short";

function resolveProtection(
  side: PositionSide, entryPrice: DecimalText, referencePrice: DecimalText,
  before: ProtectionState, input: ProtectionInput,
  env: ChallengeExecutionEnvironment, entering: boolean,
): ProtectionResult {
  const p = env.instrumentPolicy;
  const hasStop = Object.prototype.hasOwnProperty.call(input, "stopLoss");
  const hasTarget = Object.prototype.hasOwnProperty.call(input, "takeProfit");
  const hasTrailing = Object.prototype.hasOwnProperty.call(input, "trailingEnabled");
  let stopLoss = before.stopLoss;
  let takeProfit = before.takeProfit;
  try {
    if (hasStop) stopLoss = input.stopLoss === null
      ? null : validateUserGridPrice(p, input.stopLoss as string);
    if (hasTarget) takeProfit = input.takeProfit === null
      ? null : validateUserGridPrice(p, input.takeProfit as string);
  } catch (error) {
    return { ok: false,
      message: error instanceof Error ? error.message : "Invalid protection.",
      field: hasStop ? "stopLoss" : "takeProfit" };
  }
  const ref = priceAtoms(p, referencePrice);
  const entry = priceAtoms(p, entryPrice);
  const stop = stopLoss ? priceAtoms(p, stopLoss) : null;
  const target = takeProfit ? priceAtoms(p, takeProfit) : null;
  if (stop !== null && ((side === "long" && stop >= ref) ||
      (side === "short" && stop <= ref))) {
    return { ok: false, message: "Stop loss is not on the risk side.",
      field: "stopLoss" };
  }
  if (target !== null && ((side === "long" && target <= ref) ||
      (side === "short" && target >= ref))) {
    return { ok: false, message: "Take profit is not on the favorable side.",
      field: "takeProfit" };
  }
  const trailingEnabled = hasTrailing ? input.trailingEnabled === true :
    before.trailingEnabled;
  if (before.trailingEnabled && stop !== null && before.stopLoss !== null &&
      ((side === "long" && stop < priceAtoms(p, before.stopLoss)) ||
       (side === "short" && stop > priceAtoms(p, before.stopLoss)))) {
    return { ok: false, message: "Active trailing stop cannot be loosened.",
      field: "stopLoss" };
  }
  let trailingDistance = before.trailingDistance;
  let trailingBestPrice = before.trailingBestPrice;
  if (trailingEnabled) {
    if (stop === null || (side === "long" ? stop >= entry : stop <= entry)) {
      return { ok: false,
        message: "Trailing activation requires an initial-risk stop.",
        field: "trailingEnabled" };
    }
    if (!before.trailingEnabled || entering) {
      trailingDistance = priceFromAtoms(p, side === "long" ? entry - stop : stop - entry);
      trailingBestPrice = referencePrice;
    }
  } else {
    trailingDistance = null; trailingBestPrice = null;
  }
  return { ok: true, value: {
    stopLoss, takeProfit, trailingEnabled, trailingDistance, trailingBestPrice,
  } };
}

function identitiesFree(
  state: ExecutionState, positionId: PositionId, lifecycleId: LifecycleId,
): boolean {
  if (state.position?.positionId === positionId ||
      state.position?.lifecycleId === lifecycleId) return false;
  return !state.workingOrders.some(
    (x) => x.newPositionId === positionId || x.newLifecycleId === lifecycleId);
}
function emitFill(
  writer: FactWriter, fill: CanonicalFill, commission: Money,
  classification: "entry" | "exit",
): void {
  writer.add({ kind: "FillCommitted", fill });
  writer.add({ kind: "CommissionAssessed", fillId: fill.fillId,
    classification, amount: commission, ledgerEffect: "debitCash" });
}
function openPosition(
  state: ExecutionState, command: ExecutionCommand, request: FillRequest,
  writer: FactWriter, suffix: string, fixedCommission?: Money,
): { state: ExecutionState } | { rejection: ExecutionRejection } {
  const env = writer.environment;
  if (!request.newPositionId || !request.newLifecycleId) {
    return { rejection: reject(command, "POSITION_ID_REQUIRED",
      "Opening exposure requires explicit position and lifecycle IDs.",
      "newPositionId") };
  }
  if (!identitiesFree(state, request.newPositionId, request.newLifecycleId)) {
    return { rejection: reject(command, "IDENTITY_COLLISION",
      "Position or lifecycle identity is already in use.", "newPositionId") };
  }
  if (!leverageIsAtMost(request.leverage, env.maximumLeverage)) {
    return { rejection: reject(command, "LEVERAGE_EXCEEDED",
      "Requested leverage exceeds the frozen maximum.", "leverage") };
  }
  const notional = notionalFor(env.instrumentPolicy,
    request.fillPrice, request.quantity);
  const requiredMargin = marginFor(notional, request.leverage);
  if (request.availableMarginForAdmission < requiredMargin) {
    return { rejection: reject(command, "INSUFFICIENT_MARGIN",
      "Available admission margin is below required initial margin.",
      "availableMarginForAdmission") };
  }
  const side = positionSide(request.side);
  const protection = resolveProtection(
    side, request.fillPrice, request.fillPrice, zeroProtection(),
    request.protection ?? {}, env, true);
  if ("message" in protection) {
    return { rejection: reject(command, "INVALID_PROTECTION",
      protection.message, protection.field) };
  }
  const commission = fixedCommission ??
    commissionFor(notional, env.executionPolicy.commissionRate);
  const position: PositionState = {
    positionId: request.newPositionId,
    lifecycleId: request.newLifecycleId,
    symbol: command.symbol,
    side,
    quantity: request.quantity,
    entryPrice: request.fillPrice,
    costBasis: notional,
    entryCommissionTotal: commission,
    entryCommissionRemaining: commission,
    leverage: decimalText(request.leverage),
    openedAt: command.occurredAt,
    protection: protection.value,
  };
  const fill: CanonicalFill = {
    fillId: fillId(String(command.commandId) + ":" + suffix),
    positionId: position.positionId,
    lifecycleId: position.lifecycleId,
    side: request.side,
    classification: "entry",
    reason: request.reason,
    quantity: request.quantity,
    price: request.fillPrice,
    notional,
    grossRealizedPnl: zeroMoney(),
  };
  emitFill(writer, fill, commission, "entry");
  const before = state.margin;
  const after = { used: addMoney(before.used, requiredMargin),
    reserved: before.reserved };
  marginFact(writer, "positionOpened", before, after, requiredMargin, zeroMoney());
  writer.add({ kind: "PositionTransitioned", value: {
    transition: "opened", positionBefore: null, positionAfter: position,
    closedQuantity: quantityFromAtoms(env.instrumentPolicy, BigInt(0)),
    lifecycleBoundary: "opened",
  } });
  if (protection.value.stopLoss !== null ||
      protection.value.takeProfit !== null || protection.value.trailingEnabled) {
    writer.add({ kind: "ProtectionChanged", positionId: position.positionId,
      before: zeroProtection(), after: protection.value, source: "entry" });
  }
  return { state: { ...state, position, margin: after } };
}
function increasePosition(
  state: ExecutionState, command: ExecutionCommand, request: FillRequest,
  writer: FactWriter,
): { state: ExecutionState } | { rejection: ExecutionRejection } {
  const env = writer.environment;
  const beforePosition = state.position as PositionState;
  if (!leverageIsAtMost(request.leverage, env.maximumLeverage)) {
    return { rejection: reject(command, "LEVERAGE_EXCEEDED",
      "Requested leverage exceeds the frozen maximum.", "leverage") };
  }
  if (normalizeDecimalText(request.leverage) !== beforePosition.leverage) {
    return { rejection: reject(command, "LEVERAGE_MISMATCH",
      "Position increases must use lifecycle leverage.", "leverage") };
  }
  const notional = notionalFor(env.instrumentPolicy,
    request.fillPrice, request.quantity);
  const requiredMargin = marginFor(notional, request.leverage);
  if (request.availableMarginForAdmission < requiredMargin) {
    return { rejection: reject(command, "INSUFFICIENT_MARGIN",
      "Available admission margin is below increase margin.",
      "availableMarginForAdmission") };
  }
  const commission = commissionFor(notional, env.executionPolicy.commissionRate);
  const quantity = quantityFromAtoms(env.instrumentPolicy,
    quantityAtoms(env.instrumentPolicy, beforePosition.quantity) +
    quantityAtoms(env.instrumentPolicy, request.quantity));
  const costBasis = addMoney(beforePosition.costBasis, notional);
  const afterPosition: PositionState = {
    ...beforePosition,
    quantity,
    entryPrice: averageEntryPrice(env.instrumentPolicy, costBasis, quantity),
    costBasis,
    entryCommissionTotal: addMoney(beforePosition.entryCommissionTotal, commission),
    entryCommissionRemaining: addMoney(
      beforePosition.entryCommissionRemaining, commission),
  };
  emitFill(writer, {
    fillId: fillId(String(command.commandId) + ":fill"),
    positionId: beforePosition.positionId,
    lifecycleId: beforePosition.lifecycleId,
    side: request.side,
    classification: "increase",
    reason: request.reason,
    quantity: request.quantity,
    price: request.fillPrice,
    notional,
    grossRealizedPnl: zeroMoney(),
  }, commission, "entry");
  const before = state.margin;
  const after = { used: addMoney(before.used, requiredMargin),
    reserved: before.reserved };
  marginFact(writer, "positionIncreased", before, after, requiredMargin, zeroMoney());
  writer.add({ kind: "PositionTransitioned", value: {
    transition: "increased", positionBefore: beforePosition,
    positionAfter: afterPosition,
    closedQuantity: quantityFromAtoms(env.instrumentPolicy, BigInt(0)),
    lifecycleBoundary: "none",
  } });
  return { state: { ...state, position: afterPosition, margin: after } };
}
function closeQuantity(
  state: ExecutionState, command: ExecutionCommand, request: FillRequest,
  writer: FactWriter, closeAtoms: bigint, closeCommission: Money, suffix: string,
): ExecutionState {
  const env = writer.environment;
  const beforePosition = state.position as PositionState;
  const wholeAtoms = quantityAtoms(env.instrumentPolicy, beforePosition.quantity);
  const finalAllocation = closeAtoms === wholeAtoms;
  const quantity = quantityFromAtoms(env.instrumentPolicy, closeAtoms);
  const allocatedCost = allocateProportional(
    beforePosition.costBasis, closeAtoms, wholeAtoms, finalAllocation);
  const allocatedEntryFee = allocateProportional(
    beforePosition.entryCommissionRemaining,
    closeAtoms, wholeAtoms, finalAllocation);
  const exitNotional = notionalFor(env.instrumentPolicy,
    request.fillPrice, quantity);
  const closeFillId = fillId(String(command.commandId) + ":" + suffix);
  emitFill(writer, {
    fillId: closeFillId,
    positionId: beforePosition.positionId,
    lifecycleId: beforePosition.lifecycleId,
    side: request.side,
    classification: "exit",
    reason: request.reason,
    quantity,
    price: request.fillPrice,
    notional: exitNotional,
    grossRealizedPnl: grossPnlForClose(
      beforePosition.side, exitNotional, allocatedCost),
  }, closeCommission, "exit");
  const remainingAtoms = wholeAtoms - closeAtoms;
  const afterPosition: PositionState | null = remainingAtoms === BigInt(0)
    ? null : {
      ...beforePosition,
      quantity: quantityFromAtoms(env.instrumentPolicy, remainingAtoms),
      costBasis: subMoney(beforePosition.costBasis, allocatedCost),
      entryCommissionRemaining: subMoney(
        beforePosition.entryCommissionRemaining, allocatedEntryFee),
    };
  writer.add({ kind: "EntryFeeAllocated",
    positionId: beforePosition.positionId,
    lifecycleId: beforePosition.lifecycleId,
    closeFillId,
    allocatedAmount: allocatedEntryFee,
    remainingAmount: afterPosition?.entryCommissionRemaining ?? zeroMoney(),
    finalAllocation,
    ledgerEffect: "none",
  });
  writer.add({ kind: "PositionTransitioned", value: {
    transition: afterPosition ? "reduced" : "closed",
    positionBefore: beforePosition,
    positionAfter: afterPosition,
    closedQuantity: quantity,
    lifecycleBoundary: afterPosition ? "none" : "closed",
  } });
  const releasedMargin = allocateProportional(
    state.margin.used, closeAtoms, wholeAtoms, finalAllocation);
  const before = state.margin;
  const after = { used: subMoney(before.used, releasedMargin),
    reserved: before.reserved };
  marginFact(writer, afterPosition ? "positionReduced" : "positionClosed",
    before, after, zeroMoney(), releasedMargin);
  return { ...state, position: afterPosition, margin: after };
}
function executeFill(
  state: ExecutionState, command: ExecutionCommand, request: FillRequest,
  writer: FactWriter,
): { state: ExecutionState } | { rejection: ExecutionRejection } {
  const env = writer.environment;
  if (!state.position) return openPosition(state, command, request, writer, "fill");
  if (entrySide(state.position.side) === request.side) {
    return increasePosition(state, command, request, writer);
  }
  const incomingAtoms = quantityAtoms(env.instrumentPolicy, request.quantity);
  const positionAtoms = quantityAtoms(env.instrumentPolicy, state.position.quantity);
  const closeAtoms = incomingAtoms < positionAtoms ? incomingAtoms : positionAtoms;
  const residualAtoms = incomingAtoms - closeAtoms;
  const closeQuantityValue = quantityFromAtoms(env.instrumentPolicy, closeAtoms);
  const closeCommission = commissionFor(
    notionalFor(env.instrumentPolicy, request.fillPrice, closeQuantityValue),
    env.executionPolicy.commissionRate);
  if (residualAtoms > BigInt(0)) {
    if (!request.newPositionId || !request.newLifecycleId) {
      return { rejection: reject(command, "POSITION_ID_REQUIRED",
        "Reversal requires fresh position and lifecycle IDs.", "newPositionId") };
    }
    if (!identitiesFree(state, request.newPositionId, request.newLifecycleId)) {
      return { rejection: reject(command, "IDENTITY_COLLISION",
        "Reversal IDs must be fresh.", "newPositionId") };
    }
    if (!leverageIsAtMost(request.leverage, env.maximumLeverage)) {
      return { rejection: reject(command, "LEVERAGE_EXCEEDED",
        "Reversal residual exceeds maximum leverage.", "leverage") };
    }
    const residualQuantity = quantityFromAtoms(env.instrumentPolicy, residualAtoms);
    const residualMargin = marginFor(
      notionalFor(env.instrumentPolicy, request.fillPrice, residualQuantity),
      request.leverage);
    if (request.availableMarginForAdmission < residualMargin) {
      return { rejection: reject(command, "INSUFFICIENT_MARGIN",
        "Insufficient margin for reversal residual.",
        "availableMarginForAdmission") };
    }
    const protection = resolveProtection(
      positionSide(request.side), request.fillPrice, request.fillPrice,
      zeroProtection(), request.protection ?? {}, env, true);
    if ("message" in protection) {
      return { rejection: reject(command, "INVALID_PROTECTION",
        protection.message, protection.field) };
    }
  }
  const next = closeQuantity(state, command, request, writer,
    closeAtoms, closeCommission, residualAtoms > BigInt(0) ? "close" : "fill");
  if (residualAtoms === BigInt(0)) return { state: next };
  return openPosition(next, command, {
    ...request,
    quantity: quantityFromAtoms(env.instrumentPolicy, residualAtoms),
    newPositionId: request.newPositionId,
    newLifecycleId: request.newLifecycleId,
    protection: request.protection ?? {},
  }, writer, "open");
}

function releaseReservation(
  state: ExecutionState, order: WorkingEntryOrder, writer: FactWriter,
  reason: "workingOrderFilled" | "cancelled" | "oco",
): ExecutionState {
  const reservation = state.reservations.find(
    (x) => x.reservationId === order.reservationId);
  if (!reservation) return state;
  writer.add({ kind: "ReservationTransitioned", value: {
    transition: "released", reservation, reason,
  } });
  const before = state.margin;
  const after = { used: before.used,
    reserved: subMoney(before.reserved, reservation.requiredMargin) };
  marginFact(writer, "reservationReleased", before, after,
    zeroMoney(), reservation.requiredMargin);
  return {
    ...state, margin: after,
    reservations: state.reservations.filter(
      (x) => x.reservationId !== reservation.reservationId),
    workingOrders: state.workingOrders.filter(
      (x) => x.orderId !== order.orderId),
  };
}
function cancelOrder(
  state: ExecutionState, order: WorkingEntryOrder, writer: FactWriter,
  reason: "user" | "oco" | "administrative",
): ExecutionState {
  writer.add({ kind: "WorkingOrderCancelled", orderId: order.orderId, reason });
  return releaseReservation(state, order, writer,
    reason === "oco" ? "oco" : "cancelled");
}
function processMarket(
  state: ExecutionState,
  command: Extract<ExecutionCommand, { kind: "marketOrder" }>,
  env: ChallengeExecutionEnvironment,
): ExecutionResult {
  let values: { price: DecimalText; quantity: DecimalText };
  try {
    values = validateUserOrderValues(env.instrumentPolicy, {
      price: marketPriceWithSlippage(
        env.instrumentPolicy, command.observedPrice, command.side,
        env.executionPolicy.marketSlippageTicks),
      quantity: command.quantity,
    });
  } catch (error) {
    return fail(state, command, env, validationFailure(command, error));
  }
  const writer = new FactWriter(command, env, state.nextFactSequence);
  let outcome: ReturnType<typeof executeFill>;
  try {
    outcome = executeFill(state, command, {
      side: command.side,
      quantity: values.quantity,
      fillPrice: values.price,
      leverage: command.leverage,
      availableMarginForAdmission: command.availableMarginForAdmission,
      reason: command.reason,
      newPositionId: command.newPositionId,
      newLifecycleId: command.newLifecycleId,
      protection: command.protection,
    }, writer);
  } catch (error) {
    return fail(state, command, env, validationFailure(command, error));
  }
  if ("rejection" in outcome) return fail(state, command, env, outcome.rejection);
  return succeed(outcome.state, command, writer);
}
function processProtection(
  state: ExecutionState,
  command: Extract<ExecutionCommand, { kind: "updateProtection" }>,
  env: ChallengeExecutionEnvironment,
): ExecutionResult {
  if (!state.position) {
    return fail(state, command, env,
      reject(command, "POSITION_REQUIRED", "Protection requires a position."));
  }
  if (!Object.prototype.hasOwnProperty.call(command.update, "stopLoss") &&
      !Object.prototype.hasOwnProperty.call(command.update, "takeProfit") &&
      !Object.prototype.hasOwnProperty.call(command.update, "trailingEnabled")) {
    return fail(state, command, env,
      reject(command, "INVALID_PROTECTION",
        "Protection update must specify a field.", "update"));
  }
  const resolved = resolveProtection(
    state.position.side, state.position.entryPrice,
    state.lastObservedPrice ?? state.position.entryPrice,
    state.position.protection, command.update, env, false);
  if ("message" in resolved) {
    return fail(state, command, env,
      reject(command, "INVALID_PROTECTION", resolved.message, resolved.field));
  }
  const writer = new FactWriter(command, env, state.nextFactSequence);
  writer.add({ kind: "ProtectionChanged",
    positionId: state.position.positionId,
    before: state.position.protection, after: resolved.value, source: "command" });
  return succeed({ ...state, position: {
    ...state.position, protection: resolved.value,
  } }, command, writer);
}
function processPlaceWorking(
  state: ExecutionState,
  command: Extract<ExecutionCommand, { kind: "placeWorkingEntry" }>,
  env: ChallengeExecutionEnvironment,
): ExecutionResult {
  if (state.position) {
    return fail(state, command, env,
      reject(command, "WORKING_ENTRY_REQUIRES_FLAT",
        "Working entries require a flat account."));
  }
  if (state.workingOrders.some((x) =>
      x.orderId === command.orderId ||
      x.reservationId === command.reservationId ||
      x.newPositionId === command.newPositionId ||
      x.newLifecycleId === command.newLifecycleId)) {
    return fail(state, command, env,
      reject(command, "IDENTITY_COLLISION",
        "Working-order identity is already in use."));
  }
  let values: { price: DecimalText; quantity: DecimalText };
  let expectedFillPrice: DecimalText;
  try {
    values = validateUserOrderValues(env.instrumentPolicy, {
      price: command.triggerPrice, quantity: command.quantity,
    });
    expectedFillPrice = command.orderType === "limit" ? values.price :
      marketPriceWithSlippage(env.instrumentPolicy, values.price,
        command.side, env.executionPolicy.marketSlippageTicks);
  } catch (error) {
    return fail(state, command, env, validationFailure(command, error));
  }
  if (!leverageIsAtMost(command.leverage, env.maximumLeverage)) {
    return fail(state, command, env,
      reject(command, "LEVERAGE_EXCEEDED",
        "Working entry exceeds maximum leverage.", "leverage"));
  }
  const requiredMargin = marginFor(
    notionalFor(env.instrumentPolicy, expectedFillPrice, values.quantity),
    command.leverage);
  const protection = resolveProtection(
    positionSide(command.side), expectedFillPrice, expectedFillPrice,
    zeroProtection(), command.protection ?? {}, env, true);
  if ("message" in protection) {
    return fail(state, command, env,
      reject(command, "INVALID_PROTECTION", protection.message, protection.field));
  }
  if (command.availableMarginForAdmission < requiredMargin) {
    return fail(state, command, env,
      reject(command, "INSUFFICIENT_MARGIN",
        "Insufficient margin for reservation.", "availableMarginForAdmission"));
  }
  const order: WorkingEntryOrder = {
    orderId: command.orderId,
    reservationId: command.reservationId,
    side: command.side,
    type: command.orderType,
    quantity: values.quantity,
    triggerPrice: values.price,
    expectedFillPrice,
    leverage: decimalText(command.leverage),
    newPositionId: command.newPositionId,
    newLifecycleId: command.newLifecycleId,
    protection: command.protection ? { ...command.protection } : null,
    ocoGroupId: command.ocoGroupId ?? null,
  };
  const reservation: ReservationState = {
    reservationId: command.reservationId,
    workingOrderId: command.orderId,
    requiredMargin,
  };
  const writer = new FactWriter(command, env, state.nextFactSequence);
  writer.add({ kind: "WorkingOrderPlaced", order });
  writer.add({ kind: "ReservationTransitioned", value: {
    transition: "created", reservation, reason: "workingOrderPlaced",
  } });
  const before = state.margin;
  const after = { used: before.used,
    reserved: addMoney(before.reserved, requiredMargin) };
  marginFact(writer, "reservationCreated", before, after,
    requiredMargin, zeroMoney());
  return succeed({
    ...state, margin: after,
    reservations: [...state.reservations, reservation],
    workingOrders: [...state.workingOrders, order],
  }, command, writer);
}
function processCancel(
  state: ExecutionState,
  command: Extract<ExecutionCommand, { kind: "cancelWorkingOrder" }>,
  env: ChallengeExecutionEnvironment,
): ExecutionResult {
  const order = state.workingOrders.find((x) => x.orderId === command.orderId);
  if (!order) {
    return fail(state, command, env,
      reject(command, "WORKING_ORDER_NOT_FOUND",
        "Working order does not exist.", "orderId"));
  }
  const writer = new FactWriter(command, env, state.nextFactSequence);
  return succeed(cancelOrder(state, order, writer, command.reason), command, writer);
}

function updateTrailing(
  state: ExecutionState, observed: DecimalText, writer: FactWriter,
  env: ChallengeExecutionEnvironment,
): ExecutionState {
  const position = state.position;
  if (!position || !position.protection.trailingEnabled ||
      !position.protection.trailingDistance ||
      !position.protection.trailingBestPrice ||
      !position.protection.stopLoss) return state;
  const p = env.instrumentPolicy;
  const point = priceAtoms(p, observed);
  const best = priceAtoms(p, position.protection.trailingBestPrice);
  const favorable = position.side === "long" ? point > best : point < best;
  if (!favorable) return state;
  const distance = priceAtoms(p, position.protection.trailingDistance);
  const raw = position.side === "long" ? point - distance : point + distance;
  if (raw <= BigInt(0)) return state;
  const candidate = normalizeDerivedPrice(
    p, priceFromAtoms(p, raw), position.side === "long" ? "sell" : "buy");
  const candidateAtoms = priceAtoms(p, candidate);
  const oldStop = priceAtoms(p, position.protection.stopLoss);
  const improves = position.side === "long"
    ? candidateAtoms > oldStop : candidateAtoms < oldStop;
  const after: ProtectionState = {
    ...position.protection,
    stopLoss: improves ? candidate : position.protection.stopLoss,
    trailingBestPrice: observed,
  };
  writer.add({ kind: "ProtectionChanged", positionId: position.positionId,
    before: position.protection, after, source: "trailingUpdate" });
  return { ...state, position: { ...position, protection: after } };
}
function protectionTrigger(
  state: ExecutionState, observed: DecimalText, transition: "gap" | "segment",
  env: ChallengeExecutionEnvironment,
): { price: DecimalText; reason: FillReason } | null {
  const position = state.position;
  if (!position) return null;
  const p = env.instrumentPolicy;
  const point = priceAtoms(p, observed);
  const previous = state.lastObservedPrice
    ? priceAtoms(p, state.lastObservedPrice) : point;
  const stop = position.protection.stopLoss;
  const target = position.protection.takeProfit;
  const stopAtoms = stop ? priceAtoms(p, stop) : null;
  const targetAtoms = target ? priceAtoms(p, target) : null;
  const stopHit = stopAtoms !== null &&
    (position.side === "long" ? point <= stopAtoms : point >= stopAtoms);
  const targetHit = targetAtoms !== null &&
    (position.side === "long" ? point >= targetAtoms : point <= targetAtoms);
  let chooseStop = false;
  let chooseTarget = false;
  if (transition === "gap") {
    chooseStop = stopHit; chooseTarget = !stopHit && targetHit;
  } else if (point < previous) {
    chooseStop = position.side === "long" && stopHit;
    chooseTarget = position.side === "short" && targetHit;
  } else if (point > previous) {
    chooseTarget = position.side === "long" && targetHit;
    chooseStop = position.side === "short" && stopHit;
  } else {
    chooseStop = stopHit; chooseTarget = !stopHit && targetHit;
  }
  if (chooseStop && stop) {
    const beyond = transition === "gap" &&
      (position.side === "long" ? point < (stopAtoms as bigint) :
       point > (stopAtoms as bigint));
    return {
      price: beyond ? normalizeDerivedPrice(p, observed, exitSide(position.side)) : stop,
      reason: position.protection.trailingEnabled ? "trailingStop" : "stopLoss",
    };
  }
  return chooseTarget && target ? { price: target, reason: "takeProfit" } : null;
}
function orderTriggered(
  order: WorkingEntryOrder, observed: DecimalText,
  env: ChallengeExecutionEnvironment,
): boolean {
  const point = priceAtoms(env.instrumentPolicy, observed);
  const trigger = priceAtoms(env.instrumentPolicy, order.triggerPrice);
  if (order.type === "limit") {
    return order.side === "buy" ? point <= trigger : point >= trigger;
  }
  return order.side === "buy" ? point >= trigger : point <= trigger;
}

function processObserve(
  state: ExecutionState,
  command: Extract<ExecutionCommand, { kind: "observePrice" }>,
  env: ChallengeExecutionEnvironment,
): ExecutionResult {
  let observed: DecimalText;
  try {
    observed = normalizeDecimalText(command.price);
    priceAtoms(env.instrumentPolicy, observed);
    if (!Number.isSafeInteger(command.pathIndex) || command.pathIndex < 0) {
      throw new RangeError("Path index must be a non-negative safe integer.");
    }
  } catch (error) {
    return fail(state, command, env,
      validationFailure(command, error, "price"));
  }
  const writer = new FactWriter(command, env, state.nextFactSequence);
  writer.add({ kind: "MarketObserved", price: observed,
    transition: command.transition, pathIndex: command.pathIndex });
  let next = updateTrailing(state, observed, writer, env);
  const trigger = protectionTrigger(next, observed, command.transition, env);
  if (trigger && next.position) {
    const quantity = next.position.quantity;
    const commission = commissionFor(
      notionalFor(env.instrumentPolicy, trigger.price, quantity),
      env.executionPolicy.commissionRate);
    next = closeQuantity(next, command, {
      side: exitSide(next.position.side),
      quantity,
      fillPrice: trigger.price,
      leverage: next.position.leverage,
      availableMarginForAdmission: zeroMoney(),
      reason: trigger.reason,
    }, writer, quantityAtoms(env.instrumentPolicy, quantity),
    commission, "protection");
  }
  next = { ...next, lastObservedPrice: observed };

  if (!next.position) {
    const triggered = [...next.workingOrders]
      .sort((a, b) => {
        const rank = (a.type === "limit" ? 0 : 1) -
          (b.type === "limit" ? 0 : 1);
        return rank || String(a.orderId).localeCompare(String(b.orderId));
      })
      .find((order) => orderTriggered(order, observed, env));
    if (triggered) {
      const reservedMargin = next.reservations.find(
        (x) => x.reservationId === triggered.reservationId
      )?.requiredMargin ?? zeroMoney();
      next = releaseReservation(next, triggered, writer, "workingOrderFilled");
      const opened = openPosition(next, command, {
        side: triggered.side,
        quantity: triggered.quantity,
        fillPrice: triggered.expectedFillPrice,
        leverage: triggered.leverage,
        availableMarginForAdmission: reservedMargin,
        reason: triggered.type === "limit" ? "workingLimit" : "workingStop",
        newPositionId: triggered.newPositionId,
        newLifecycleId: triggered.newLifecycleId,
        protection: triggered.protection,
      }, writer, "working");
      if ("rejection" in opened) {
        throw new Error("Reserved order failed deterministic admission.");
      }
      next = opened.state;
      if (triggered.ocoGroupId) {
        const siblings = [...next.workingOrders]
          .filter((x) => x.ocoGroupId === triggered.ocoGroupId)
          .sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)));
        for (const sibling of siblings) {
          next = cancelOrder(next, sibling, writer, "oco");
        }
      }
    }
  }
  return succeed(next, command, writer);
}

export function reduceExecutionCommand(
  state: ExecutionState,
  command: ExecutionCommand,
  env: ChallengeExecutionEnvironment,
): ExecutionResult {
  if (state.processedCommandIds.includes(command.commandId)) {
    return fail(state, command, env,
      reject(command, "DUPLICATE_COMMAND",
        "Command ID was already processed; retry has no effect.", "commandId"));
  }
  const invalid = baseFailure(state, command, env);
  if (invalid) return fail(state, command, env, invalid);
  switch (command.kind) {
    case "marketOrder": return processMarket(state, command, env);
    case "updateProtection": return processProtection(state, command, env);
    case "placeWorkingEntry": return processPlaceWorking(state, command, env);
    case "cancelWorkingOrder": return processCancel(state, command, env);
    case "observePrice": return processObserve(state, command, env);
  }
}
