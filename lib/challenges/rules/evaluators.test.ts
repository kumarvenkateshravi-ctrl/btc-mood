import { describe, expect, it } from "vitest";
import { initializeChallengeAccount } from "../accounting/ledger";
import { utcInstant } from "../domain/calendar";
import { moneyFromDecimal } from "../domain/money";
import {
  accountId,
  branchId,
  challengeId,
  phaseId,
  replaySessionId,
  type ChallengeRule,
  type ExecutionScope,
} from "../domain/types";
import {
  freezeChallengeDefinition,
  MYCRYPTOSTACK_ONE_STEP_V1,
  MYCRYPTOSTACK_TWO_STEP_V1,
} from "../domain/templates";
import {
  assertSupportedRule,
  evaluateActiveDaysRule,
  evaluateInactivityRule,
  evaluateLeverageRule,
  evaluateLossRule,
  evaluateProfitTargetRule,
  evaluateProfitableDaysRule,
  healthFromRules,
} from "./evaluators";

const start = utcInstant(2026, 1, 1);
const scope: ExecutionScope = {
  mode: "replay",
  challengeId: challengeId("rules-evaluator"),
  accountId: accountId("rules-evaluator-account"),
  phaseId: phaseId("phase-1"),
  generation: 0,
  replaySessionId: replaySessionId("rules-evaluator-replay"),
  branchId: branchId("rules-evaluator-branch"),
  datasetHash: "rules-evaluator-dataset",
};
const oneStep = freezeChallengeDefinition({
  template: MYCRYPTOSTACK_ONE_STEP_V1,
  selectedCapital: "10000",
  selectedSymbol: "BTCUSDT",
  mode: "replay",
});
const twoStep = freezeChallengeDefinition({
  template: MYCRYPTOSTACK_TWO_STEP_V1,
  selectedCapital: "10000",
  selectedSymbol: "BTCUSDT",
  mode: "replay",
});
const base = initializeChallengeAccount({
  definition: oneStep,
  phaseId: "phase-1",
  scope,
  occurredAt: start,
});

function rule<Kind extends ChallengeRule["kind"]>(
  definition: typeof oneStep,
  phase: string,
  kind: Kind,
): Extract<ChallengeRule, { kind: Kind }> {
  const candidate = definition.template.phases
    .find((value) => value.id === phase)?.rules
    .find((value) => value.kind === kind);
  if (!candidate) throw new Error(`Missing ${kind} rule.`);
  return candidate as Extract<ChallengeRule, { kind: Kind }>;
}

function accountAt(equity: string, cash = equity, dayStartCash = "10000") {
  return {
    ...base,
    equity: moneyFromDecimal(equity),
    cashBalance: moneyFromDecimal(cash),
    day: {
      ...base.day,
      dayStartCash: moneyFromDecimal(dayStartCash),
    },
  };
}

describe("Task 4 exact rule evaluators", () => {
  const daily = rule(oneStep, "phase-1", "loss");
  const maximum = oneStep.template.phases[0].rules.find(
    (candidate) => candidate.kind === "loss" && candidate.window === "phase",
  );
  if (!maximum || maximum.kind !== "loss") throw new Error("Missing maximum loss.");

  it("calculates the exact daily allowance and floor", () => {
    const result = evaluateLossRule(daily, accountAt("10000"), undefined);
    expect(result.allowance).toBe(moneyFromDecimal("500"));
    expect(result.floor).toBe(moneyFromDecimal("9500"));
    expect(result.observed).toBe(moneyFromDecimal("10000"));
    expect(result.headroom).toBe(moneyFromDecimal("500"));
  });

  it("breaches daily loss at exact equality", () => {
    expect(evaluateLossRule(daily, accountAt("9500"), undefined).status)
      .toBe("BREACHED");
  });

  it("uses exact SAFE, WARNING, and DANGER boundaries", () => {
    expect(evaluateLossRule(daily, accountAt("9600.000001"), undefined).status)
      .toBe("SAFE");
    expect(evaluateLossRule(daily, accountAt("9600"), undefined).status)
      .toBe("WARNING");
    expect(evaluateLossRule(daily, accountAt("9525"), undefined).status)
      .toBe("DANGER");
    expect(evaluateLossRule(daily, accountAt("9500.000001"), undefined).status)
      .toBe("DANGER");
  });

  it("holds warning until consumption falls below the 75% rearm boundary", () => {
    const warning = evaluateLossRule(daily, accountAt("9600"), undefined);
    expect(evaluateLossRule(daily, accountAt("9610"), warning).status)
      .toBe("WARNING");
    expect(evaluateLossRule(daily, accountAt("9625"), warning).status)
      .toBe("WARNING");
    expect(evaluateLossRule(daily, accountAt("9625.000001"), warning).status)
      .toBe("SAFE");
  });

  it("keeps the maximum-loss floor static and breaches at equality", () => {
    const profitable = evaluateLossRule(maximum, accountAt("11000"), undefined);
    const equality = evaluateLossRule(maximum, accountAt("9000"), profitable);
    expect(profitable.floor).toBe(moneyFromDecimal("9000"));
    expect(equality.floor).toBe(moneyFromDecimal("9000"));
    expect(equality.status).toBe("BREACHED");
  });

  it("calculates phase-one 10% and phase-two 8% cash targets", () => {
    const first = evaluateProfitTargetRule(
      rule(twoStep, "phase-1", "profitTarget"),
      accountAt("10000"),
    );
    const second = evaluateProfitTargetRule(
      rule(twoStep, "phase-2", "profitTarget"),
      accountAt("10000"),
    );
    expect(first.targetAmount).toBe(moneyFromDecimal("1000"));
    expect(first.requiredCash).toBe(moneyFromDecimal("11000"));
    expect(second.targetAmount).toBe(moneyFromDecimal("800"));
    expect(second.requiredCash).toBe(moneyFromDecimal("10800"));
  });

  it("uses cash rather than equity for target completion", () => {
    const result = evaluateProfitTargetRule(
      rule(oneStep, "phase-1", "profitTarget"),
      accountAt("11100", "10900"),
    );
    expect(result.reached).toBe(false);
    expect(result.currentCash).toBe(moneyFromDecimal("10900"));
  });

  it("reaches the profit target at exact cash equality", () => {
    const result = evaluateProfitTargetRule(
      rule(oneStep, "phase-1", "profitTarget"),
      accountAt("11000"),
    );
    expect(result.reached).toBe(true);
    expect(result.status).toBe("PASSED");
    expect(result.remaining).toBe(moneyFromDecimal("0"));
    expect(result.progress).toBe("1");
  });

  it("reports active and profitable achievement progress without risk health", () => {
    const active = evaluateActiveDaysRule(
      rule(oneStep, "phase-1", "activeDays"),
      [base.day.currentDayId],
    );
    const profitable = evaluateProfitableDaysRule(
      rule(oneStep, "phase-1", "profitableDays"),
      [],
      base.phaseStartingCash,
    );
    expect(active.completed).toBe(1);
    expect(active.status).toBe("SAFE");
    expect(profitable.threshold).toBe(moneyFromDecimal("10"));
    expect(healthFromRules([active, profitable])).toBe("SAFE");
  });

  it("breaches inactivity at the exact inclusive 30-day deadline", () => {
    const inactivity = rule(oneStep, "phase-1", "inactivity");
    const before = evaluateInactivityRule(
      inactivity,
      start,
      (start + 30 * 86_400_000 - 1) as typeof start,
    );
    const exact = evaluateInactivityRule(
      inactivity,
      start,
      (start + 30 * 86_400_000) as typeof start,
    );
    expect(before.status).toBe("SAFE");
    expect(before.remainingDurationMs).toBe(1);
    expect(exact.status).toBe("BREACHED");
    expect(exact.remainingDurationMs).toBe(0);
  });

  it("keeps leverage as admission evidence rather than a continuous breach", () => {
    const leverage = evaluateLeverageRule(
      rule(oneStep, "phase-1", "leverage"),
    );
    expect(leverage.configuredMaximum).toBe("20");
    expect(leverage.enforcementPoint).toBe("exposureAdmission");
    expect(leverage.status).toBe("NOT_APPLICABLE");
    expect(healthFromRules([leverage])).toBe("SAFE");
  });

  it("rejects unsupported rule kinds and deferred trailing loss contracts", () => {
    expect(() => assertSupportedRule({
      id: "unknown",
      kind: "providerSpecific",
      enabled: true,
      enforcement: "hard",
    })).toThrow("Unsupported Challenge rule kind");
    expect(() => assertSupportedRule({
      ...daily,
      method: "trailing",
      anchor: "peakEquity",
    })).toThrow("Unsupported loss rule");
  });
});
