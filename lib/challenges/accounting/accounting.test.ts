import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/btc-accounting-v1.golden.json";
import {
  accountId, branchId, challengeId, phaseId, replaySessionId,
} from "../domain/types";
import { decimalText, moneyFromDecimal } from "../domain/money";
import type { ExecutionScope } from "../domain/types";
import { utcInstant } from "../domain/calendar";
import {
  freezeChallengeDefinition,
  MYCRYPTOSTACK_ONE_STEP_V1,
  BTC_EXECUTION_POLICY_V1,
  BTC_INSTRUMENT_POLICY_V1,
} from "../domain/templates";
import {
  commandId, lifecycleId, positionId, reservationId, workingOrderId,
} from "../execution/policy";
import {
  createExecutionState, reduceExecutionCommand,
} from "../execution/reducer";
import type {
  ChallengeExecutionEnvironment, ExecutionCommand, ExecutionFact,
  ExecutionState, MarketOrderCommand, ObservePriceCommand,
  PlaceWorkingEntryCommand,
} from "../execution/types";
import {
  applyChallengeAccountInput,
  dayBoundaryLedgerInput,
  executionCheckpointLedgerInput,
  executionFactLedgerInput,
  initializeChallengeAccount,
} from "./ledger";
import {
  rebuildChallengeAccount,
  rebuildChallengeAccountPrefix,
} from "./rebuild";
import { verifyAccountInvariants } from "./invariants";
import type {
  ChallengeAccountState, ChallengeLedgerInput, LedgerApplyResult,
} from "./types";

const day1Start = utcInstant(2026, 1, 1);
const day1Noon = utcInstant(2026, 1, 1, 12);
const day2Start = utcInstant(2026, 1, 2);
const day2Noon = utcInstant(2026, 1, 2, 12);
const replayDefinition = freezeChallengeDefinition({
  template: MYCRYPTOSTACK_ONE_STEP_V1,
  selectedCapital: "10000",
  selectedSymbol: "BTCUSDT",
  mode: "replay",
});
const scope = {
  mode: "replay" as const,
  accountId: accountId("ledger-account"),
  challengeId: challengeId("ledger-challenge"),
  phaseId: phaseId("phase-1"),
  generation: 0,
  replaySessionId: replaySessionId("ledger-replay"),
  branchId: branchId("ledger-branch"),
  datasetHash: "ledger-dataset",
};
const executionEnvironment: ChallengeExecutionEnvironment = {
  instrumentPolicy: BTC_INSTRUMENT_POLICY_V1,
  executionPolicy: BTC_EXECUTION_POLICY_V1,
  maximumLeverage: decimalText("20"),
};
const admission = moneyFromDecimal("10000");

class Scenario {
  execution: ExecutionState;
  account: ChallengeAccountState;
  inputs: ChallengeLedgerInput[] = [];
  private ledgerSequence = 1;
  private commandSequence = 1;

  constructor(
    readonly definition = replayDefinition,
    readonly executionScope: ExecutionScope = scope,
    readonly initialAt = day1Start,
  ) {
    this.execution = createExecutionState(executionScope, executionEnvironment);
    this.account = initializeChallengeAccount({
      definition,
      phaseId: "phase-1",
      scope: executionScope,
      occurredAt: initialAt,
    });
  }

  id(prefix: string): string {
    const value = prefix + "-" + this.commandSequence;
    this.commandSequence += 1;
    return value;
  }

  applyFact(fact: ExecutionFact): LedgerApplyResult {
    const input = executionFactLedgerInput(
      this.ledgerSequence, fact, this.definition);
    const result = applyChallengeAccountInput(
      this.account, input, this.definition);
    if (result.status !== "applied") {
      throw new Error(result.rejection.code + ": " + result.rejection.message);
    }
    expect(result.status).toBe("applied");
    this.account = result.state;
    this.inputs.push(input);
    this.ledgerSequence += 1;
    expect(verifyAccountInvariants(this.account)).toEqual({
      ok: true, errors: [],
    });
    return result;
  }

  checkpoint(facts: readonly ExecutionFact[]): LedgerApplyResult {
    const input = executionCheckpointLedgerInput({
      sequence: this.ledgerSequence,
      facts,
      account: this.account,
      definition: this.definition,
    });
    const result = applyChallengeAccountInput(
      this.account, input, this.definition);
    if (result.status !== "applied") {
      throw new Error(result.rejection.code + ": " + result.rejection.message);
    }
    this.account = result.state;
    this.inputs.push(input);
    this.ledgerSequence += 1;
    expect(verifyAccountInvariants(this.account).ok).toBe(true);
    return result;
  }


  execute(command: ExecutionCommand): ExecutionFact[] {
    const result = reduceExecutionCommand(
      this.execution, command, executionEnvironment);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.rejection.message);
    this.execution = result.state;
    for (const fact of result.facts) this.applyFact(fact);
    this.checkpoint(result.facts);
    return [...result.facts];
  }

  market(
    patch: Partial<MarketOrderCommand> = {},
    occurredAt = day1Noon,
  ): ExecutionFact[] {
    const id = this.id("market");
    return this.execute({
      kind: "marketOrder",
      commandId: commandId(id),
      scope: this.executionScope,
      symbol: "BTCUSDT",
      occurredAt,
      side: "buy",
      quantity: "10",
      observedPrice: "99.9",
      leverage: "10",
      availableMarginForAdmission: admission,
      reason: "manual",
      newPositionId: positionId(id + "-position"),
      newLifecycleId: lifecycleId(id + "-lifecycle"),
      ...patch,
    });
  }

  mark(price: string, occurredAt = day1Noon): ExecutionFact[] {
    const command: ObservePriceCommand = {
      kind: "observePrice",
      commandId: commandId(this.id("mark")),
      scope: this.executionScope,
      symbol: "BTCUSDT",
      occurredAt,
      price,
      transition: "segment",
      pathIndex: this.commandSequence,
    };
    return this.execute(command);
  }

  placeWorking(
    patch: Partial<PlaceWorkingEntryCommand> = {},
    occurredAt = day1Noon,
  ): ExecutionFact[] {
    const id = this.id("working");
    return this.execute({
      kind: "placeWorkingEntry",
      commandId: commandId(id),
      scope: this.executionScope,
      symbol: "BTCUSDT",
      occurredAt,
      orderId: workingOrderId(id + "-order"),
      reservationId: reservationId(id + "-reservation"),
      side: "buy",
      orderType: "limit",
      quantity: "10",
      triggerPrice: "100",
      leverage: "10",
      availableMarginForAdmission: admission,
      newPositionId: positionId(id + "-position"),
      newLifecycleId: lifecycleId(id + "-lifecycle"),
      ...patch,
    });
  }

  boundary(markPrice?: string): LedgerApplyResult {
    const input = dayBoundaryLedgerInput({
      inputId: this.id("boundary"),
      sequence: this.ledgerSequence,
      definition: this.definition,
      scope: this.executionScope,
      occurredAt: day2Start,
      ...(markPrice === undefined ? {} : { markPrice }),
    });
    const result = applyChallengeAccountInput(
      this.account, input, this.definition);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      throw new Error(result.rejection.message);
    }
    this.account = result.state;
    this.inputs.push(input);
    this.ledgerSequence += 1;
    expect(verifyAccountInvariants(this.account).ok).toBe(true);
    return result;
  }
}

function closeLong(
  scenario: Scenario,
  quantity = "10",
  fillPrice = "110",
  occurredAt = day1Noon,
): ExecutionFact[] {
  return scenario.market({
    side: "sell",
    quantity,
    observedPrice: fillPrice === "110" ? "110.1" :
      fillPrice === "100" ? "100.1" :
      fillPrice === "90" ? "90.1" : fillPrice,
    newPositionId: undefined,
    newLifecycleId: undefined,
  }, occurredAt);
}
function openShort(scenario: Scenario, occurredAt = day1Noon): ExecutionFact[] {
  return scenario.market({
    side: "sell",
    observedPrice: "100.1",
  }, occurredAt);
}
function closeShort(
  scenario: Scenario,
  quantity = "10",
  fillPrice = "90",
  occurredAt = day1Noon,
): ExecutionFact[] {
  return scenario.market({
    side: "buy",
    quantity,
    observedPrice: fillPrice === "90" ? "89.9" :
      fillPrice === "100" ? "99.9" :
      fillPrice === "110" ? "109.9" : fillPrice,
    newPositionId: undefined,
    newLifecycleId: undefined,
  }, occurredAt);
}

describe("Challenge authoritative account ledger", () => {
  it("1 initializes the exact account state", () => {
    const state = new Scenario().account;
    expect(fixture.accountingVersion).toBe(state.accountingVersion);
    expect(fixture.checkpointVersion).toBe(state.checkpointVersion);
    expect(fixture.executionVersion).toBe(state.executionVersion);
    expect(fixture.instrumentPolicyVersion)
      .toBe(state.instrumentPolicyVersion);
    expect(fixture.executionPolicyVersion)
      .toBe(state.executionPolicyVersion);
    expect(state).toMatchObject({
      revision: 0,
      cashBalance: BigInt(10_000_000_000),
      equity: BigInt(10_000_000_000),
      realizedGrossPnl: BigInt(0),
      totalCommissions: BigInt(0),
      unrealizedPnl: BigInt(0),
      usedMargin: BigInt(0),
      reservedMargin: BigInt(0),
      freeMargin: BigInt(10_000_000_000),
      position: null,
    });
  });

  it("2 debits entry commission from cash", () => {
    const s = new Scenario();
    s.market();
    expect(s.account.cashBalance).toBe(moneyFromDecimal(
      fixture.feeCompleteRoundTrip.afterEntry.cashBalanceUsd,
    ));
    expect(s.account.realizedGrossPnl).toBe(BigInt(0));
    expect(s.account.fills.map((record) => record.fill.classification))
      .toEqual(["entry"]);
  });

  it("3 debits exit commission from cash", () => {
    const s = new Scenario();
    s.market();
    closeLong(s);
    expect(s.account.totalCommissions).toBe(moneyFromDecimal(
      fixture.feeCompleteRoundTrip.final.totalCommissionsUsd,
    ));
  });

  it("4 produces exact 10097.90 round-trip cash", () => {
    const s = new Scenario();
    s.market();
    closeLong(s);
    expect(s.account.cashBalance).toBe(
      moneyFromDecimal(fixture.feeCompleteRoundTrip.final.cashBalanceUsd),
    );
    expect(s.account.equity).toBe(
      moneyFromDecimal(fixture.feeCompleteRoundTrip.final.equityUsd),
    );
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal(
      fixture.feeCompleteRoundTrip.final.realizedGrossPnlUsd,
    ));
    expect(s.account.totalCommissions).toBe(moneyFromDecimal(
      fixture.feeCompleteRoundTrip.final.totalCommissionsUsd,
    ));
    expect(s.account.unrealizedPnl).toBe(moneyFromDecimal(
      fixture.feeCompleteRoundTrip.final.unrealizedPnlUsd,
    ));
  });

  it("5 accumulates gross realized P&L", () => {
    const s = new Scenario();
    s.market();
    closeLong(s);
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal("100"));
  });

  it("6 conserves total fees from unique commission postings", () => {
    const s = new Scenario();
    s.market();
    closeLong(s);
    const postings = s.account.postings.filter(
      (x) => x.kind === "commissionDebit");
    expect(postings.reduce((sum, x) => sum + x.amount, BigInt(0)))
      .toBe(s.account.totalCommissions);
    expect(new Set(postings.map((x) => x.sourceFactId)).size)
      .toBe(postings.length);
  });

  it("7 marks long unrealized P&L exactly", () => {
    const s = new Scenario();
    s.market();
    s.mark("90");
    expect(s.account.unrealizedPnl).toBe(moneyFromDecimal("-100"));
  });

  it("8 marks short unrealized P&L exactly", () => {
    const s = new Scenario();
    openShort(s);
    s.mark("90");
    expect(s.account.unrealizedPnl).toBe(moneyFromDecimal("100"));
  });

  it("9 maintains equity equals cash plus unrealized", () => {
    const s = new Scenario();
    s.market();
    s.mark("90");
    expect(s.account.equity).toBe(moneyFromDecimal("9899"));
    expect(s.account.equity)
      .toBe(s.account.cashBalance + s.account.unrealizedPnl);
  });

  it("10 maintains free-margin identity", () => {
    const s = new Scenario();
    s.market({ leverage: "2" });
    s.mark("90");
    expect(s.account.usedMargin).toBe(moneyFromDecimal("500"));
    expect(s.account.freeMargin).toBe(moneyFromDecimal("9399"));
  });

  it("11 does not treat used margin as a cash expense", () => {
    const s = new Scenario();
    s.market({ leverage: "2" });
    expect(s.account.usedMargin).toBe(moneyFromDecimal("500"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9999"));
  });

  it("12 does not treat reserved margin as a cash expense", () => {
    const s = new Scenario();
    s.placeWorking();
    expect(s.account.reservedMargin).toBe(moneyFromDecimal("100"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("10000"));
  });

  it("13 creates an exact working-order reservation", () => {
    const s = new Scenario();
    s.placeWorking();
    expect(s.account.reservations).toHaveLength(1);
    expect(s.account.reservations[0].requiredMargin)
      .toBe(moneyFromDecimal("100"));
  });

  it("14 cancels a reservation without changing cash or equity", () => {
    const s = new Scenario();
    s.placeWorking();
    const orderId = s.execution.workingOrders[0].orderId;
    s.execute({
      kind: "cancelWorkingOrder",
      commandId: commandId(s.id("cancel")),
      scope,
      symbol: "BTCUSDT",
      occurredAt: day1Noon,
      orderId,
      reason: "user",
    });
    expect(s.account.reservedMargin).toBe(BigInt(0));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("10000"));
    expect(s.account.equity).toBe(moneyFromDecimal("10000"));
  });

  it("15 moves reservation to used margin when the order fills", () => {
    const s = new Scenario();
    s.placeWorking();
    s.mark("90");
    expect(s.account.reservedMargin).toBe(BigInt(0));
    expect(s.account.usedMargin).toBe(moneyFromDecimal("100"));
    expect(s.account.position?.quantity).toBe("10");
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9999"));
  });

  it("16 posts partial-close cash once", () => {
    const s = new Scenario();
    s.market();
    closeLong(s, "4");
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal("40"));
    expect(s.account.totalCommissions).toBe(moneyFromDecimal("1.44"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("10038.56"));
  });

  it("17 preserves residual unrealized basis after a partial close", () => {
    const s = new Scenario();
    s.market();
    s.mark("110");
    closeLong(s, "4");
    expect(s.account.position?.quantity).toBe("6");
    expect(s.account.position?.costBasis).toBe(moneyFromDecimal("600"));
    expect(s.account.unrealizedPnl).toBe(moneyFromDecimal("60"));
  });

  it("18 reconciles multiple partial closes", () => {
    const s = new Scenario();
    s.market();
    closeLong(s, "2");
    closeLong(s, "3");
    closeLong(s, "5");
    expect(s.account.position).toBeNull();
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal("100"));
    expect(s.account.totalCommissions).toBe(moneyFromDecimal("2.1"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("10097.9"));
  });

  it("19 never re-debits entry-fee allocation metadata", () => {
    const s = new Scenario();
    s.market();
    closeLong(s, "4");
    const allocations = s.account.postings.filter(
      (x) => x.kind === "entryFeeAllocation");
    expect(allocations).toHaveLength(1);
    expect(allocations[0].cashDelta).toBe(BigInt(0));
    expect(s.account.cashBalance).toBe(
      s.account.phaseStartingCash +
      s.account.realizedGrossPnl -
      s.account.totalCommissions);
  });

  it("20 is flat with zero used margin after full close", () => {
    const s = new Scenario();
    s.market();
    closeLong(s);
    expect(s.account.position).toBeNull();
    expect(s.account.unrealizedPnl).toBe(BigInt(0));
    expect(s.account.usedMargin).toBe(BigInt(0));
  });

  it("21 accounts long-to-short reversal as two components", () => {
    const s = new Scenario();
    s.market();
    s.market({
      side: "sell",
      quantity: "14",
      observedPrice: "110.1",
      newPositionId: positionId("reversal-short-position"),
      newLifecycleId: lifecycleId("reversal-short-lifecycle"),
    });
    expect(s.account.position).toMatchObject({
      side: "short", quantity: "4", costBasis: moneyFromDecimal("440"),
    });
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal("100"));
    expect(s.account.fills.map((record) => record.fill.classification))
      .toEqual(["entry", "exit", "entry"]);
  });

  it("22 accounts short-to-long reversal as two components", () => {
    const s = new Scenario();
    openShort(s);
    s.market({
      side: "buy",
      quantity: "14",
      observedPrice: "89.9",
      newPositionId: positionId("reversal-long-position"),
      newLifecycleId: lifecycleId("reversal-long-lifecycle"),
    });
    expect(s.account.position).toMatchObject({
      side: "long", quantity: "4", costBasis: moneyFromDecimal("360"),
    });
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal("100"));
  });

  it("23 debits both reversal commissions once", () => {
    const s = new Scenario();
    s.market();
    s.market({
      side: "sell", quantity: "14", observedPrice: "110.1",
      newPositionId: positionId("fee-reversal-position"),
      newLifecycleId: lifecycleId("fee-reversal-lifecycle"),
    });
    expect(s.account.totalCommissions).toBe(moneyFromDecimal("2.54"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("10097.46"));
  });

  it("24 releases old margin and establishes reversal margin", () => {
    const s = new Scenario();
    s.market();
    s.market({
      side: "sell", quantity: "14", observedPrice: "110.1",
      newPositionId: positionId("margin-reversal-position"),
      newLifecycleId: lifecycleId("margin-reversal-lifecycle"),
    });
    expect(s.account.usedMargin).toBe(moneyFromDecimal("44"));
    const changes = s.account.postings.filter(
      (x) => x.kind === "marginTransition");
    expect(changes.at(-2)?.amount).toBe(moneyFromDecimal("-100"));
    expect(changes.at(-1)?.amount).toBe(moneyFromDecimal("44"));
  });

  it("25 changes projection on mark update", () => {
    const s = new Scenario();
    s.market();
    const cash = s.account.cashBalance;
    s.mark("105");
    expect(s.account.lastMarkPrice).toBe("105");
    expect(s.account.unrealizedPnl).toBe(moneyFromDecimal("50"));
    expect(s.account.cashBalance).toBe(cash);
  });

  it("26 handles repeated marks without accumulating old unrealized", () => {
    const s = new Scenario();
    s.market();
    s.mark("105");
    s.mark("90");
    s.mark("100");
    expect(s.account.unrealizedPnl).toBe(BigInt(0));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9999"));
  });

  it("27 initializes the UTC accounting day", () => {
    const s = new Scenario();
    expect(s.account.day).toMatchObject({
      currentDayId: "2026-01-01",
      dayStartCash: moneyFromDecimal("10000"),
      dayStartEquity: moneyFromDecimal("10000"),
      dayUnrealizedStart: BigInt(0),
    });
  });

  it("28 freezes one day and initializes the next at 00:00 UTC", () => {
    const s = new Scenario();
    s.boundary();
    expect(s.account.closedDays).toHaveLength(1);
    expect(s.account.closedDays[0].dayId).toBe("2026-01-01");
    expect(s.account.day.currentDayId).toBe("2026-01-02");
    expect(s.account.day.dayStartCash).toBe(moneyFromDecimal("10000"));
  });

  it("29 attributes entry fee to the entry UTC day", () => {
    const s = new Scenario();
    s.market();
    s.boundary("100");
    expect(s.account.closedDays[0].commissions).toBe(moneyFromDecimal("1"));
    expect(s.account.day.dayCommissions).toBe(BigInt(0));
  });

  it("30 attributes exit fee to the exit UTC day", () => {
    const s = new Scenario();
    s.market();
    s.boundary("100");
    closeLong(s, "10", "110", day2Noon);
    expect(s.account.closedDays[0].commissions).toBe(moneyFromDecimal("1"));
    expect(s.account.day.dayCommissions).toBe(moneyFromDecimal("1.1"));
  });

  it("31 attributes realized P&L to the realization UTC day", () => {
    const s = new Scenario();
    s.market();
    s.boundary("100");
    closeLong(s, "10", "110", day2Noon);
    expect(s.account.closedDays[0].realizedGrossPnl).toBe(BigInt(0));
    expect(s.account.day.dayRealizedGrossPnl).toBe(moneyFromDecimal("100"));
  });

  it("32 carries an overnight position without changing cash", () => {
    const s = new Scenario();
    s.market();
    const cashBefore = s.account.cashBalance;
    s.boundary("105");
    expect(s.account.cashBalance).toBe(cashBefore);
    expect(s.account.position).toMatchObject({
      side: "long", quantity: "10", currentMark: "105",
      unrealizedPnl: moneyFromDecimal("50"),
    });
    expect(s.account.day.dayStartEquity).toBe(moneyFromDecimal("10049"));
  });

  it("33 computes day settled P&L from realized gross minus fees", () => {
    const s = new Scenario();
    s.market();
    s.boundary("100");
    closeLong(s, "10", "110", day2Noon);
    expect(s.account.day.daySettledNetPnl).toBe(moneyFromDecimal("98.9"));
  });

  it("34 computes day unrealized change from the boundary mark", () => {
    const s = new Scenario();
    s.market();
    s.boundary("100");
    s.mark("90", day2Noon);
    expect(s.account.day.dayUnrealizedStart).toBe(BigInt(0));
    expect(s.account.day.dayUnrealizedChange).toBe(moneyFromDecimal("-100"));
  });

  it("35 reconciles day equity change exactly", () => {
    const s = new Scenario();
    s.market();
    s.boundary("100");
    s.mark("90", day2Noon);
    expect(s.account.day.dayEquityChange).toBe(
      s.account.day.dayBalanceChange +
      s.account.day.dayUnrealizedChange);
  });

  it("36 rejects duplicate ledger input explicitly", () => {
    const s = new Scenario();
    s.market();
    const duplicate = applyChallengeAccountInput(
      s.account, s.inputs[0], replayDefinition);
    expect(duplicate.status).toBe("alreadyApplied");
    expect(duplicate.state).toBe(s.account);
  });

  it("37 rejects an out-of-order execution fact", () => {
    const s = new Scenario();
    s.market();
    const original = (s.inputs[0] as Extract<
      ChallengeLedgerInput, { kind: "executionFact" }
    >).fact;
    const altered = {
      ...original,
      factId: ("altered-fact") as typeof original.factId,
      sequence: s.account.lastExecutionFactSequence + 2,
    } as ExecutionFact;
    const input = executionFactLedgerInput(
      s.account.nextInputSequence, altered, replayDefinition);
    const result = applyChallengeAccountInput(
      s.account, input, replayDefinition);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.rejection.code).toBe("EXECUTION_FACT_OUT_OF_ORDER");
    }
  });

  it("38 rejects scope mismatch", () => {
    const source = new Scenario();
    source.market();
    const original = (source.inputs[0] as Extract<
      ChallengeLedgerInput, { kind: "executionFact" }
    >).fact;
    const target = new Scenario();
    const altered = {
      ...original,
      scope: { ...scope, branchId: branchId("wrong-branch") },
    } as ExecutionFact;
    const result = applyChallengeAccountInput(
      target.account,
      executionFactLedgerInput(1, altered, replayDefinition),
      replayDefinition,
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.rejection.code).toBe("SCOPE_MISMATCH");
    }
  });

  it("39 rejects execution-version mismatch", () => {
    const source = new Scenario();
    source.market();
    const original = (source.inputs[0] as Extract<
      ChallengeLedgerInput, { kind: "executionFact" }
    >).fact;
    const target = new Scenario();
    const altered = {
      ...original,
      executionPolicyVersion: "unknown-execution",
    } as ExecutionFact;
    const result = applyChallengeAccountInput(
      target.account,
      executionFactLedgerInput(1, altered, replayDefinition),
      replayDefinition,
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.rejection.code).toBe("VERSION_MISMATCH");
    }
  });

  it("40 makes forward reduction equal full rebuild", () => {
    const s = new Scenario();
    s.market();
    s.mark("105");
    closeLong(s, "4");
    const rebuilt = rebuildChallengeAccount({
      definition: replayDefinition,
      phaseId: "phase-1",
      scope,
      occurredAt: day1Start,
      inputs: s.inputs,
    });
    expect(rebuilt.state).toEqual(s.account);
  });

  it("41 removes every future value in a prefix rebuild", () => {
    const s = new Scenario();
    s.market();
    const prefixLength = s.inputs.length;
    s.mark("110");
    closeLong(s);
    const prefix = rebuildChallengeAccountPrefix({
      definition: replayDefinition,
      phaseId: "phase-1",
      scope,
      occurredAt: day1Start,
      inputs: s.inputs,
    }, prefixLength);
    expect(prefix.position?.quantity).toBe("10");
    expect(prefix.lastMarkPrice).toBeNull();
    expect(prefix.realizedGrossPnl).toBe(BigInt(0));
    expect(prefix.totalCommissions).toBe(moneyFromDecimal("1"));
    expect(prefix.revision).toBe(prefixLength);
  });

  it("42 gives live and replay equivalent facts equal economics", () => {
    const liveDefinition = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "live",
    });
    const liveScope = {
      mode: "live" as const,
      accountId: accountId("ledger-account"),
      challengeId: challengeId("ledger-challenge"),
      phaseId: phaseId("phase-1"),
      generation: 0,
    };
    const replay = new Scenario();
    const live = new Scenario(liveDefinition, liveScope);
    replay.market();
    live.market();
    replay.mark("105");
    live.mark("105");
    const economics = (state: ChallengeAccountState) => ({
      cash: state.cashBalance,
      equity: state.equity,
      unrealized: state.unrealizedPnl,
      used: state.usedMargin,
      fees: state.totalCommissions,
    });
    expect(economics(live.account)).toEqual(economics(replay.account));
  });

  it("43 retains exact arithmetic under many small fees", () => {
    const s = new Scenario();
    for (let index = 0; index < 50; index += 1) {
      s.market({ quantity: "0.1" });
      closeLong(s, "0.1", "100");
    }
    expect(s.account.realizedGrossPnl).toBe(BigInt(0));
    expect(s.account.totalCommissions).toBe(moneyFromDecimal("1"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9999"));
    expect(verifyAccountInvariants(s.account).ok).toBe(true);
  });

  it("44 posts negative realized P&L exactly", () => {
    const s = new Scenario();
    s.market();
    closeLong(s, "10", "90");
    expect(s.account.realizedGrossPnl).toBe(moneyFromDecimal("-100"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9898.1"));
  });

  it("45 charges fees on a breakeven close", () => {
    const s = new Scenario();
    s.market();
    closeLong(s, "10", "100");
    expect(s.account.realizedGrossPnl).toBe(BigInt(0));
    expect(s.account.totalCommissions).toBe(moneyFromDecimal("2"));
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9998"));
  });

  it("46 has zero open position values after full close", () => {
    const s = new Scenario();
    openShort(s);
    closeShort(s);
    expect(s.account.position).toBeNull();
    expect(s.account.unrealizedPnl).toBe(BigInt(0));
    expect(s.account.grossExposure).toBe(BigInt(0));
    expect(s.account.usedMargin).toBe(BigInt(0));
  });

  it("47 defines no-mark open positions with zero unrealized", () => {
    const s = new Scenario();
    s.market();
    expect(s.account.position?.currentMark).toBeNull();
    expect(s.account.unrealizedPnl).toBe(BigInt(0));
    expect(s.account.equity).toBe(s.account.cashBalance);
    expect(s.account.grossExposure).toBe(moneyFromDecimal("1000"));
  });

  it("48 rejects unknown malformed input", () => {
    const s = new Scenario();
    const result = applyChallengeAccountInput(
      s.account, { kind: "unknown" }, replayDefinition);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.rejection.code).toBe("MALFORMED_INPUT");
    }
    const nested = applyChallengeAccountInput(s.account, {
      kind: "executionFact",
      inputId: "malformed-fact",
      sequence: 1,
      accountingVersion: replayDefinition.versions.accounting,
      definitionHash: replayDefinition.definitionHash,
      fact: {
        kind: "FillCommitted",
        factId: "malformed-fact-1",
        sequence: 1,
        commandId: "malformed-command",
        scope,
        symbol: "BTCUSDT",
        occurredAt: day1Noon,
        executionPolicyVersion: BTC_EXECUTION_POLICY_V1.policyVersion,
      },
    }, replayDefinition);
    expect(nested.status).toBe("rejected");
    if (nested.status === "rejected") {
      expect(nested.rejection.code).toBe("MALFORMED_INPUT");
    }
  });

  it("49 keeps Challenge accounting isolated from legacy wallets", () => {
    const s = new Scenario();
    s.market();
    expect(s.account.definitionHash).toBe(replayDefinition.definitionHash);
    expect(s.account.accountingVersion)
      .toBe(replayDefinition.versions.accounting);
    expect(s.account.cashBalance).toBe(moneyFromDecimal("9999"));
  });

  it("50 requires an explicit UTC boundary before next-day facts", () => {
    const s = new Scenario();
    const result = reduceExecutionCommand(
      s.execution,
      {
        kind: "marketOrder",
        commandId: commandId("next-day-without-boundary"),
        scope,
        symbol: "BTCUSDT",
        occurredAt: day2Noon,
        side: "buy",
        quantity: "10",
        observedPrice: "99.9",
        leverage: "10",
        availableMarginForAdmission: admission,
        reason: "manual",
        newPositionId: positionId("next-day-position"),
        newLifecycleId: lifecycleId("next-day-lifecycle"),
      },
      executionEnvironment,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.rejection.message);
    const input = executionFactLedgerInput(
      1, result.facts[0], replayDefinition);
    const applied = applyChallengeAccountInput(
      s.account, input, replayDefinition);
    expect(applied.status).toBe("rejected");
    if (applied.status === "rejected") {
      expect(applied.rejection.code).toBe("DAY_BOUNDARY_REQUIRED");
    }
  });
});
