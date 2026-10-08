import { UTC_DAY_MILLISECONDS } from "../domain/calendar";
import {
  formatScaledDecimal,
  moneyFromAtoms,
  moneyFromDecimal,
  multiplyMoneyByPpm,
  ppmFromRate,
  roundDivideHalfEven,
} from "../domain/money";
import type {
  ActiveDaysRule,
  ChallengeRule,
  InactivityRule,
  InstantMs,
  LeverageRule,
  LossRule,
  Money,
  ProfitTargetRule,
  ProfitableDaysRule,
} from "../domain/types";
import type { ChallengeAccountState } from "../accounting/types";
import type {
  ActiveDaysRuleEvaluation,
  ChallengeHealth,
  InactivityRuleEvaluation,
  LeverageRuleEvaluation,
  LossRuleEvaluation,
  ProfitTargetRuleEvaluation,
  ProfitableDaysRuleEvaluation,
  RuleEvaluation,
  RuleStatus,
} from "./types";

const zeroMoney = (): Money => moneyFromAtoms(BigInt(0));
const maxMoney = (value: bigint): Money =>
  moneyFromAtoms(value < BigInt(0) ? BigInt(0) : value);

function allowanceMoney(
  allowance: LossRule["allowance"] | ProfitTargetRule["amount"],
  phaseStartingCash: Money,
): Money {
  if (allowance.kind === "absolute") {
    return moneyFromDecimal(allowance.amount);
  }
  if (allowance.basis !== "phaseStartingCash") {
    throw new RangeError("Unsupported Challenge allowance basis.");
  }
  return multiplyMoneyByPpm(phaseStartingCash, ppmFromRate(allowance.rate));
}

function ratioText(numerator: bigint, denominator: bigint) {
  if (denominator <= BigInt(0)) {
    throw new RangeError("Rule ratio denominator must be positive.");
  }
  return formatScaledDecimal(
    roundDivideHalfEven(numerator * BigInt(1_000_000), denominator),
    6,
  );
}

function atOrAboveRate(
  amount: Money,
  allowance: Money,
  rate: string,
): boolean {
  return amount * BigInt(1_000_000) >= allowance * ppmFromRate(rate);
}

export function assertSupportedRule(rule: unknown): asserts rule is ChallengeRule {
  if (typeof rule !== "object" || rule === null || !("kind" in rule)) {
    throw new RangeError("Unsupported Challenge rule contract.");
  }
  const candidate = rule as ChallengeRule;
  switch (candidate.kind) {
    case "loss":
      if (
        candidate.method !== "static" ||
        candidate.observed !== "equity" ||
        candidate.breachAt !== "atOrBelowFloor" ||
        (candidate.window === "daily" && candidate.anchor !== "dayStartCash") ||
        (candidate.window === "phase" && candidate.anchor !== "phaseStartingCash")
      ) {
        throw new RangeError(`Unsupported loss rule "${candidate.id}".`);
      }
      return;
    case "profitTarget":
      if (
        candidate.observed !== "cash" ||
        candidate.reference !== "phaseStartingCash" ||
        candidate.reachedAt !== "atOrAboveTarget"
      ) {
        throw new RangeError(`Unsupported profit-target rule "${candidate.id}".`);
      }
      return;
    case "activeDays":
      if (candidate.qualifiesOn !== "exposureIncreasingFill") {
        throw new RangeError(`Unsupported active-days rule "${candidate.id}".`);
      }
      return;
    case "profitableDays":
      if (
        candidate.pnlBasis !== "feeCompleteSettledPnl" ||
        candidate.finalization !== "dayClose" ||
        candidate.requireActiveDay !== true
      ) {
        throw new RangeError(`Unsupported profitable-days rule "${candidate.id}".`);
      }
      return;
    case "inactivity":
      if (
        candidate.clock !== "elapsedUtcDays" ||
        candidate.qualifiesOn !== "exposureIncreasingFill" ||
        candidate.deadlineAt !== "inclusive"
      ) {
        throw new RangeError(`Unsupported inactivity rule "${candidate.id}".`);
      }
      return;
    case "leverage":
      if (
        candidate.enforcementPoint !== "exposureAdmission" ||
        candidate.reductionsAlwaysPermitted !== true
      ) {
        throw new RangeError(`Unsupported leverage rule "${candidate.id}".`);
      }
      return;
    default:
      throw new RangeError("Unsupported Challenge rule kind.");
  }
}

export function evaluateLossRule(
  rule: LossRule,
  account: ChallengeAccountState,
  previous: RuleEvaluation | undefined,
): LossRuleEvaluation {
  assertSupportedRule(rule);
  const allowance = allowanceMoney(rule.allowance, account.phaseStartingCash);
  if (allowance <= BigInt(0)) {
    throw new RangeError(`Loss rule "${rule.id}" requires a positive allowance.`);
  }
  const anchor = rule.window === "daily"
    ? account.day.dayStartCash
    : account.phaseStartingCash;
  const floor = moneyFromAtoms(anchor - allowance);
  const observed = account.equity;
  const consumedAmount = maxMoney(anchor - observed);
  const headroom = moneyFromAtoms(observed - floor);

  let status: RuleStatus;
  if (!rule.enabled) {
    status = "NOT_APPLICABLE";
  } else if (observed <= floor) {
    status = "BREACHED";
  } else if (atOrAboveRate(
    consumedAmount,
    allowance,
    rule.warnings.dangerConsumed,
  )) {
    status = "DANGER";
  } else if (atOrAboveRate(
    consumedAmount,
    allowance,
    rule.warnings.warningConsumed,
  )) {
    status = "WARNING";
  } else {
    const wasArmed = previous?.status === "WARNING" ||
      previous?.status === "DANGER";
    status = wasArmed && atOrAboveRate(
      consumedAmount,
      allowance,
      rule.warnings.rearmBelow,
    ) ? "WARNING" : "SAFE";
  }

  return {
    ruleId: rule.id,
    kind: "loss",
    enforcement: rule.enforcement,
    status,
    window: rule.window,
    observedMetric: "equity",
    allowance,
    floor,
    observed,
    headroom,
    consumedAmount,
    consumptionRatio: ratioText(consumedAmount, allowance),
  };
}

export function evaluateProfitTargetRule(
  rule: ProfitTargetRule,
  account: ChallengeAccountState,
): ProfitTargetRuleEvaluation {
  assertSupportedRule(rule);
  const targetAmount = allowanceMoney(rule.amount, account.phaseStartingCash);
  const requiredCash = moneyFromAtoms(account.phaseStartingCash + targetAmount);
  const reached = rule.enabled && account.cashBalance >= requiredCash;
  return {
    ruleId: rule.id,
    kind: "profitTarget",
    enforcement: rule.enforcement,
    status: !rule.enabled ? "NOT_APPLICABLE" : reached ? "PASSED" : "SAFE",
    observedMetric: "cash",
    targetAmount,
    requiredCash,
    currentCash: account.cashBalance,
    remaining: maxMoney(requiredCash - account.cashBalance),
    reached,
    progress: ratioText(
      account.cashBalance - account.phaseStartingCash,
      targetAmount,
    ),
  };
}

export function evaluateActiveDaysRule(
  rule: ActiveDaysRule,
  dayIds: ActiveDaysRuleEvaluation["dayIds"],
): ActiveDaysRuleEvaluation {
  assertSupportedRule(rule);
  const completed = dayIds.length;
  return {
    ruleId: rule.id,
    kind: "activeDays",
    enforcement: rule.enforcement,
    status: !rule.enabled
      ? "NOT_APPLICABLE"
      : completed >= rule.required ? "PASSED" : "SAFE",
    required: rule.required,
    completed,
    remaining: Math.max(0, rule.required - completed),
    dayIds: [...dayIds],
  };
}

export function evaluateProfitableDaysRule(
  rule: ProfitableDaysRule,
  dayIds: ProfitableDaysRuleEvaluation["dayIds"],
  phaseStartingCash: Money,
): ProfitableDaysRuleEvaluation {
  assertSupportedRule(rule);
  const threshold = allowanceMoney(rule.threshold, phaseStartingCash);
  const completed = dayIds.length;
  return {
    ruleId: rule.id,
    kind: "profitableDays",
    enforcement: rule.enforcement,
    status: !rule.enabled
      ? "NOT_APPLICABLE"
      : completed >= rule.required ? "PASSED" : "SAFE",
    required: rule.required,
    completed,
    remaining: Math.max(0, rule.required - completed),
    threshold,
    dayIds: [...dayIds],
  };
}

export function evaluateInactivityRule(
  rule: InactivityRule,
  reference: InactivityRuleEvaluation["lastQualifyingActivity"],
  evaluatedAt: InactivityRuleEvaluation["evaluatedAt"],
): InactivityRuleEvaluation {
  assertSupportedRule(rule);
  const duration = rule.limitDays * UTC_DAY_MILLISECONDS;
  if (!Number.isSafeInteger(duration)) {
    throw new RangeError(`Inactivity rule "${rule.id}" duration is unsafe.`);
  }
  const deadline = (reference + duration) as InstantMs;
  const breached = rule.enabled && evaluatedAt >= deadline;
  return {
    ruleId: rule.id,
    kind: "inactivity",
    enforcement: rule.enforcement,
    status: !rule.enabled ? "NOT_APPLICABLE" : breached ? "BREACHED" : "SAFE",
    limitDays: rule.limitDays,
    lastQualifyingActivity: reference,
    deadline,
    evaluatedAt,
    remainingDurationMs: Math.max(0, deadline - evaluatedAt),
    breached,
  };
}

export function evaluateLeverageRule(
  rule: LeverageRule,
): LeverageRuleEvaluation {
  assertSupportedRule(rule);
  return {
    ruleId: rule.id,
    kind: "leverage",
    enforcement: rule.enforcement,
    status: "NOT_APPLICABLE",
    configuredMaximum: rule.maximum,
    enforcementPoint: "exposureAdmission",
  };
}

export function healthFromRules(
  evaluations: readonly RuleEvaluation[],
): ChallengeHealth {
  const riskStatuses = evaluations
    .filter((evaluation) =>
      evaluation.kind === "loss" || evaluation.kind === "inactivity")
    .map((evaluation) => evaluation.status);
  if (riskStatuses.includes("BREACHED")) return "BREACHED";
  if (riskStatuses.includes("DANGER")) return "DANGER";
  if (riskStatuses.includes("WARNING")) return "WARNING";
  return "SAFE";
}

export const noMoney = zeroMoney;
