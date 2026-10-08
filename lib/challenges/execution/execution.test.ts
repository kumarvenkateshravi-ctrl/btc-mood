import { describe, expect, it } from "vitest";
import {
  accountId, branchId, challengeId, instantMs, phaseId, replaySessionId,
} from "../domain/types";
import { decimalText, moneyFromDecimal } from "../domain/money";
import {
  BTC_EXECUTION_POLICY_V1, BTC_INSTRUMENT_POLICY_V1,
} from "../domain/templates";
import {
  commandId, lifecycleId, positionId, reservationId, workingOrderId,
} from "./policy";
import { createExecutionState, reduceExecutionCommand } from "./reducer";
import { replayCandleObservations } from "./replay";
import type {
  ChallengeExecutionEnvironment, ExecutionCommand, ExecutionFact,
  ExecutionResult, ExecutionState, MarketOrderCommand,
  ObservePriceCommand, PlaceWorkingEntryCommand, UpdateProtectionCommand,
} from "./types";

const env: ChallengeExecutionEnvironment = {
  instrumentPolicy: BTC_INSTRUMENT_POLICY_V1,
  executionPolicy: BTC_EXECUTION_POLICY_V1,
  maximumLeverage: decimalText("20"),
};
const replayScope = {
  mode: "replay" as const,
  accountId: accountId("account-1"),
  challengeId: challengeId("challenge-1"),
  phaseId: phaseId("phase-1"),
  generation: 0,
  replaySessionId: replaySessionId("replay-1"),
  branchId: branchId("branch-1"),
  datasetHash: "dataset-sha256",
};
const liveScope = {
  mode: "live" as const,
  accountId: accountId("account-1"),
  challengeId: challengeId("challenge-1"),
  phaseId: phaseId("phase-1"),
  generation: 0,
};
const cash = moneyFromDecimal("10000");
const time = instantMs(1_700_000_000_000);
let counter = 0;

function market(
  patch: Partial<MarketOrderCommand> = {},
): MarketOrderCommand {
  counter += 1;
  return {
    kind: "marketOrder",
    commandId: commandId("market-" + counter),
    scope: replayScope,
    symbol: "BTCUSDT",
    occurredAt: time,
    side: "buy",
    quantity: "1",
    observedPrice: "99.9",
    leverage: "10",
    availableMarginForAdmission: cash,
    reason: "manual",
    newPositionId: positionId("position-" + counter),
    newLifecycleId: lifecycleId("lifecycle-" + counter),
    ...patch,
  };
}
function observe(
  price: string,
  transition: "gap" | "segment" = "segment",
): ObservePriceCommand {
  counter += 1;
  return {
    kind: "observePrice",
    commandId: commandId("observe-" + counter),
    scope: replayScope,
    symbol: "BTCUSDT",
    occurredAt: time,
    price,
    transition,
    pathIndex: counter,
  };
}
function protect(update: UpdateProtectionCommand["update"]): UpdateProtectionCommand {
  counter += 1;
  return {
    kind: "updateProtection",
    commandId: commandId("protect-" + counter),
    scope: replayScope,
    symbol: "BTCUSDT",
    occurredAt: time,
    update,
  };
}
function working(
  patch: Partial<PlaceWorkingEntryCommand> = {},
): PlaceWorkingEntryCommand {
  counter += 1;
  return {
    kind: "placeWorkingEntry",
    commandId: commandId("working-command-" + counter),
    scope: replayScope,
    symbol: "BTCUSDT",
    occurredAt: time,
    orderId: workingOrderId("working-" + counter),
    reservationId: reservationId("reservation-" + counter),
    side: "buy",
    orderType: "limit",
    quantity: "1",
    triggerPrice: "100",
    leverage: "10",
    availableMarginForAdmission: cash,
    newPositionId: positionId("working-position-" + counter),
    newLifecycleId: lifecycleId("working-lifecycle-" + counter),
    ...patch,
  };
}
function apply(state: ExecutionState, command: ExecutionCommand): ExecutionState {
  const result = reduceExecutionCommand(state, command, env);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.rejection.message);
  return result.state;
}
function accepted(
  state: ExecutionState,
  command: ExecutionCommand,
): Extract<ExecutionResult, { ok: true }> {
  const result = reduceExecutionCommand(state, command, env);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.rejection.message);
  return result;
}
function facts(result: ExecutionResult, kind: ExecutionFact["kind"]): ExecutionFact[] {
  return result.facts.filter((fact) => fact.kind === kind);
}
function fresh(): ExecutionState {
  return createExecutionState(replayScope, env);
}
function openLong(quantity = "1", protection?: MarketOrderCommand["protection"]): ExecutionState {
  return apply(fresh(), market({ quantity, protection }));
}
function openShort(quantity = "1", protection?: MarketOrderCommand["protection"]): ExecutionState {
  return apply(fresh(), market({
    side: "sell", quantity, observedPrice: "100.1", protection,
  }));
}

describe("Challenge BTC execution transitions", () => {
  it("1 opens a long position", () => {
    const result = accepted(fresh(), market());
    expect(result.state.position).toMatchObject({
      side: "long", quantity: "1", entryPrice: "100",
    });
    expect(result.facts.map((x) => x.kind)).toEqual([
      "FillCommitted", "CommissionAssessed", "MarginTransitioned",
      "PositionTransitioned",
    ]);
  });

  it("2 opens a short position", () => {
    const state = openShort();
    expect(state.position).toMatchObject({
      side: "short", quantity: "1", entryPrice: "100",
    });
  });

  it("3 increases a long and recomputes exact average entry", () => {
    let state = openLong();
    state = apply(state, market({
      side: "buy", quantity: "1", observedPrice: "109.9",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(state.position).toMatchObject({ quantity: "2", entryPrice: "105" });
  });

  it("4 increases a short", () => {
    let state = openShort();
    state = apply(state, market({
      side: "sell", quantity: "1", observedPrice: "90.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(state.position).toMatchObject({ side: "short", quantity: "2", entryPrice: "95" });
  });

  it("5 partially closes a long and retains the residual", () => {
    const state = apply(openLong("10"), market({
      side: "sell", quantity: "4", observedPrice: "110.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(state.position).toMatchObject({ side: "long", quantity: "6" });
  });

  it("6 partially closes a short and retains the residual", () => {
    const state = apply(openShort("10"), market({
      side: "buy", quantity: "4", observedPrice: "89.9",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(state.position).toMatchObject({ side: "short", quantity: "6" });
  });

  it("7 fully closes a long", () => {
    const state = apply(openLong(), market({
      side: "sell", observedPrice: "110.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(state.position).toBeNull();
    expect(state.margin.used).toBe(BigInt(0));
  });

  it("8 fully closes a short", () => {
    const state = apply(openShort(), market({
      side: "buy", observedPrice: "89.9",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(state.position).toBeNull();
  });

  it("9 reverses long to short with a fresh lifecycle", () => {
    const before = openLong();
    const oldLifecycle = before.position?.lifecycleId;
    const state = apply(before, market({
      side: "sell", quantity: "2", observedPrice: "90.1",
      newPositionId: positionId("reverse-short"),
      newLifecycleId: lifecycleId("reverse-short-life"),
    }));
    expect(state.position).toMatchObject({ side: "short", quantity: "1" });
    expect(state.position?.lifecycleId).not.toBe(oldLifecycle);
  });

  it("10 reverses short to long with a fresh lifecycle", () => {
    const state = apply(openShort(), market({
      side: "buy", quantity: "2", observedPrice: "109.9",
      newPositionId: positionId("reverse-long"),
      newLifecycleId: lifecycleId("reverse-long-life"),
    }));
    expect(state.position).toMatchObject({ side: "long", quantity: "1" });
  });

  it("11 clears old protection on reversal", () => {
    const state = apply(openLong("1", { stopLoss: "90", takeProfit: "120" }),
      market({
        side: "sell", quantity: "2", observedPrice: "100.1",
        newPositionId: positionId("fresh-position"),
        newLifecycleId: lifecycleId("fresh-life"),
      }));
    expect(state.position?.protection).toEqual({
      stopLoss: null, takeProfit: null, trailingEnabled: false,
      trailingDistance: null, trailingBestPrice: null,
    });
  });

  it("12 emits entry commission exactly once", () => {
    const result = accepted(fresh(), market());
    const commissions = facts(result, "CommissionAssessed");
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({
      classification: "entry", amount: BigInt(100_000),
    });
  });

  it("13 emits exit commission exactly once", () => {
    const result = accepted(openLong(), market({
      side: "sell", observedPrice: "110.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    const commissions = facts(result, "CommissionAssessed");
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({
      classification: "exit", amount: BigInt(110_000),
    });
  });

  it("14 allocates entry fee proportionally on partial close", () => {
    const result = accepted(openLong("10"), market({
      side: "sell", quantity: "4", observedPrice: "110.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    const allocation = facts(result, "EntryFeeAllocated")[0];
    expect(allocation).toMatchObject({
      allocatedAmount: BigInt(400_000),
      remainingAmount: BigInt(600_000),
      finalAllocation: false,
      ledgerEffect: "none",
    });
  });

  it("15 assigns every rounding remainder to the final close", () => {
    let state = openLong("3");
    const first = accepted(state, market({
      side: "sell", quantity: "1", observedPrice: "100.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    state = first.state;
    const final = accepted(state, market({
      side: "sell", quantity: "2", observedPrice: "100.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    const a = facts(first, "EntryFeeAllocated")[0];
    const b = facts(final, "EntryFeeAllocated")[0];
    if (a.kind !== "EntryFeeAllocated" || b.kind !== "EntryFeeAllocated") {
      throw new Error("missing allocation");
    }
    expect(a.allocatedAmount + b.allocatedAmount).toBe(BigInt(300_000));
    expect(b.remainingAmount).toBe(BigInt(0));
    expect(b.finalAllocation).toBe(true);
  });

  it("16 produces the fee-complete exact round-trip result 10097.90", () => {
    const entry = accepted(fresh(), market({ quantity: "10" }));
    const exit = accepted(entry.state, market({
      side: "sell", quantity: "10", observedPrice: "110.1",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    const entryFee = facts(entry, "CommissionAssessed")[0];
    const exitFee = facts(exit, "CommissionAssessed")[0];
    const fill = facts(exit, "FillCommitted")[0];
    if (entryFee.kind !== "CommissionAssessed" ||
        exitFee.kind !== "CommissionAssessed" ||
        fill.kind !== "FillCommitted") throw new Error("missing facts");
    const finalCash = cash - entryFee.amount +
      fill.fill.grossRealizedPnl - exitFee.amount;
    expect(finalCash).toBe(BigInt(10_097_900_000));
  });

  it("17 fills a normal long stop crossing at the stop", () => {
    const result = accepted(
      openLong("1", { stopLoss: "90" }), observe("89", "segment"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill.price).toBe("90");
  });

  it("18 fills a long gap-through stop at first adverse observation", () => {
    const result = accepted(
      openLong("1", { stopLoss: "90" }), observe("85.04", "gap"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill.price).toBe("85");
  });

  it("19 fills a normal short stop crossing at the stop", () => {
    const result = accepted(
      openShort("1", { stopLoss: "110" }), observe("111", "segment"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill.price).toBe("110");
  });

  it("20 fills a short gap-through stop at first adverse observation", () => {
    const result = accepted(
      openShort("1", { stopLoss: "110" }), observe("115.04", "gap"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill.price).toBe("115.1");
  });

  it("21 fills a long take profit at its target", () => {
    const result = accepted(
      openLong("1", { takeProfit: "120" }), observe("125", "segment"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill.price).toBe("120");
  });

  it("22 fills a short take profit at its target", () => {
    const result = accepted(
      openShort("1", { takeProfit: "80" }), observe("75", "segment"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill.price).toBe("80");
  });

  it("23 activates trailing only with initial risk", () => {
    const result = accepted(openLong(), protect({
      stopLoss: "90", trailingEnabled: true,
    }));
    expect(result.state.position?.protection).toMatchObject({
      trailingEnabled: true, trailingDistance: "10",
      trailingBestPrice: "100",
    });
  });

  it("24 ratchets a long trailing stop upward", () => {
    let state = apply(openLong(), protect({
      stopLoss: "90", trailingEnabled: true,
    }));
    state = apply(state, observe("110"));
    expect(state.position?.protection).toMatchObject({
      stopLoss: "100", trailingBestPrice: "110",
    });
  });

  it("25 ratchets a short trailing stop downward", () => {
    let state = apply(openShort(), protect({
      stopLoss: "110", trailingEnabled: true,
    }));
    state = apply(state, observe("90"));
    expect(state.position?.protection).toMatchObject({
      stopLoss: "100", trailingBestPrice: "90",
    });
  });

  it("26 rejects loosening an active trailing stop", () => {
    const state = apply(openLong(), protect({
      stopLoss: "90", trailingEnabled: true,
    }));
    const result = reduceExecutionCommand(state, protect({ stopLoss: "89" }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("INVALID_PROTECTION");
  });

  it("27 modifies and removes SL and TP explicitly", () => {
    let state = apply(openLong(), protect({
      stopLoss: "90", takeProfit: "120",
    }));
    state = apply(state, protect({ stopLoss: null, takeProfit: null }));
    expect(state.position?.protection).toMatchObject({
      stopLoss: null, takeProfit: null,
    });
  });

  it("28 preserves protection across a partial close", () => {
    const state = apply(
      openLong("10", { stopLoss: "90", takeProfit: "120" }),
      market({
        side: "sell", quantity: "4", observedPrice: "110.1",
        newPositionId: undefined, newLifecycleId: undefined,
      }),
    );
    expect(state.position?.protection).toMatchObject({
      stopLoss: "90", takeProfit: "120",
    });
  });

  it("29 triggers a working limit entry", () => {
    const state = apply(fresh(), working());
    const result = accepted(state, observe("90"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill).toMatchObject({
      reason: "workingLimit", price: "100",
    });
  });

  it("30 triggers a working stop entry with slippage", () => {
    const state = apply(fresh(), working({
      orderType: "stop", triggerPrice: "120",
    }));
    const result = accepted(state, observe("121"));
    const fill = facts(result, "FillCommitted")[0];
    expect(fill.kind === "FillCommitted" && fill.fill).toMatchObject({
      reason: "workingStop", price: "120.1",
    });
  });

  it("31 reserves margin when a working order is placed", () => {
    const result = accepted(fresh(), working());
    expect(result.state.margin.reserved).toBe(BigInt(10_000_000));
    expect(facts(result, "ReservationTransitioned")).toHaveLength(1);
  });

  it("32 releases reserved margin when a working order fills", () => {
    const state = apply(fresh(), working());
    const result = accepted(state, observe("90"));
    expect(result.state.margin.reserved).toBe(BigInt(0));
    expect(result.state.reservations).toHaveLength(0);
  });

  it("33 cancels a working order and releases reservation", () => {
    const placed = apply(fresh(), working());
    const orderId = placed.workingOrders[0].orderId;
    counter += 1;
    const result = accepted(placed, {
      kind: "cancelWorkingOrder",
      commandId: commandId("cancel-" + counter),
      scope: replayScope,
      symbol: "BTCUSDT",
      occurredAt: time,
      orderId,
      reason: "user",
    });
    expect(result.state.workingOrders).toHaveLength(0);
    expect(result.state.margin.reserved).toBe(BigInt(0));
  });

  it("34 cancels OCO siblings after one entry fills", () => {
    let state = apply(fresh(), working({
      orderId: workingOrderId("oco-a"),
      reservationId: reservationId("oco-ra"),
      newPositionId: positionId("oco-pa"),
      newLifecycleId: lifecycleId("oco-la"),
      triggerPrice: "100",
      ocoGroupId: "oco-1",
    }));
    state = apply(state, working({
      orderId: workingOrderId("oco-b"),
      reservationId: reservationId("oco-rb"),
      newPositionId: positionId("oco-pb"),
      newLifecycleId: lifecycleId("oco-lb"),
      triggerPrice: "80",
      ocoGroupId: "oco-1",
    }));
    const result = accepted(state, observe("90"));
    expect(result.state.position).not.toBeNull();
    expect(result.state.workingOrders).toHaveLength(0);
    expect(facts(result, "WorkingOrderCancelled")).toHaveLength(1);
  });

  it("35 rejects exposure above maximum leverage", () => {
    const result = reduceExecutionCommand(
      fresh(), market({ leverage: "20.000001" }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("LEVERAGE_EXCEEDED");
  });

  it("36 permits a reducing trade even when supplied leverage is excessive", () => {
    const result = accepted(openLong(), market({
      side: "sell", quantity: "0.5", observedPrice: "100.1", leverage: "999",
      newPositionId: undefined, newLifecycleId: undefined,
    }));
    expect(result.state.position?.quantity).toBe("0.5");
  });

  it("37 rejects insufficient margin on entry", () => {
    const result = reduceExecutionCommand(fresh(), market({
      availableMarginForAdmission: moneyFromDecimal("9.99"),
    }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("INSUFFICIENT_MARGIN");
  });

  it("38 rejects insufficient margin on a reversal residual", () => {
    const result = reduceExecutionCommand(openLong(), market({
      side: "sell", quantity: "2", observedPrice: "100.1",
      availableMarginForAdmission: moneyFromDecimal("9.99"),
      newPositionId: positionId("reversal-low-margin"),
      newLifecycleId: lifecycleId("reversal-low-margin-life"),
    }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("INSUFFICIENT_MARGIN");
  });

  it("39 rejects an off-tick working price", () => {
    const result = reduceExecutionCommand(fresh(), working({
      triggerPrice: "100.01",
    }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("OFF_TICK");
  });

  it("40 rejects an off-step quantity", () => {
    const result = reduceExecutionCommand(fresh(), market({
      quantity: "0.000011",
    }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("OFF_STEP");
  });

  it("41 rejects quantity below the frozen minimum", () => {
    const result = reduceExecutionCommand(fresh(), market({
      quantity: "0.000001",
    }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["BELOW_MINIMUM_QUANTITY", "OFF_STEP"]).toContain(
        result.rejection.code);
    }
  });

  it("42 rejects notional below the frozen minimum", () => {
    const result = reduceExecutionCommand(fresh(), market({
      quantity: "0.00001",
    }), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("BELOW_MINIMUM_NOTIONAL");
  });

  it("43 makes duplicate command retry a no-op", () => {
    const command = market();
    const first = accepted(fresh(), command);
    const retry = reduceExecutionCommand(first.state, command, env);
    expect(retry.ok).toBe(false);
    expect(retry.state).toBe(first.state);
    expect(retry.facts).toEqual([]);
    if (!retry.ok) expect(retry.rejection.code).toBe("DUPLICATE_COMMAND");
  });

  it("44 produces identical state and facts for identical inputs", () => {
    const command = market();
    const left = reduceExecutionCommand(fresh(), command, env);
    const right = reduceExecutionCommand(fresh(), command, env);
    expect(right).toEqual(left);
  });

  it("45 derives the frozen up and down replay intrabar paths", () => {
    const seed = {
      commandIdPrefix: "candle",
      scope: replayScope,
      symbol: "BTCUSDT" as const,
      occurredAt: time,
    };
    expect(replayCandleObservations(seed, {
      open: "100", high: "120", low: "80", close: "110",
    }, BTC_EXECUTION_POLICY_V1).map((x) => x.price)).toEqual([
      "100", "80", "120", "110",
    ]);
    expect(replayCandleObservations(seed, {
      open: "100", high: "120", low: "80", close: "90",
    }, BTC_EXECUTION_POLICY_V1).map((x) => x.price)).toEqual([
      "100", "120", "80", "90",
    ]);
  });

  it("46 gives replay and live scopes the same canonical fill economics", () => {
    const replayCommand = market();
    const liveCommand: MarketOrderCommand = {
      ...replayCommand,
      commandId: commandId("live-equivalent"),
      scope: liveScope,
    };
    const replayResult = accepted(fresh(), replayCommand);
    const liveResult = accepted(createExecutionState(liveScope, env), liveCommand);
    const replayFill = facts(replayResult, "FillCommitted")[0];
    const liveFill = facts(liveResult, "FillCommitted")[0];
    if (replayFill.kind !== "FillCommitted" || liveFill.kind !== "FillCommitted") {
      throw new Error("missing fill");
    }
    expect({
      side: liveFill.fill.side,
      quantity: liveFill.fill.quantity,
      price: liveFill.fill.price,
      notional: liveFill.fill.notional,
    }).toEqual({
      side: replayFill.fill.side,
      quantity: replayFill.fill.quantity,
      price: replayFill.fill.price,
      notional: replayFill.fill.notional,
    });
  });

  it("47 rejects a command from a different replay branch", () => {
    const command = market({
      scope: { ...replayScope, branchId: branchId("branch-2") },
    });
    const result = reduceExecutionCommand(fresh(), command, env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("SCOPE_MISMATCH");
  });

  it("48 records caller time and deterministic derived IDs only", () => {
    const command = market();
    const result = accepted(fresh(), command);
    expect(result.facts.every((x) => x.occurredAt === time)).toBe(true);
    expect(result.facts.map((x) => String(x.factId))).toEqual([
      String(command.commandId) + ":fact:1",
      String(command.commandId) + ":fact:2",
      String(command.commandId) + ":fact:3",
      String(command.commandId) + ":fact:4",
    ]);
  });
});
