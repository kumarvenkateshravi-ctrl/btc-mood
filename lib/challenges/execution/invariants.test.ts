import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/btc-execution-v1.golden.json";
import {
  accountId, branchId, challengeId, instantMs, phaseId, replaySessionId,
} from "../domain/types";
import { decimalText, moneyFromDecimal } from "../domain/money";
import {
  BTC_EXECUTION_POLICY_V1, BTC_INSTRUMENT_POLICY_V1,
} from "../domain/templates";
import {
  commandId, lifecycleId, normalizeDerivedPrice, normalizeDerivedQuantity,
  positionId,
} from "./policy";
import { createExecutionState, reduceExecutionCommand } from "./reducer";
import { replayCandleObservations } from "./replay";
import type {
  ChallengeExecutionEnvironment, ExecutionCommand, ExecutionResult,
  ExecutionState, MarketOrderCommand,
} from "./types";

const env: ChallengeExecutionEnvironment = {
  instrumentPolicy: BTC_INSTRUMENT_POLICY_V1,
  executionPolicy: BTC_EXECUTION_POLICY_V1,
  maximumLeverage: decimalText("20"),
};
const scope = {
  mode: "replay" as const,
  accountId: accountId("invariant-account"),
  challengeId: challengeId("invariant-challenge"),
  phaseId: phaseId("phase-1"),
  generation: 0,
  replaySessionId: replaySessionId("invariant-replay"),
  branchId: branchId("invariant-branch"),
  datasetHash: "fixture-dataset",
};
const at = instantMs(1_700_000_000_000);
let sequence = 0;
function market(patch: Partial<MarketOrderCommand> = {}): MarketOrderCommand {
  sequence += 1;
  return {
    kind: "marketOrder",
    commandId: commandId("invariant-command-" + sequence),
    scope,
    symbol: "BTCUSDT",
    occurredAt: at,
    side: "buy",
    quantity: "10",
    observedPrice: "99.9",
    leverage: "10",
    availableMarginForAdmission: moneyFromDecimal("10000"),
    reason: "manual",
    newPositionId: positionId("invariant-position-" + sequence),
    newLifecycleId: lifecycleId("invariant-lifecycle-" + sequence),
    ...patch,
  };
}
function run(state: ExecutionState, command: ExecutionCommand):
  Extract<ExecutionResult, { ok: true }> {
  const result = reduceExecutionCommand(state, command, env);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.rejection.message);
  return result;
}
const fresh = () => createExecutionState(scope, env);

describe("Challenge BTC execution invariants and golden fixtures", () => {
  it("preserves exact cost basis and proportional used margin on partial close", () => {
    const opened = run(fresh(), market());
    const reduced = run(opened.state, market({
      side: "sell",
      quantity: fixture.partialClose.exit.quantity,
      observedPrice: "110.1",
      newPositionId: undefined,
      newLifecycleId: undefined,
    }));
    expect(reduced.state.position?.quantity)
      .toBe(fixture.partialClose.expected.remainingQuantity);
    expect(reduced.state.position?.costBasis).toBe(moneyFromDecimal(
      fixture.partialClose.expected.remainingCostBasisUsd));
    expect(reduced.state.position?.entryCommissionRemaining).toBe(
      moneyFromDecimal(fixture.partialClose.expected.remainingEntryCommissionUsd));
    expect(reduced.state.margin.used).toBe(moneyFromDecimal(
      fixture.partialClose.expected.usedMarginUsd));
  });

  it("freezes reversal fact ordering and lifecycle boundaries", () => {
    const opened = run(fresh(), market());
    const reversed = run(opened.state, market({
      side: "sell",
      quantity: "14",
      observedPrice: "110.1",
      newPositionId: positionId("ordered-reversal"),
      newLifecycleId: lifecycleId("ordered-reversal-life"),
    }));
    expect(reversed.facts.map((x) => x.kind)).toEqual(
      fixture.reversalFactOrder);
    const transitions = reversed.facts.filter(
      (x) => x.kind === "PositionTransitioned");
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toMatchObject({
      value: { transition: "closed", lifecycleBoundary: "closed" },
    });
    expect(transitions[1]).toMatchObject({
      value: { transition: "opened", lifecycleBoundary: "opened" },
    });
  });

  it("conserves reversal commission across closing and opening facts", () => {
    const opened = run(fresh(), market());
    const reversed = run(opened.state, market({
      side: "sell",
      quantity: "14",
      observedPrice: "110.1",
      newPositionId: positionId("fee-reversal"),
      newLifecycleId: lifecycleId("fee-reversal-life"),
    }));
    const commissions = reversed.facts.filter(
      (x) => x.kind === "CommissionAssessed");
    if (commissions.some((x) => x.kind !== "CommissionAssessed")) {
      throw new Error("missing commission");
    }
    const total = commissions.reduce(
      (sum, x) => sum + (x.kind === "CommissionAssessed" ? x.amount : BigInt(0)),
      BigInt(0));
    expect(total).toBe(moneyFromDecimal("1.54"));
  });

  it("admits exposure at exactly 20x", () => {
    const result = run(fresh(), market({ leverage: "20" }));
    expect(result.state.position?.leverage).toBe("20");
    expect(result.state.margin.used).toBe(moneyFromDecimal("50"));
  });

  it("normalizes derived adverse prices through the frozen instrument policy", () => {
    expect(normalizeDerivedPrice(BTC_INSTRUMENT_POLICY_V1, "85.04", "sell"))
      .toBe("85");
    expect(normalizeDerivedPrice(BTC_INSTRUMENT_POLICY_V1, "115.04", "buy"))
      .toBe("115.1");
  });

  it("normalizes derived quantities toward zero through the frozen policy", () => {
    expect(normalizeDerivedQuantity(
      BTC_INSTRUMENT_POLICY_V1, "0.123456789",
    )).toBe("0.12345");
  });

  it("emits manual close as an exit fill reason", () => {
    const opened = run(fresh(), market({ quantity: "1" }));
    const closed = run(opened.state, market({
      side: "sell", quantity: "1", observedPrice: "110.1",
      newPositionId: undefined, newLifecycleId: undefined,
      reason: "manual",
    }));
    const fill = closed.facts.find((x) => x.kind === "FillCommitted");
    expect(fill?.kind === "FillCommitted" && fill.fill).toMatchObject({
      classification: "exit", reason: "manual",
    });
  });

  it("triggers a ratcheted trailing stop at the modeled stop price", () => {
    const opened = run(fresh(), market({
      quantity: "1",
      protection: { stopLoss: "90", trailingEnabled: true },
    }));
    const up = run(opened.state, {
      kind: "observePrice",
      commandId: commandId("trail-up"),
      scope, symbol: "BTCUSDT", occurredAt: at,
      price: "110", transition: "segment", pathIndex: 1,
    });
    const down = run(up.state, {
      kind: "observePrice",
      commandId: commandId("trail-down"),
      scope, symbol: "BTCUSDT", occurredAt: at,
      price: "99", transition: "segment", pathIndex: 2,
    });
    const fill = down.facts.find((x) => x.kind === "FillCommitted");
    expect(fill?.kind === "FillCommitted" && fill.fill).toMatchObject({
      price: "100", reason: "trailingStop",
    });
  });

  it("rejects invalid working protection before reserving margin", () => {
    sequence += 1;
    const command = {
      kind: "placeWorkingEntry" as const,
      commandId: commandId("invalid-working-protection-" + sequence),
      scope, symbol: "BTCUSDT" as const, occurredAt: at,
      orderId: ("working-invalid-" + sequence) as never,
      reservationId: ("reservation-invalid-" + sequence) as never,
      side: "buy" as const, orderType: "limit" as const,
      quantity: "1", triggerPrice: "100", leverage: "10",
      availableMarginForAdmission: moneyFromDecimal("10000"),
      newPositionId: positionId("invalid-working-position-" + sequence),
      newLifecycleId: lifecycleId("invalid-working-life-" + sequence),
      protection: { stopLoss: "110" },
    };
    const result = reduceExecutionCommand(fresh(), command, env);
    expect(result.ok).toBe(false);
    expect(result.state.margin.reserved).toBe(BigInt(0));
    if (!result.ok) expect(result.rejection.code).toBe("INVALID_PROTECTION");
  });

  it("uses the frozen up-candle path when both SL and TP are reachable", () => {
    let state = run(fresh(), market({
      quantity: "1", protection: { stopLoss: "90", takeProfit: "110" },
    })).state;
    const commands = replayCandleObservations({
      commandIdPrefix: "both-up", scope, symbol: "BTCUSDT", occurredAt: at,
    }, { open: "100", high: "120", low: "80", close: "110" },
    BTC_EXECUTION_POLICY_V1);
    const emitted = [];
    for (const command of commands) {
      const result = run(state, command);
      state = result.state;
      emitted.push(...result.facts);
    }
    const fill = emitted.find((x) => x.kind === "FillCommitted");
    expect(fill?.kind === "FillCommitted" && fill.fill).toMatchObject({
      reason: "stopLoss", price: "90",
    });
  });

  it("uses the frozen down-candle path when both SL and TP are reachable", () => {
    let state = run(fresh(), market({
      quantity: "1", protection: { stopLoss: "90", takeProfit: "110" },
    })).state;
    const commands = replayCandleObservations({
      commandIdPrefix: "both-down", scope, symbol: "BTCUSDT", occurredAt: at,
    }, { open: "100", high: "120", low: "80", close: "90" },
    BTC_EXECUTION_POLICY_V1);
    const emitted = [];
    for (const command of commands) {
      const result = run(state, command);
      state = result.state;
      emitted.push(...result.facts);
    }
    const fill = emitted.find((x) => x.kind === "FillCommitted");
    expect(fill?.kind === "FillCommitted" && fill.fill).toMatchObject({
      reason: "takeProfit", price: "110",
    });
  });
});
