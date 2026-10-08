import { describe, expect, it } from "vitest";
import type {
  AccountFillRecord,
  AccountPositionProjection,
  ChallengeAccountState,
  ClosedDayAccounting,
  ExecutionCheckpointId,
  StableAccountCheckpoint,
} from "../accounting/types";
import { initializeChallengeAccount, ledgerInputId } from "../accounting/ledger";
import { utcDayIdAt, utcInstant } from "../domain/calendar";
import { decimalText, moneyFromDecimal } from "../domain/money";
import {
  accountId,
  branchId,
  challengeId,
  phaseId,
  replaySessionId,
  type ChallengeMode,
  type ExecutionScope,
  type FrozenChallengeDefinition,
  type InstantMs,
} from "../domain/types";
import {
  freezeChallengeDefinition,
  MYCRYPTOSTACK_ONE_STEP_V1,
  MYCRYPTOSTACK_TWO_STEP_V1,
} from "../domain/templates";
import {
  factId,
  fillId,
  lifecycleId,
  positionId,
  reservationId,
  workingOrderId,
} from "../execution/policy";
import {
  evaluateStableCheckpoint,
  initializeChallengeRuleLifecycle,
} from "./engine";
import {
  rebuildChallengeRuleLifecycle,
  rebuildChallengeRuleLifecyclePrefix,
} from "./rebuild";
import type {
  ChallengeRuleLifecycleState,
  RuleEngineResult,
} from "./types";

const jan1 = utcInstant(2026, 1, 1);
const jan2 = utcInstant(2026, 1, 2);
const jan3 = utcInstant(2026, 1, 3);
const jan4 = utcInstant(2026, 1, 4);

function definition(
  kind: "one" | "two" = "one",
  mode: ChallengeMode = "replay",
): Readonly<FrozenChallengeDefinition> {
  return freezeChallengeDefinition({
    template: kind === "one"
      ? MYCRYPTOSTACK_ONE_STEP_V1
      : MYCRYPTOSTACK_TWO_STEP_V1,
    selectedCapital: "10000",
    selectedSymbol: "BTCUSDT",
    mode,
  });
}

function scope(
  phase = "phase-1",
  account = `${phase}-account`,
  mode: ChallengeMode = "replay",
): ExecutionScope {
  const common = {
    challengeId: challengeId("task4-challenge"),
    accountId: accountId(account),
    phaseId: phaseId(phase),
    generation: 0,
  };
  return mode === "live"
    ? { mode: "live", ...common }
    : {
        mode: "replay",
        ...common,
        replaySessionId: replaySessionId("task4-replay"),
        branchId: branchId("task4-branch"),
        datasetHash: "task4-dataset",
      };
}

function initialAccount(
  frozen = definition(),
  accountScope = scope(),
  startedAt = jan1,
): ChallengeAccountState {
  return initializeChallengeAccount({
    definition: frozen,
    phaseId: accountScope.phaseId,
    scope: accountScope,
    occurredAt: startedAt,
  });
}

function fillRecord(
  name: string,
  occurredAt: InstantMs,
  classification: "entry" | "increase" | "exit",
): AccountFillRecord {
  return {
    factId: factId(`${name}-fact`),
    executionFactSequence: 1,
    ledgerSequence: 1,
    occurredAt,
    dayId: utcDayIdAt(occurredAt),
    fill: {
      fillId: fillId(`${name}-fill`),
      positionId: positionId(`${name}-position`),
      lifecycleId: lifecycleId(`${name}-lifecycle`),
      side: classification === "exit" ? "sell" : "buy",
      classification,
      reason: "manual",
      quantity: decimalText("1"),
      price: decimalText("100"),
      notional: moneyFromDecimal("100"),
      grossRealizedPnl: moneyFromDecimal("0"),
    },
  };
}

function closedDay(
  occurredAt: InstantMs,
  settledNetPnl: string,
  gross = settledNetPnl,
  commissions = "0",
): ClosedDayAccounting {
  const money = moneyFromDecimal(settledNetPnl);
  return {
    dayId: utcDayIdAt(occurredAt),
    startCash: moneyFromDecimal("10000"),
    startEquity: moneyFromDecimal("10000"),
    startUnrealizedPnl: moneyFromDecimal("0"),
    endingCash: moneyFromDecimal("10000"),
    endingEquity: moneyFromDecimal("10000"),
    endingUnrealizedPnl: moneyFromDecimal("0"),
    realizedGrossPnl: moneyFromDecimal(gross),
    commissions: moneyFromDecimal(commissions),
    capitalAdjustments: moneyFromDecimal("0"),
    settledNetPnl: money,
    balanceChange: money,
    unrealizedChange: moneyFromDecimal("0"),
    equityChange: money,
    closedAt: (occurredAt + 86_400_000) as InstantMs,
  };
}

function openPosition(): AccountPositionProjection {
  return {
    positionId: positionId("task4-open-position"),
    lifecycleId: lifecycleId("task4-open-lifecycle"),
    symbol: "BTCUSDT",
    side: "long",
    quantity: decimalText("1"),
    entryPrice: decimalText("100"),
    costBasis: moneyFromDecimal("100"),
    entryCommissionTotal: moneyFromDecimal("0.1"),
    entryCommissionRemaining: moneyFromDecimal("0.1"),
    leverage: decimalText("10"),
    openedAt: jan1,
    protection: {
      stopLoss: null,
      takeProfit: null,
      trailingEnabled: false,
      trailingDistance: null,
      trailingBestPrice: null,
    },
    currentMark: decimalText("100"),
    unrealizedPnl: moneyFromDecimal("0"),
    grossExposure: moneyFromDecimal("100"),
  };
}

interface StableOptions {
  occurredAt: InstantMs;
  kind?: "executionCommand" | "dayBoundary";
  checkpointSequence?: number;
  patch?: Partial<ChallengeAccountState>;
}

function stableAccount(
  previous: ChallengeAccountState,
  options: StableOptions,
): ChallengeAccountState {
  const candidate = { ...previous, ...(options.patch ?? {}) };
  const sequence = options.checkpointSequence ??
    previous.stableCheckpointSequence + 1;
  const revision = previous.revision + 1;
  const kind = options.kind ?? "executionCommand";
  const checkpointFactIds = kind === "executionCommand"
    ? [factId(`task4-checkpoint-fact-${candidate.phaseId}-${sequence}`)]
    : [];
  const checkpointId = (
    `checkpoint:task4:${candidate.phaseId}:${sequence}:${options.occurredAt}:${candidate.cashBalance}`
  ) as ExecutionCheckpointId;
  const ledgerHash = `task4-ledger:${candidate.phaseId}:${sequence}:${candidate.cashBalance}`;
  const inputId = ledgerInputId(
    `task4-checkpoint:${candidate.phaseId}:${sequence}:${options.occurredAt}`,
  );
  const checkpoint: StableAccountCheckpoint = {
    checkpointId,
    checkpointSequence: sequence,
    kind,
    inputId,
    commandId: kind === "executionCommand" ? "task4-command" as never : null,
    firstFactSequence: kind === "executionCommand" ? sequence : null,
    lastFactSequence: kind === "executionCommand" ? sequence : null,
    factIds: checkpointFactIds,
    committedAccountRevision: previous.revision,
    committedLedgerHash: previous.ledgerHash,
    stableAccountRevision: revision,
    stableLedgerHash: ledgerHash,
    occurredAt: options.occurredAt,
  };
  return {
    ...candidate,
    revision,
    nextInputSequence: previous.nextInputSequence + 1,
    lastOccurredAt: options.occurredAt,
    appliedInputIds: [...previous.appliedInputIds, inputId],
    ledgerHash,
    projectionStability: "STABLE",
    pendingExecutionCommand: null,
    stableCheckpointSequence: sequence,
    appliedCheckpointIds: [...previous.appliedCheckpointIds, checkpointId],
    checkpoints: [...previous.checkpoints, checkpoint],
    lastStableCheckpoint: checkpoint,
  };
}

function completionPatch(
  account: ChallengeAccountState,
  cash: string,
): Partial<ChallengeAccountState> {
  const firstDay = account.phaseStartedAt;
  const secondDay = (firstDay + 86_400_000) as InstantMs;
  const thirdDay = (firstDay + 2 * 86_400_000) as InstantMs;
  const fourthDay = (firstDay + 3 * 86_400_000) as InstantMs;
  const fills = [
    fillRecord("active-1", firstDay, "entry"),
    fillRecord("active-2", secondDay, "increase"),
    fillRecord("active-3", thirdDay, "increase"),
  ];
  return {
    cashBalance: moneyFromDecimal(cash),
    equity: moneyFromDecimal(cash),
    position: null,
    reservations: [],
    fills,
    appliedFillIds: fills.map((record) => record.fill.fillId),
    appliedFactIds: fills.map((record) => record.factId),
    closedDays: [
      closedDay(firstDay, "10"),
      closedDay(secondDay, "10"),
      closedDay(thirdDay, "10"),
    ],
    day: {
      ...account.day,
      currentDayId: utcDayIdAt(fourthDay),
      dayStartCash: moneyFromDecimal(cash),
      dayStartEquity: moneyFromDecimal(cash),
    },
  };
}

function applied(result: RuleEngineResult): ChallengeRuleLifecycleState {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.rejection.message);
  return result.state;
}

function currentPhase(state: ChallengeRuleLifecycleState) {
  const phase = state.phases.find((candidate) =>
    candidate.phaseId === state.currentPhaseId);
  if (!phase) throw new Error("Missing current phase.");
  return phase;
}
describe("Task 4 stable rule and lifecycle engine", () => {
  it("qualifies exposure-increasing active days once and ignores reductions", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({
      definition: frozen,
      initialAccount: initial,
    });
    const sameDayFills = [
      fillRecord("entry-day1", jan1, "entry"),
      fillRecord("increase-day1", jan1, "increase"),
      fillRecord("exit-day1", jan1, "exit"),
    ];
    const first = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: {
        fills: sameDayFills,
        appliedFillIds: sameDayFills.map((record) => record.fill.fillId),
      },
    });
    state = applied(evaluateStableCheckpoint(state, first, frozen));
    expect(currentPhase(state).activeDayIds).toEqual([utcDayIdAt(jan1)]);

    const reducingOnly = fillRecord("exit-day2", jan2, "exit");
    const second = stableAccount(first, {
      occurredAt: (jan2 + 1_000) as InstantMs,
      patch: {
        fills: [...sameDayFills, reducingOnly],
        appliedFillIds: [
          ...sameDayFills.map((record) => record.fill.fillId),
          reducingOnly.fill.fillId,
        ],
      },
    });
    state = applied(evaluateStableCheckpoint(state, second, frozen));
    expect(currentPhase(state).activeDayIds).toHaveLength(1);
  });

  it("counts reversal residual entry as activity", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const reversal = [
      fillRecord("reversal-close", jan2, "exit"),
      fillRecord("reversal-residual", jan2, "entry"),
    ];
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan2 + 1_000) as InstantMs,
      patch: {
        fills: reversal,
        appliedFillIds: reversal.map((record) => record.fill.fillId),
      },
    });
    state = applied(evaluateStableCheckpoint(state, checkpoint, frozen));
    expect(currentPhase(state).activeDayIds).toEqual([utcDayIdAt(jan2)]);
    expect(state.decisions.filter((decision) =>
      decision.kind === "ActiveDayQualified")).toHaveLength(1);
  });

  it("qualifies profitable days only after finalization and exact threshold", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const fills = [
      fillRecord("profit-day1", jan1, "entry"),
      fillRecord("profit-day2", jan2, "increase"),
      fillRecord("profit-current", jan3, "increase"),
    ];
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan3 + 1_000) as InstantMs,
      patch: {
        fills,
        appliedFillIds: fills.map((record) => record.fill.fillId),
        closedDays: [
          closedDay(jan1, "9.999999", "11", "1.000001"),
          closedDay(jan2, "10"),
        ],
      },
    });
    state = applied(evaluateStableCheckpoint(state, checkpoint, frozen));
    const phase = currentPhase(state);
    expect(phase.activeDayIds).toHaveLength(3);
    expect(phase.profitableDayIds).toEqual([utcDayIdAt(jan2)]);
    expect(phase.profitableDayIds).not.toContain(utcDayIdAt(jan3));
  });

  it("keeps achievement incompleteness out of Challenge health", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
    });
    const state = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    ));
    const phase = currentPhase(state);
    expect(phase.health).toBe("SAFE");
    expect(phase.activeDayIds).toHaveLength(0);
    expect(phase.profitableDayIds).toHaveLength(0);
    expect(phase.targetReached).toBe(false);
  });

  it("emits warning, applies hysteresis, then rearms below 75%", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const warning = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { equity: moneyFromDecimal("9600"), cashBalance: moneyFromDecimal("9600") },
    });
    let result = evaluateStableCheckpoint(state, warning, frozen);
    state = applied(result);
    expect(currentPhase(state).health).toBe("WARNING");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "WarningRaised")).toBe(true);

    const held = stableAccount(warning, {
      occurredAt: (jan1 + 2_000) as InstantMs,
      patch: { equity: moneyFromDecimal("9610"), cashBalance: moneyFromDecimal("9610") },
    });
    state = applied(evaluateStableCheckpoint(state, held, frozen));
    expect(currentPhase(state).health).toBe("WARNING");

    const rearmed = stableAccount(held, {
      occurredAt: (jan1 + 3_000) as InstantMs,
      patch: {
        equity: moneyFromDecimal("9625.000001"),
        cashBalance: moneyFromDecimal("9625.000001"),
      },
    });
    result = evaluateStableCheckpoint(state, rearmed, frozen);
    state = applied(result);
    expect(currentPhase(state).health).toBe("SAFE");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "WarningRearmed")).toBe(true);
  });

  it("keeps target-reached phases active while a position is open", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: jan4,
      patch: {
        ...completionPatch(initial, "11000"),
        position: openPosition(),
      },
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    const state = applied(result);
    expect(currentPhase(state).targetReached).toBe(true);
    expect(currentPhase(state).status).toBe("ACTIVE");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "TargetReached")).toBe(true);
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "PhasePassed")).toBe(false);
  });

  it("keeps target-reached phases active while a working order remains", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: jan4,
      patch: {
        ...completionPatch(initial, "11000"),
        reservations: [{
          reservationId: reservationId("target-reservation"),
          workingOrderId: workingOrderId("target-order"),
          requiredMargin: moneyFromDecimal("10"),
        }],
      },
    });
    const state = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    ));
    expect(currentPhase(state).status).toBe("ACTIVE");
    expect(currentPhase(state).targetReached).toBe(true);
  });
  it("passes a complete one-step phase only at its stable checkpoint", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: jan4,
      patch: completionPatch(initial, "11000"),
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    const state = applied(result);
    expect(currentPhase(state).status).toBe("PASSED");
    expect(state.status).toBe("PASSED");
    expect(result.status === "applied" && result.decisions.map(
      (decision) => decision.kind)).toEqual(expect.arrayContaining([
        "TargetReached",
        "PhasePassed",
        "ChallengePassed",
      ]));
  });

  it("records simultaneous daily and maximum breaches in rule order", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: jan4,
      patch: {
        ...completionPatch(initial, "11000"),
        equity: moneyFromDecimal("9000"),
        position: openPosition(),
        day: {
          ...initial.day,
          currentDayId: utcDayIdAt(jan4),
          dayStartCash: moneyFromDecimal("10000"),
          dayStartEquity: moneyFromDecimal("10000"),
        },
      },
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    const state = applied(result);
    const phase = currentPhase(state);
    expect(phase.status).toBe("FAILED");
    expect(state.status).toBe("FAILED");
    expect(phase.breaches).toHaveLength(2);
    expect(phase.breaches.map((evidence) => evidence.ruleId)).toEqual([
      "phase-1.daily-loss",
      "phase-1.maximum-loss",
    ]);
    expect(phase.primaryBreach?.ruleId).toBe("phase-1.daily-loss");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "PhasePassed")).toBe(false);
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "TargetReached")).toBe(true);
  });

  it("fails inactivity exactly at the frozen inclusive deadline", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 30 * 86_400_000) as InstantMs,
    });
    const state = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    ));
    const phase = currentPhase(state);
    const inactivity = phase.ruleEvaluations.find(
      (evaluation) => evaluation.kind === "inactivity");
    expect(inactivity?.status).toBe("BREACHED");
    expect(phase.status).toBe("FAILED");
    expect(phase.primaryBreach?.metric).toBe("logicalTime");
  });

  it("uses the last exposure-increasing fill as the inactivity reference", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const activityAt = (jan1 + 10 * 86_400_000) as InstantMs;
    const fill = fillRecord("inactivity-reset", activityAt, "entry");
    const activity = stableAccount(initial, {
      occurredAt: activityAt,
      patch: { fills: [fill], appliedFillIds: [fill.fill.fillId] },
    });
    state = applied(evaluateStableCheckpoint(state, activity, frozen));
    const beforeDeadline = stableAccount(activity, {
      occurredAt: (activityAt + 30 * 86_400_000 - 1) as InstantMs,
    });
    state = applied(evaluateStableCheckpoint(state, beforeDeadline, frozen));
    expect(currentPhase(state).status).toBe("ACTIVE");
    expect(currentPhase(state).lastQualifyingActivityAt).toBe(activityAt);
  });

  it("keeps failure terminal after later market recovery", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const breach = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9000"), equity: moneyFromDecimal("9000") },
    });
    state = applied(evaluateStableCheckpoint(state, breach, frozen));
    expect(state.status).toBe("FAILED");

    const recovered = stableAccount(breach, {
      occurredAt: (jan1 + 2_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("10000"), equity: moneyFromDecimal("10000") },
    });
    const recovery = evaluateStableCheckpoint(state, recovered, frozen);
    state = applied(recovery);
    expect(state.status).toBe("FAILED");
    expect(state.phases[0].status).toBe("FAILED");
    expect(recovery.status === "applied" && recovery.decisions).toHaveLength(0);
  });

  it("keeps a passed one-step phase terminal", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const passed = stableAccount(initial, {
      occurredAt: jan4,
      patch: completionPatch(initial, "11000"),
    });
    state = applied(evaluateStableCheckpoint(state, passed, frozen));
    const later = stableAccount(passed, {
      occurredAt: (jan4 + 1_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9000"), equity: moneyFromDecimal("9000") },
    });
    state = applied(evaluateStableCheckpoint(state, later, frozen));
    expect(state.status).toBe("PASSED");
    expect(state.phases[0].status).toBe("PASSED");
  });

  it("makes Two-Step Phase 1 pass emit NextPhaseEligible", () => {
    const frozen = definition("two");
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: jan4,
      patch: completionPatch(initial, "11000"),
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    const state = applied(result);
    expect(state.phases[0].status).toBe("PASSED");
    expect(state.phases[1].status).toBe("LOCKED");
    expect(state.currentPhaseId).toBe("phase-2");
    expect(state.status).toBe("ACTIVE");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "NextPhaseEligible" &&
        decision.nextPhaseId === "phase-2")).toBe(true);
  });

  it("makes a Two-Step Phase 1 breach fail the whole challenge", () => {
    const frozen = definition("two");
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9000"), equity: moneyFromDecimal("9000") },
    });
    const state = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    ));
    expect(state.phases[0].status).toBe("FAILED");
    expect(state.phases[1].status).toBe("LOCKED");
    expect(state.status).toBe("FAILED");
  });

  it("passes the challenge after a fresh Phase 2 reaches its 8% target", () => {
    const frozen = definition("two");
    const phase1Initial = initialAccount(frozen);
    let state = initializeChallengeRuleLifecycle({
      definition: frozen,
      initialAccount: phase1Initial,
    });
    const phase1Pass = stableAccount(phase1Initial, {
      occurredAt: jan4,
      patch: completionPatch(phase1Initial, "11000"),
    });
    state = applied(evaluateStableCheckpoint(state, phase1Pass, frozen));

    const phase2Scope = scope("phase-2", "phase-2-fresh-account");
    const phase2Initial = initialAccount(
      frozen,
      phase2Scope,
      utcInstant(2026, 2, 1),
    );
    const phase2Pass = stableAccount(phase2Initial, {
      occurredAt: utcInstant(2026, 2, 4),
      patch: completionPatch(phase2Initial, "10800"),
    });
    const result = evaluateStableCheckpoint(state, phase2Pass, frozen);
    state = applied(result);
    expect(state.phases[1].status).toBe("PASSED");
    expect(state.status).toBe("PASSED");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "PhaseActivated")).toBe(true);
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "ChallengePassed")).toBe(true);
  });
  it("is idempotent for duplicate stable checkpoint evaluation", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
    });
    let state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    state = applied(evaluateStableCheckpoint(state, checkpoint, frozen));
    const duplicate = evaluateStableCheckpoint(state, checkpoint, frozen);
    expect(duplicate.status).toBe("alreadyEvaluated");
    expect(duplicate.state).toBe(state);
    expect(duplicate.decisions).toHaveLength(0);
  });

  it("rejects out-of-order stable checkpoints", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      checkpointSequence: 2,
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.rejection.code).toBe("OUT_OF_ORDER");
  });

  it("rejects scope mismatch", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const originalScope = scope();
    if (originalScope.mode !== "replay") throw new Error("Expected replay scope.");
    const wrong = initialAccount(frozen, {
      ...originalScope,
      branchId: branchId("wrong-branch"),
    });
    const checkpoint = stableAccount(wrong, {
      occurredAt: (jan1 + 1_000) as InstantMs,
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.rejection.code).toBe("SCOPE_MISMATCH");
  });

  it("rejects definition mismatch", () => {
    const frozen = definition();
    const other = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "25000",
      selectedSymbol: "BTCUSDT",
      mode: "replay",
    });
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      other,
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.rejection.code).toBe("DEFINITION_MISMATCH");
    }
  });

  it("rejects upstream version mismatch", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { checkpointVersion: "unknown-checkpoint-version" },
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.rejection.code).toBe("VERSION_MISMATCH");
  });

  it("rejects intermediate accounting revisions without lifecycle decisions", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const stable = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
    });
    const intermediate: ChallengeAccountState = {
      ...stable,
      projectionStability: "INTERMEDIATE",
      pendingExecutionCommand: {
        commandId: "intermediate-command" as never,
        firstFactSequence: 1,
        lastFactSequence: 1,
        factIds: [factId("intermediate-fact")],
        occurredAt: stable.lastOccurredAt,
      },
      cashBalance: moneyFromDecimal("11010"),
      equity: moneyFromDecimal("11010"),
    };
    const state = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    const result = evaluateStableCheckpoint(state, intermediate, frozen);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.rejection.code).toBe("INTERMEDIATE_PROJECTION");
      expect(result.state.status).toBe("NOT_STARTED");
      expect(result.decisions).toHaveLength(0);
    }
  });

  it("rebuilds forward state exactly and removes future state by prefix", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const warning = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9600"), equity: moneyFromDecimal("9600") },
    });
    const breach = stableAccount(warning, {
      occurredAt: (jan1 + 2_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9500"), equity: moneyFromDecimal("9500") },
    });
    let forward = initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial });
    forward = applied(evaluateStableCheckpoint(forward, warning, frozen));
    forward = applied(evaluateStableCheckpoint(forward, breach, frozen));

    const input = {
      definition: frozen,
      initialAccount: initial,
      stableAccounts: [warning, breach],
    };
    expect(rebuildChallengeRuleLifecycle(input).state).toEqual(forward);
    const prefix = rebuildChallengeRuleLifecyclePrefix(input, 1);
    expect(prefix.status).toBe("ACTIVE");
    expect(prefix.phases[0].health).toBe("WARNING");
    expect(prefix.phases[0].breaches).toHaveLength(0);
    expect(prefix.decisions.some((decision) =>
      decision.kind === "PhaseFailed")).toBe(false);
    const empty = rebuildChallengeRuleLifecyclePrefix(input, 0);
    expect(empty.status).toBe("NOT_STARTED");
    expect(empty.processedCheckpointIds).toHaveLength(0);
  });

  it("produces equivalent replay/live economic lifecycle results", () => {
    const replayDefinition = definition("one", "replay");
    const liveDefinition = definition("one", "live");
    const replayInitial = initialAccount(replayDefinition, scope("phase-1", "replay-account"));
    const liveInitial = initialAccount(liveDefinition, scope("phase-1", "live-account", "live"));
    const replayPass = stableAccount(replayInitial, {
      occurredAt: jan4,
      patch: completionPatch(replayInitial, "11000"),
    });
    const livePass = stableAccount(liveInitial, {
      occurredAt: jan4,
      patch: completionPatch(liveInitial, "11000"),
    });
    const replay = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: replayDefinition, initialAccount: replayInitial }),
      replayPass,
      replayDefinition,
    ));
    const live = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: liveDefinition, initialAccount: liveInitial }),
      livePass,
      liveDefinition,
    ));
    const economics = (state: ChallengeRuleLifecycleState) => ({
      challenge: state.status,
      phase: state.phases[0].status,
      health: state.phases[0].health,
      active: state.phases[0].activeDayIds,
      profitable: state.phases[0].profitableDayIds,
      target: state.phases[0].targetReached,
      ruleStatuses: state.phases[0].ruleEvaluations.map((evaluation) => ({
        kind: evaluation.kind,
        status: evaluation.status,
      })),
    });
    expect(economics(live)).toEqual(economics(replay));
  });

  it("enforces the mandatory atomic target regression", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    let belowLifecycle = initializeChallengeRuleLifecycle({
      definition: frozen,
      initialAccount: initial,
    });
    const preCommand = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: {
        cashBalance: moneyFromDecimal("10950"),
        equity: moneyFromDecimal("10950"),
      },
    });
    belowLifecycle = applied(evaluateStableCheckpoint(
      belowLifecycle,
      preCommand,
      frozen,
    ));
    expect(preCommand.cashBalance).toBe(moneyFromDecimal("10950"));

    const temporary: ChallengeAccountState = {
      ...preCommand,
      revision: preCommand.revision + 1,
      nextInputSequence: preCommand.nextInputSequence + 1,
      projectionStability: "INTERMEDIATE",
      pendingExecutionCommand: {
        commandId: "atomic-close" as never,
        firstFactSequence: 1,
        lastFactSequence: 1,
        factIds: [factId("atomic-gross")],
        occurredAt: (jan1 + 2_000) as InstantMs,
      },
      lastOccurredAt: (jan1 + 2_000) as InstantMs,
      cashBalance: moneyFromDecimal("11010"),
      equity: moneyFromDecimal("11010"),
    };
    const ignored = evaluateStableCheckpoint(belowLifecycle, temporary, frozen);
    expect(temporary.cashBalance).toBe(moneyFromDecimal("11010"));
    expect(ignored.status).toBe("rejected");
    expect(ignored.state).toBe(belowLifecycle);
    expect(ignored.state.status).toBe("ACTIVE");

    const finalBelow = stableAccount(preCommand, {
      occurredAt: (jan1 + 3_000) as InstantMs,
      patch: {
        cashBalance: moneyFromDecimal("10995"),
        equity: moneyFromDecimal("10995"),
      },
    });
    const belowState = applied(evaluateStableCheckpoint(
      belowLifecycle,
      finalBelow,
      frozen,
    ));
    expect(finalBelow.cashBalance).toBe(moneyFromDecimal("10995"));
    expect(belowState.status).toBe("ACTIVE");
    expect(belowState.phases[0].targetReached).toBe(false);

    let aboveLifecycle = initializeChallengeRuleLifecycle({
      definition: frozen,
      initialAccount: initial,
    });
    const preAbove = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: {
        cashBalance: moneyFromDecimal("10950"),
        equity: moneyFromDecimal("10950"),
      },
    });
    aboveLifecycle = applied(evaluateStableCheckpoint(
      aboveLifecycle,
      preAbove,
      frozen,
    ));
    const finalAbove = stableAccount(preAbove, {
      occurredAt: jan4,
      patch: completionPatch(preAbove, "11005"),
    });
    const aboveState = applied(evaluateStableCheckpoint(
      aboveLifecycle,
      finalAbove,
      frozen,
    ));
    expect(finalAbove.cashBalance).toBe(moneyFromDecimal("11005"));
    expect(aboveState.status).toBe("PASSED");
    expect(aboveState.phases[0].status).toBe("PASSED");
  });

  it("emits DANGER health and a deterministic DangerRaised transition", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const checkpoint = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9525"), equity: moneyFromDecimal("9525") },
    });
    const result = evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      checkpoint,
      frozen,
    );
    const state = applied(result);
    expect(currentPhase(state).health).toBe("DANGER");
    expect(result.status === "applied" && result.decisions.some(
      (decision) => decision.kind === "DangerRaised")).toBe(true);
  });

  it("records complete deterministic hard-breach evidence", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const raw = stableAccount(initial, {
      occurredAt: (jan1 + 1_000) as InstantMs,
      patch: { cashBalance: moneyFromDecimal("9500"), equity: moneyFromDecimal("9500") },
    });
    const supporting = factId("breach-supporting-fact");
    const checkpoint = {
      ...raw.lastStableCheckpoint,
      factIds: [supporting],
    } as StableAccountCheckpoint;
    const account = {
      ...raw,
      checkpoints: [checkpoint],
      lastStableCheckpoint: checkpoint,
    };
    const state = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      account,
      frozen,
    ));
    const evidence = state.phases[0].primaryBreach;
    expect(evidence).toMatchObject({
      ruleId: "phase-1.daily-loss",
      ruleKind: "loss",
      challengeId: initial.challengeId,
      accountId: initial.accountId,
      phaseId: initial.phaseId,
      checkpointId: checkpoint.checkpointId,
      accountRevision: account.revision,
      definitionHash: frozen.definitionHash,
      occurredAt: checkpoint.occurredAt,
      actual: moneyFromDecimal("9500"),
      threshold: moneyFromDecimal("9500"),
      operator: "<=",
      supportingFactIds: [supporting],
    });
    expect(evidence?.evidenceId).toMatch(/^breach:sha256:[0-9a-f]{64}$/);
  });

  it("evaluates the finalized day before resetting the daily-loss baseline", () => {
    const frozen = definition();
    const initial = initialAccount(frozen);
    const finalized = {
      ...closedDay(jan1, "-500"),
      endingCash: moneyFromDecimal("9500"),
      endingEquity: moneyFromDecimal("9500"),
    };
    const boundary = stableAccount(initial, {
      occurredAt: jan2,
      kind: "dayBoundary",
      patch: {
        cashBalance: moneyFromDecimal("9500"),
        equity: moneyFromDecimal("9500"),
        closedDays: [finalized],
        day: {
          ...initial.day,
          currentDayId: utcDayIdAt(jan2),
          dayStartCash: moneyFromDecimal("9500"),
          dayStartEquity: moneyFromDecimal("9500"),
        },
      },
    });
    const state = applied(evaluateStableCheckpoint(
      initializeChallengeRuleLifecycle({ definition: frozen, initialAccount: initial }),
      boundary,
      frozen,
    ));
    const daily = state.phases[0].ruleEvaluations.find(
      (evaluation) => evaluation.kind === "loss" && evaluation.window === "daily",
    );
    if (!daily || daily.kind !== "loss") throw new Error("Missing daily loss.");
    expect(daily.status).toBe("BREACHED");
    expect(daily.floor).toBe(moneyFromDecimal("9500"));
    expect(state.phases[0].status).toBe("FAILED");
  });
});
