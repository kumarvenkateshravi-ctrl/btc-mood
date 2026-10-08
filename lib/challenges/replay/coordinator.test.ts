import { describe, expect, it, vi } from "vitest";
import { utcInstant } from "../domain/calendar";
import { moneyToDecimal } from "../domain/money";
import {
  accountId,
  branchId,
  challengeId,
  phaseId,
  replaySessionId,
} from "../domain/types";
import {
  freezeChallengeDefinition,
  MYCRYPTOSTACK_ONE_STEP_V1,
  MYCRYPTOSTACK_TWO_STEP_V1,
} from "../domain/templates";
import { canonicalHash } from "../domain/versions";
import type { Candle, Timeframe } from "../../types";
import {
  freezeChallengeReplayDataset,
  reconstructReplayChallenge,
  startReplayChallenge,
  type ChallengeReplayContext,
  type ChallengeReplayCoordinator,
  type ChallengeReplayTradingIntent,
} from ".";

vi.setConfig({ testTimeout: 120_000 });

const START_SECONDS = Number(utcInstant(2026, 1, 1)) / 1000;

function candles(
  count = 400,
  timeframe: Timeframe = "15m",
  price: number | ((index: number) => number) = 10_000,
): Candle[] {
  const seconds = timeframe === "1d" ? 86_400 : 900;
  return Array.from({ length: count }, (_, index) => {
    const value = typeof price === "function" ? price(index) : price;
    return {
      time: START_SECONDS + index * seconds,
      open: value,
      high: value,
      low: value,
      close: value,
      volume: 1,
    };
  });
}

function setup(
  kind: "one" | "two" = "one",
  options: {
    candles?: Candle[];
    timeframe?: Timeframe;
    datasetId?: string;
    startingCursor?: number;
  } = {},
): ChallengeReplayCoordinator {
  const timeframe = options.timeframe ?? "15m";
  const dataset = freezeChallengeReplayDataset({
    datasetId: options.datasetId ?? `task5-${kind}`,
    symbol: "BTCUSDT",
    executionTimeframe: timeframe,
    candles: options.candles ?? candles(400, timeframe),
  });
  const definition = freezeChallengeDefinition({
    template: kind === "one"
      ? MYCRYPTOSTACK_ONE_STEP_V1
      : MYCRYPTOSTACK_TWO_STEP_V1,
    selectedCapital: "10000",
    selectedSymbol: "BTCUSDT",
    mode: "replay",
  });
  return startReplayChallenge({
    frozenDefinition: definition,
    selectedPhase: phaseId("phase-1"),
    dataset,
    executionTimeframe: timeframe,
    startingCursor: options.startingCursor ?? 0,
    identities: {
      challengeId: challengeId("task5-challenge"),
      accountId: accountId("task5-phase-1-account"),
      phaseId: phaseId("phase-1"),
      replaySessionId: replaySessionId("task5-replay"),
      branchId: branchId("task5-main"),
      generation: 0,
    },
  });
}

function trade(
  coordinator: ChallengeReplayCoordinator,
  intent: ChallengeReplayTradingIntent,
) {
  return coordinator.trade(coordinator.getContext(), intent);
}

function market(
  side: "buy" | "sell",
  quantity: string,
  observedPrice: string,
  leverage = "10",
): Extract<ChallengeReplayTradingIntent, { kind: "market" }> {
  return { kind: "market", side, quantity, observedPrice, leverage };
}

function roundTrip(
  coordinator: ChallengeReplayCoordinator,
  entry = "10000",
  exit = "10400",
) {
  expect(trade(coordinator, market("buy", "1", entry)).status).toBe("applied");
  expect(trade(coordinator, { kind: "closeFull", observedPrice: exit }).status)
    .toBe("applied");
}

function advance(coordinator: ChallengeReplayCoordinator, cursor: number, speed = 1) {
  return coordinator.advanceTo(coordinator.getContext(), cursor, { speed });
}

describe("Challenge Replay coordinator", () => {
  it("starts a One-Step replay from Task 3 capital with one coherent stable model", () => {
    const coordinator = setup();
    const snapshot = coordinator.getSnapshot();
    expect(moneyToDecimal(snapshot.account.phaseStartingCash)).toBe("10000");
    expect(moneyToDecimal(snapshot.account.cashBalance)).toBe("10000");
    expect(snapshot.execution.position).toBeNull();
    expect(snapshot.lifecycle.status).toBe("ACTIVE");
    expect(snapshot.readModel.identity).toMatchObject({
      challengeType: "oneStep",
      currentPhaseId: "phase-1",
      mode: "replay",
      status: "ACTIVE",
      health: "SAFE",
    });
    expect(snapshot.account.projectionStability).toBe("STABLE");
    expect(snapshot.readModel.consistency.stableCheckpointId).toBe(
      snapshot.readModel.consistency.lifecycleCheckpointId,
    );
  });

  it("routes long, partial close, full close and all commissions through Tasks 2 and 3", () => {
    const coordinator = setup();
    expect(trade(coordinator, market("buy", "1", "10000")).status).toBe("applied");
    let snapshot = coordinator.getSnapshot();
    expect(snapshot.execution.position?.side).toBe("long");
    expect(snapshot.account.position?.quantity).toBe("1");
    expect(moneyToDecimal(snapshot.account.totalCommissions)).toBe("10.0001");

    expect(trade(coordinator, {
      kind: "closePartial", quantity: "0.4", observedPrice: "10100",
    }).status).toBe("applied");
    snapshot = coordinator.getSnapshot();
    expect(snapshot.execution.position?.quantity).toBe("0.6");
    expect(snapshot.account.position?.quantity).toBe("0.6");

    expect(trade(coordinator, {
      kind: "closeFull", observedPrice: "10200",
    }).status).toBe("applied");
    snapshot = coordinator.getSnapshot();
    expect(snapshot.execution.position).toBeNull();
    expect(snapshot.account.position).toBeNull();
    expect(snapshot.account.fills).toHaveLength(3);
    expect(snapshot.account.commissionedFillIds).toHaveLength(3);
    expect(snapshot.account.totalCommissions > BigInt(0)).toBe(true);
    expect(snapshot.account.cashBalance).toBe(
      snapshot.account.phaseStartingCash + snapshot.account.realizedGrossPnl -
      snapshot.account.totalCommissions,
    );
  });

  it("opens short and resets old protection on reversal residual", () => {
    const coordinator = setup();
    expect(trade(coordinator, {
      ...market("buy", "1", "10000"),
      kind: "market",
      protection: { stopLoss: "9900", takeProfit: "11000" },
    }).status).toBe("applied");
    expect(trade(coordinator, market("sell", "2", "10000")).status).toBe("applied");
    const position = coordinator.getSnapshot().execution.position;
    expect(position?.side).toBe("short");
    expect(position?.quantity).toBe("1");
    expect(position?.protection.stopLoss).toBeNull();
    expect(position?.protection.takeProfit).toBeNull();
    expect(coordinator.getSnapshot().account.fills.map((item) => item.fill.classification))
      .toEqual(["entry", "exit", "entry"]);
  });

  it("updates marks atomically through the full command cycle", () => {
    const dataset = candles(20, "15m", (index) => index === 1 ? 10_100 : 10_000);
    const coordinator = setup("one", { candles: dataset });
    trade(coordinator, market("buy", "1", "10000"));
    expect(advance(coordinator, 1).status).toBe("applied");
    const snapshot = coordinator.getSnapshot();
    expect(snapshot.execution.lastObservedPrice).toBe("10100");
    expect(snapshot.account.lastMarkPrice).toBe("10100");
    expect(snapshot.account.unrealizedPnl).toBe(snapshot.account.equity - snapshot.account.cashBalance);
    expect(snapshot.account.projectionStability).toBe("STABLE");
    expect(snapshot.account.pendingExecutionCommand).toBeNull();
  });

  it("uses modeled intrabar ordering for SL and TP instead of a global SL-first rule", () => {
    const bars = candles(20);
    bars[1] = { ...bars[1], open: 10_000, low: 9_800, high: 10_200, close: 10_100 };
    const coordinator = setup("one", { candles: bars });
    trade(coordinator, {
      ...market("buy", "1", "10000"),
      kind: "market",
      protection: { stopLoss: "9900", takeProfit: "10100" },
    });
    advance(coordinator, 1);
    const exit = coordinator.getSnapshot().account.fills.at(-1)?.fill;
    expect(exit?.reason).toBe("stopLoss");
    expect(exit?.price).toBe("9900");

    const downBars = candles(20);
    downBars[1] = { ...downBars[1], open: 10_000, high: 10_200, low: 9_800, close: 9_900 };
    const second = setup("one", { candles: downBars, datasetId: "intrabar-down" });
    trade(second, {
      ...market("buy", "1", "10000"),
      kind: "market",
      protection: { stopLoss: "9900", takeProfit: "10100" },
    });
    advance(second, 1);
    expect(second.getSnapshot().account.fills.at(-1)?.fill.reason).toBe("takeProfit");
  });

  it("fills a gap-through stop at the first adverse observable price", () => {
    const bars = candles(20);
    bars[1] = { ...bars[1], open: 9_800, high: 9_850, low: 9_700, close: 9_750 };
    const coordinator = setup("one", { candles: bars });
    trade(coordinator, {
      ...market("buy", "1", "10000"),
      kind: "market",
      protection: { stopLoss: "9900" },
    });
    advance(coordinator, 1);
    const exit = coordinator.getSnapshot().account.fills.at(-1)?.fill;
    expect(exit?.reason).toBe("stopLoss");
    expect(exit?.price).toBe("9800");
  });

  it("activates and advances a trailing stop through replay observations", () => {
    const bars = candles(20);
    bars[1] = { ...bars[1], open: 10_000, high: 10_200, low: 10_000, close: 10_200 };
    bars[2] = { ...bars[2], open: 10_200, high: 10_200, low: 10_050, close: 10_050 };
    const coordinator = setup("one", { candles: bars });
    trade(coordinator, {
      ...market("buy", "1", "10000"),
      kind: "market",
      protection: { stopLoss: "9900", trailingEnabled: true },
    });
    advance(coordinator, 1);
    expect(coordinator.getSnapshot().execution.position?.protection.stopLoss).toBe("10099.9");
    advance(coordinator, 2);
    expect(coordinator.getSnapshot().account.fills.at(-1)?.fill.reason).toBe("trailingStop");
  });

  it("updates SL, TP and trailing activation through chart command concepts", () => {
    const coordinator = setup();
    trade(coordinator, market("buy", "1", "10000"));
    expect(trade(coordinator, {
      kind: "updateProtection", update: { stopLoss: "9900", takeProfit: "10200" },
    }).status).toBe("applied");
    expect(trade(coordinator, {
      kind: "updateProtection", update: { trailingEnabled: true },
    }).status).toBe("applied");
    expect(coordinator.getSnapshot().execution.position?.protection).toMatchObject({
      stopLoss: "9900", takeProfit: "10200", trailingEnabled: true,
    });
  });
  it("fills working orders and releases an OCO peer atomically", () => {
    const bars = candles(20);
    bars[1] = { ...bars[1], open: 10_000, high: 10_000, low: 9_800, close: 9_900 };
    const coordinator = setup("one", { candles: bars });
    expect(trade(coordinator, {
      kind: "placeWorkingEntry", side: "buy", orderType: "limit",
      quantity: "0.1", triggerPrice: "9900", leverage: "10", ocoGroupId: "entry-oco",
    }).status).toBe("applied");
    expect(trade(coordinator, {
      kind: "placeWorkingEntry", side: "buy", orderType: "stop",
      quantity: "0.1", triggerPrice: "10100", leverage: "10", ocoGroupId: "entry-oco",
    }).status).toBe("applied");
    expect(coordinator.getSnapshot().execution.workingOrders).toHaveLength(2);
    advance(coordinator, 1);
    const snapshot = coordinator.getSnapshot();
    expect(snapshot.execution.position?.side).toBe("long");
    expect(snapshot.execution.workingOrders).toHaveLength(0);
    expect(snapshot.account.reservations).toHaveLength(0);
  });

  it("supports explicit working-order cancellation", () => {
    const coordinator = setup();
    trade(coordinator, {
      kind: "placeWorkingEntry", side: "buy", orderType: "limit",
      quantity: "0.1", triggerPrice: "9900", leverage: "10",
    });
    const orderId = coordinator.getSnapshot().execution.workingOrders[0].orderId;
    expect(trade(coordinator, { kind: "cancelWorkingOrder", orderId }).status)
      .toBe("applied");
    expect(coordinator.getSnapshot().execution.workingOrders).toHaveLength(0);
    expect(coordinator.getSnapshot().account.reservedMargin).toBe(BigInt(0));
  });

  it("publishes WARNING, DANGER and breach health from risk-relevant marks", () => {
    const warningBars = candles(20, "15m", (index) => index === 1 ? 9930.1 : 10_000);
    const warning = setup("one", { candles: warningBars, datasetId: "warning" });
    trade(warning, market("buy", "5", "10000", "20"));
    advance(warning, 1);
    expect(warning.getSnapshot().readModel.risk.dailyLoss.status).toBe("WARNING");

    const dangerBars = candles(20, "15m", (index) => index === 1 ? 9915 : 10_000);
    const danger = setup("one", { candles: dangerBars, datasetId: "danger" });
    trade(danger, market("buy", "5", "10000", "20"));
    advance(danger, 1);
    expect(danger.getSnapshot().readModel.risk.dailyLoss.status).toBe("DANGER");

    const breachBars = candles(20, "15m", (index) => index === 1 ? 9909.9 : 10_000);
    const breach = setup("one", { candles: breachBars, datasetId: "breach" });
    trade(breach, market("buy", "5", "10000", "20"));
    advance(breach, 1);
    expect(breach.getSnapshot().lifecycle.status).toBe("FAILED");
    expect(breach.getSnapshot().readModel.lifecycle.terminalBreachEvidence?.ruleId)
      .toBe("phase-1.daily-loss");
  });

  it("records both inclusive loss breaches and preserves deterministic primary order", () => {
    const bars = candles(20, "15m", (index) => index === 1 ? 9799.9 : 10_000);
    const coordinator = setup("one", { candles: bars });
    trade(coordinator, market("buy", "5", "10000", "20"));
    advance(coordinator, 1);
    const phase = coordinator.getSnapshot().lifecycle.phases[0];
    expect(phase.breaches.map((item) => item.ruleId)).toEqual([
      "phase-1.daily-loss", "phase-1.maximum-loss",
    ]);
    expect(phase.primaryBreach?.ruleId).toBe("phase-1.daily-loss");
  });

  it("updates target progress but cannot pass with an open position", () => {
    const coordinator = setup();
    trade(coordinator, market("buy", "1", "10000"));
    // A replay mark can satisfy equity, but the approved target observes settled cash.
    expect(advance(coordinator, 1).status).toBe("applied");
    expect(coordinator.getSnapshot().readModel.progress.targetReached).toBe(false);
    expect(coordinator.getSnapshot().lifecycle.status).toBe("ACTIVE");
  });

  it("keeps a reached target active until the account is flat", () => {
    const coordinator = setup("one", {
      candles: candles(10, "1d"), timeframe: "1d", datasetId: "flat-gate",
    });
    roundTrip(coordinator); advance(coordinator, 1);
    roundTrip(coordinator); advance(coordinator, 2);
    roundTrip(coordinator);
    trade(coordinator, market("buy", "0.1", "10000"));
    advance(coordinator, 3);
    expect(coordinator.getSnapshot().readModel.progress.targetReached).toBe(true);
    expect(coordinator.getSnapshot().readModel.progress.profitableDaysCompleted).toBe(3);
    expect(coordinator.getSnapshot().lifecycle.status).toBe("ACTIVE");
    trade(coordinator, { kind: "closeFull", observedPrice: "10000" });
    expect(coordinator.getSnapshot().lifecycle.status).toBe("PASSED");
  });
  it("injects UTC boundaries without trades and marks an overnight position", () => {
    const coordinator = setup("one", { startingCursor: 95, datasetId: "overnight" });
    expect(coordinator.getSnapshot().account.closedDays).toHaveLength(0);
    trade(coordinator, market("buy", "0.1", "10000"));
    advance(coordinator, 96);
    const snapshot = coordinator.getSnapshot();
    expect(snapshot.account.closedDays).toHaveLength(1);
    expect(snapshot.account.closedDays[0].closedAt).toBe(utcInstant(2026, 1, 2));
    expect(snapshot.account.position?.currentMark).toBe("10000");

    const noTrade = setup("one", { startingCursor: 95, datasetId: "no-trade-boundary" });
    advance(noTrade, 96);
    expect(noTrade.getSnapshot().account.closedDays).toHaveLength(1);
  });

  it("qualifies active and finalized profitable days and passes One-Step end to end", () => {
    const coordinator = setup("one", { candles: candles(10, "1d"), timeframe: "1d", datasetId: "one-pass" });
    roundTrip(coordinator);
    advance(coordinator, 1);
    roundTrip(coordinator);
    advance(coordinator, 2);
    roundTrip(coordinator);
    expect(coordinator.getSnapshot().readModel.progress.activeDaysCompleted).toBe(3);
    expect(coordinator.getSnapshot().readModel.progress.profitableDaysCompleted).toBe(2);
    advance(coordinator, 3);
    const snapshot = coordinator.getSnapshot();
    expect(snapshot.readModel.progress.profitableDaysCompleted).toBe(3);
    expect(snapshot.lifecycle.status).toBe("PASSED");
    expect(snapshot.readModel.lifecycle.phaseStatus).toBe("PASSED");
  });

  it("starts Two-Step Phase 2 fresh on the next causal observation and can pass it", () => {
    const coordinator = setup("two", { candles: candles(10, "1d"), timeframe: "1d", datasetId: "two-pass" });
    roundTrip(coordinator);
    advance(coordinator, 1);
    roundTrip(coordinator);
    advance(coordinator, 2);
    roundTrip(coordinator);
    const result = advance(coordinator, 3);
    expect(result.decisions.map((item) => item.kind)).toContain("NextPhaseEligible");
    let snapshot = coordinator.getSnapshot();
    expect(snapshot.account.phaseId).toBe("phase-2");
    expect(snapshot.lifecycle.phases[0].status).toBe("PASSED");
    expect(snapshot.lifecycle.phases[1].status).toBe("ACTIVE");
    expect(moneyToDecimal(snapshot.account.cashBalance)).toBe("10000");
    expect(snapshot.account.realizedGrossPnl).toBe(BigInt(0));
    expect(snapshot.account.totalCommissions).toBe(BigInt(0));
    expect(snapshot.account.position).toBeNull();
    expect(snapshot.account.reservations).toHaveLength(0);
    expect(snapshot.readModel.progress.requiredCash).toBe(BigInt("10800000000"));

    roundTrip(coordinator);
    advance(coordinator, 4);
    roundTrip(coordinator);
    advance(coordinator, 5);
    roundTrip(coordinator);
    advance(coordinator, 6);
    snapshot = coordinator.getSnapshot();
    expect(snapshot.lifecycle.status).toBe("PASSED");
    expect(snapshot.lifecycle.phases[1].status).toBe("PASSED");
  });

  it("holds Phase 1 eligibility until the next causal market observation", () => {
    const coordinator = setup("two", {
      candles: candles(10, "1d"), timeframe: "1d", datasetId: "phase-handoff",
    });
    roundTrip(coordinator, "10000", "10031"); advance(coordinator, 1);
    roundTrip(coordinator, "10000", "10031"); advance(coordinator, 2);
    roundTrip(coordinator, "10000", "10031"); advance(coordinator, 3);
    expect(coordinator.getSnapshot().readModel.progress.profitableDaysCompleted).toBe(3);
    roundTrip(coordinator, "10000", "11000");
    let snapshot = coordinator.getSnapshot();
    expect(snapshot.lifecycle.phases[0].status).toBe("PASSED");
    expect(snapshot.account.phaseId).toBe("phase-1");
    expect(snapshot.pendingPhaseTransition).toBe(true);
    expect(snapshot.readModel.lifecycle.nextPhaseEligible).toBe(true);

    advance(coordinator, 4);
    snapshot = coordinator.getSnapshot();
    expect(snapshot.account.phaseId).toBe("phase-2");
    expect(snapshot.account.phaseStartedAt).toBe(utcInstant(2026, 1, 5));
    expect(snapshot.account.cashBalance).toBe(BigInt("10000000000"));
  });
  it("can fail Phase 2 without leaking Phase 1 finances", () => {
    const bars = candles(10, "1d");
    const coordinator = setup("two", { candles: bars, timeframe: "1d", datasetId: "phase2-fail" });
    roundTrip(coordinator); advance(coordinator, 1);
    roundTrip(coordinator); advance(coordinator, 2);
    roundTrip(coordinator); advance(coordinator, 3);
    expect(coordinator.getSnapshot().account.phaseId).toBe("phase-2");
    trade(coordinator, market("buy", "5", "10000", "20"));
    const current = coordinator.getSnapshot().cursor;
    bars[current + 1] = { ...bars[current + 1], open: 9_700, high: 9_700, low: 9_700, close: 9_700 };
    // Dataset mutation cannot affect the frozen attempt, so use an explicit losing close.
    trade(coordinator, { kind: "closeFull", observedPrice: "8000" });
    expect(coordinator.getSnapshot().lifecycle.status).toBe("FAILED");
    expect(coordinator.getSnapshot().lifecycle.phases[0].status).toBe("PASSED");
  });

  it("blocks terminal trading while preserving replay navigation", () => {
    const bars = candles(20, "15m", (index) => index === 1 ? 9700 : 10_000);
    const coordinator = setup("one", { candles: bars });
    trade(coordinator, market("buy", "5", "10000", "20"));
    advance(coordinator, 1);
    const before = coordinator.getSnapshot();
    const blocked = trade(coordinator, market("buy", "0.1", "9700"));
    expect(blocked.status).toBe("rejected");
    if (blocked.status === "rejected") expect(blocked.rejection.code).toBe("TERMINAL_CHALLENGE");
    expect(coordinator.getSnapshot()).toBe(before);
    expect(advance(coordinator, 2).status).toBe("applied");
    expect(coordinator.getSnapshot().lifecycle.status).toBe("FAILED");
  });

  it("breaches inactivity at exact logical time without a user command", () => {
    const coordinator = setup("one", {
      candles: candles(35, "1d"), timeframe: "1d", datasetId: "inactivity",
    });
    advance(coordinator, 30, 10);
    expect(coordinator.getSnapshot().readModel.risk.inactivity.breached).toBe(true);
    expect(coordinator.getSnapshot().lifecycle.status).toBe("FAILED");
  });

  it("removes future warning state when rewound to its causal prefix", () => {
    const bars = candles(20, "15m", (index) => index === 2 ? 9930.1 : 10_000);
    const coordinator = setup("one", { candles: bars, datasetId: "warning-rewind" });
    trade(coordinator, market("buy", "5", "10000", "20"));
    advance(coordinator, 2);
    expect(coordinator.getSnapshot().readModel.risk.dailyLoss.status).toBe("WARNING");
    coordinator.rewind(coordinator.getContext(), 1);
    expect(coordinator.getSnapshot().readModel.risk.dailyLoss.status).toBe("SAFE");
    expect(coordinator.getSnapshot().lifecycle.status).toBe("ACTIVE");
  });
  it("rewinds failed and passed futures into fresh deterministic branches", () => {
    const bars = candles(400, "15m", (index) => index === 2 ? 9700 : 10_000);
    const failed = setup("one", { candles: bars, datasetId: "failed-rewind" });
    trade(failed, market("buy", "5", "10000", "20"));
    advance(failed, 2);
    expect(failed.getSnapshot().lifecycle.status).toBe("FAILED");
    const old = failed.getContext();
    expect(failed.rewind(old, 0).status).toBe("applied");
    expect(failed.getSnapshot().lifecycle.status).toBe("ACTIVE");
    expect(failed.getContext().branchId).not.toBe(old.branchId);
    expect(failed.getContext().generation).toBe(1);
    expect(failed.getArchivedBranches()).toHaveLength(1);

    const passed = setup("one", { candles: candles(10, "1d"), timeframe: "1d", datasetId: "passed-rewind" });
    roundTrip(passed); advance(passed, 1);
    roundTrip(passed); advance(passed, 2);
    roundTrip(passed); advance(passed, 3);
    expect(passed.getSnapshot().lifecycle.status).toBe("PASSED");
    passed.rewind(passed.getContext(), 1);
    expect(passed.getSnapshot().lifecycle.status).toBe("ACTIVE");
    expect(passed.getSnapshot().readModel.progress.profitableDaysCompleted).toBe(1);
  });

  it("rewinds from Phase 2 into Phase 1 and removes future phase state", () => {
    const coordinator = setup("two", { candles: candles(10, "1d"), timeframe: "1d", datasetId: "phase-rewind" });
    roundTrip(coordinator); advance(coordinator, 1);
    roundTrip(coordinator); advance(coordinator, 2);
    roundTrip(coordinator); advance(coordinator, 3);
    expect(coordinator.getSnapshot().account.phaseId).toBe("phase-2");
    coordinator.rewind(coordinator.getContext(), 1);
    const snapshot = coordinator.getSnapshot();
    expect(snapshot.account.phaseId).toBe("phase-1");
    expect(snapshot.lifecycle.phases[0].status).toBe("ACTIVE");
    expect(snapshot.lifecycle.phases[1].status).toBe("LOCKED");
  });

  it("reconstructs forward and prefix state from immutable inputs and action history", () => {
    const coordinator = setup("one", { datasetId: "reconstruct" });
    trade(coordinator, market("buy", "1", "10000"));
    advance(coordinator, 3);
    trade(coordinator, { kind: "closePartial", quantity: "0.4", observedPrice: "10100" });
    advance(coordinator, 7, 10);
    trade(coordinator, { kind: "closeFull", observedPrice: "10200" });
    const journal = coordinator.exportJournal();
    const rebuilt = reconstructReplayChallenge(journal).snapshot;
    expect(canonicalHash(rebuilt)).toBe(canonicalHash(coordinator.getSnapshot()));

    const prefix = reconstructReplayChallenge({
      ...journal,
      cursor: 3,
      actions: journal.actions.filter((action) => action.cursor <= 3),
    }).snapshot;
    expect(prefix.cursor).toBe(3);
    expect(prefix.account.position?.quantity).toBe("0.6");
    expect(prefix.account.fills).toHaveLength(2);
  });

  it("makes replay speed economically irrelevant", () => {
    const slow = setup("one", { datasetId: "speed" });
    trade(slow, market("buy", "1", "10000"));
    advance(slow, 10, 1);
    const fast = setup("one", { datasetId: "speed" });
    trade(fast, market("buy", "1", "10000"));
    advance(fast, 10, 10);
    expect(canonicalHash(fast.getSnapshot())).toBe(canonicalHash(slow.getSnapshot()));
  });

  it("rejects dataset, timeframe, session, generation, branch, phase, account and cursor drift", () => {
    const coordinator = setup();
    const context = coordinator.getContext();
    const cases: [Partial<ChallengeReplayContext>, string][] = [
      [{ datasetHash: "wrong" }, "DATASET_HASH_MISMATCH"],
      [{ executionTimeframe: "5m" }, "TIMEFRAME_MISMATCH"],
      [{ replaySessionId: replaySessionId("wrong") }, "REPLAY_SESSION_MISMATCH"],
      [{ generation: 1 }, "STALE_GENERATION"],
      [{ branchId: branchId("wrong") }, "WRONG_BRANCH"],
      [{ phaseId: phaseId("phase-2") }, "WRONG_PHASE"],
      [{ accountId: accountId("wrong") }, "WRONG_ACCOUNT"],
      [{ cursor: 1 }, "WRONG_CURSOR"],
    ];
    for (const [patch, code] of cases) {
      const result = coordinator.trade({ ...context, ...patch }, market("buy", "0.1", "10000"));
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.rejection.code).toBe(code);
    }
  });

  it("rejects content hash mutation and never regenerates candles", () => {
    const dataset = freezeChallengeReplayDataset({
      datasetId: "immutable", symbol: "BTCUSDT", executionTimeframe: "15m",
      candles: candles(20),
    });
    const forged = { ...dataset, datasetHash: "forged" };
    const definition = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000", selectedSymbol: "BTCUSDT", mode: "replay",
    });
    expect(() => startReplayChallenge({
      frozenDefinition: definition,
      selectedPhase: phaseId("phase-1"),
      dataset: forged,
      executionTimeframe: "15m",
      startingCursor: 0,
      identities: {
        challengeId: challengeId("immutable"), accountId: accountId("immutable"),
        phaseId: phaseId("phase-1"), replaySessionId: replaySessionId("immutable"),
        branchId: branchId("immutable"), generation: 0,
      },
    })).toThrow(/hash mismatch/i);
  });

  it("does not finalize a partial day when the dataset is exhausted", () => {
    const coordinator = setup("one", { candles: candles(10), datasetId: "exhausted" });
    const result = advance(coordinator, 100, 10);
    expect(result.status).toBe("rejected");
    expect(coordinator.getSnapshot().availability).toBe("DATASET_EXHAUSTED");
    expect(coordinator.getSnapshot().account.closedDays).toHaveLength(0);
  });
});











