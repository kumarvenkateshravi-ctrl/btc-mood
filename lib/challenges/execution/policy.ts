import { validateInstrumentOrderValues } from "../domain/configSchema";
import {
  decimalText,
  formatScaledDecimal,
  moneyFromAtoms,
  moneyFromRatio,
  multiplyMoneyByPpm,
  normalizeDecimalText,
  parseScaledDecimal,
  ppmFromRate,
  roundDivideHalfEven,
  USD_MICRO_SCALE,
} from "../domain/money";
import type {
  BtcQuantity,
  DecimalText,
  InstrumentPolicy,
  Money,
} from "../domain/types";
import type {
  CommandId,
  ExecutionPolicyVersion,
  FactId,
  FillId,
  LifecycleId,
  PositionId,
  ReservationId,
  WorkingOrderId,
} from "./types";

const EXECUTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const LEVERAGE_SCALE = 6;

function brandedExecutionId<T extends string>(value: string, name: string): T {
  if (!EXECUTION_ID.test(value)) {
    throw new TypeError(`${name} must be 1-128 characters using letters, digits, '.', '_', ':', or '-'.`);
  }
  return value as T;
}

export const commandId = (value: string): CommandId =>
  brandedExecutionId<CommandId>(value, "CommandId");
export const factId = (value: string): FactId =>
  brandedExecutionId<FactId>(value, "FactId");
export const fillId = (value: string): FillId =>
  brandedExecutionId<FillId>(value, "FillId");
export const positionId = (value: string): PositionId =>
  brandedExecutionId<PositionId>(value, "PositionId");
export const lifecycleId = (value: string): LifecycleId =>
  brandedExecutionId<LifecycleId>(value, "LifecycleId");
export const workingOrderId = (value: string): WorkingOrderId =>
  brandedExecutionId<WorkingOrderId>(value, "WorkingOrderId");
export const reservationId = (value: string): ReservationId =>
  brandedExecutionId<ReservationId>(value, "ReservationId");
export const executionPolicyVersion = (value: string): ExecutionPolicyVersion =>
  brandedExecutionId<ExecutionPolicyVersion>(value, "ExecutionPolicyVersion");

function tenTo(scale: number): bigint {
  return BigInt(10) ** BigInt(scale);
}

function fractionDigits(value: string): number {
  return normalizeDecimalText(value).split(".")[1]?.length ?? 0;
}

function parsePositiveAtScale(value: string, scale: number, name: string): bigint {
  const result = parseScaledDecimal(value, scale);
  if (result <= BigInt(0)) throw new RangeError(`${name} must be positive.`);
  return result;
}

export function priceAtoms(policy: InstrumentPolicy, value: string): bigint {
  return parsePositiveAtScale(value, policy.priceScale, "Price");
}

export function quantityAtoms(policy: InstrumentPolicy, value: string): BtcQuantity {
  return parsePositiveAtScale(value, policy.quantityScale, "Quantity") as BtcQuantity;
}

export function priceFromAtoms(policy: InstrumentPolicy, value: bigint): DecimalText {
  return formatScaledDecimal(value, policy.priceScale);
}

export function quantityFromAtoms(policy: InstrumentPolicy, value: bigint): DecimalText {
  return formatScaledDecimal(value, policy.quantityScale);
}

export function validateUserOrderValues(
  policy: InstrumentPolicy,
  input: { price: string; quantity: string },
): { price: DecimalText; quantity: DecimalText } {
  const result = validateInstrumentOrderValues(policy, input);
  if (!result.ok) {
    const error = new RangeError(result.issues.map((issue) => `${issue.code}:${issue.field}`).join(","));
    Object.assign(error, { issues: result.issues });
    throw error;
  }
  return {
    price: decimalText(result.price),
    quantity: decimalText(result.quantity),
  };
}

export function validateUserGridPrice(
  policy: InstrumentPolicy,
  value: string,
): DecimalText {
  const normalized = normalizeDecimalText(value);
  const price = priceAtoms(policy, normalized);
  const tick = priceAtoms(policy, policy.priceTick);
  if (price % tick !== BigInt(0)) {
    throw new RangeError(`OFF_TICK:price must align to ${policy.priceTick}.`);
  }
  return decimalText(normalized);
}

function derivedPriceAtScale(
  policy: InstrumentPolicy,
  rawValue: string,
  side: "buy" | "sell",
  adverseTicks: number,
): DecimalText {
  if (!Number.isInteger(adverseTicks) || adverseTicks < 0) {
    throw new RangeError("Adverse ticks must be a non-negative integer.");
  }
  const normalized = normalizeDecimalText(rawValue);
  const calculationScale = Math.max(policy.priceScale, fractionDigits(normalized));
  const raw = parsePositiveAtScale(normalized, calculationScale, "Derived price");
  const tick = parsePositiveAtScale(policy.priceTick, calculationScale, "Price tick");
  const shifted = side === "buy"
    ? raw + BigInt(adverseTicks) * tick
    : raw - BigInt(adverseTicks) * tick;
  if (shifted <= BigInt(0)) throw new RangeError("Derived price must remain positive.");

  const gridUnits = side === "buy"
    ? (shifted + tick - BigInt(1)) / tick
    : shifted / tick;
  return formatScaledDecimal(gridUnits * tick, calculationScale);
}

export function normalizeDerivedPrice(
  policy: InstrumentPolicy,
  rawValue: string,
  adverseSide: "buy" | "sell",
): DecimalText {
  return derivedPriceAtScale(policy, rawValue, adverseSide, 0);
}

export function marketPriceWithSlippage(
  policy: InstrumentPolicy,
  observedPrice: string,
  side: "buy" | "sell",
  slippageTicks: number,
): DecimalText {
  return derivedPriceAtScale(policy, observedPrice, side, slippageTicks);
}

export function normalizeDerivedQuantity(
  policy: InstrumentPolicy,
  rawValue: string,
): DecimalText {
  const normalized = normalizeDecimalText(rawValue);
  const calculationScale = Math.max(policy.quantityScale, fractionDigits(normalized));
  const raw = parsePositiveAtScale(normalized, calculationScale, "Derived quantity");
  const step = parsePositiveAtScale(policy.quantityStep, calculationScale, "Quantity step");
  const normalizedAtoms = (raw / step) * step;
  if (normalizedAtoms <= BigInt(0)) {
    throw new RangeError("Derived quantity rounds below one executable step.");
  }
  return formatScaledDecimal(normalizedAtoms, calculationScale);
}

export function notionalFor(
  policy: InstrumentPolicy,
  price: string,
  quantity: string,
): Money {
  const priceValue = priceAtoms(policy, price);
  const quantityValue = quantityAtoms(policy, quantity);
  return moneyFromRatio(
    priceValue * quantityValue * tenTo(USD_MICRO_SCALE),
    tenTo(policy.priceScale + policy.quantityScale),
  );
}

export function commissionFor(notional: Money, commissionRate: string): Money {
  return multiplyMoneyByPpm(notional, ppmFromRate(commissionRate));
}

export function marginFor(
  notional: Money,
  leverage: string,
): Money {
  const leverageAtoms = parsePositiveAtScale(leverage, LEVERAGE_SCALE, "Leverage");
  return moneyFromRatio(notional * tenTo(LEVERAGE_SCALE), leverageAtoms);
}

export function leverageIsAtMost(
  leverage: string,
  maximum: string,
): boolean {
  const actual = parsePositiveAtScale(leverage, LEVERAGE_SCALE, "Leverage");
  const limit = parsePositiveAtScale(maximum, LEVERAGE_SCALE, "Maximum leverage");
  return actual <= limit;
}

export function allocateProportional(
  total: Money,
  partQuantity: bigint,
  wholeQuantity: bigint,
  finalAllocation: boolean,
): Money {
  if (wholeQuantity <= BigInt(0) || partQuantity <= BigInt(0) || partQuantity > wholeQuantity) {
    throw new RangeError("Allocation quantities must satisfy 0 < part <= whole.");
  }
  return finalAllocation
    ? total
    : moneyFromAtoms(roundDivideHalfEven(total * partQuantity, wholeQuantity));
}

export function averageEntryPrice(
  policy: InstrumentPolicy,
  costBasis: Money,
  quantity: string,
): DecimalText {
  const quantityValue = quantityAtoms(policy, quantity);
  const numerator = costBasis * tenTo(policy.priceScale + policy.quantityScale);
  const denominator = quantityValue * tenTo(USD_MICRO_SCALE);
  return priceFromAtoms(policy, roundDivideHalfEven(numerator, denominator));
}

export function grossPnlForClose(
  side: "long" | "short",
  exitNotional: Money,
  allocatedCostBasis: Money,
): Money {
  return moneyFromAtoms(
    side === "long"
      ? exitNotional - allocatedCostBasis
      : allocatedCostBasis - exitNotional,
  );
}

export function zeroMoney(): Money {
  return moneyFromAtoms(BigInt(0));
}
