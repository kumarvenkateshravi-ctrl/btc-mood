import { describe, expect, it } from "vitest";
import {
  accountId,
  branchId,
  challengeId,
  phaseId,
  replaySessionId,
} from "../domain/types";
import type {
  ExecutionScope,
  FrozenChallengeDefinition,
} from "../domain/types";
import { decimalText, moneyFromDecimal } from "../domain/money";
import { utcInstant } from "../domain/calendar";
import {
  BTC_EXECUTION_POLICY_V1,
  BTC_INSTRUMENT_POLICY_V1,
  freezeChallengeDefinition,
  MYCRYPTOSTACK_ONE_STEP_V1,
} from "../domain/templates";
import {
  commandId,
  lifecycleId,
  positionId,
  reservationId,
  workingOrderId,
} from "../execution/policy";
import {
  createExecutionState,
  reduceExecutionCommand,
} from "../execution/reducer";
import type {
  ChallengeExecutionEnvironment,
  ExecutionCommand,
  ExecutionFact,
  ExecutionState,
  MarketOrderCommand,
  ObservePriceCommand,
  PlaceWorkingEntryCommand,
} from "../execution/types";
import { EXECUTION_CHECKPOINT_POLICY_V1 } from "./checkpoint";
import {
  applyChallengeAccountInput,
  dayBoundaryLedgerInput,
  executionCheckpointLedgerInput,
  executionFactLedgerInput,
  initializeChallengeAccount,
  ledgerInputId,
} from "./ledger";
import { verifyAccountInvariants } from "./invariants";
import {
  rebuildChallengeAccount,
  rebuildChallengeAccountPrefix,
} from "./rebuild";
import type {
  ChallengeAccountState,
  ChallengeLedgerInput,
  ExecutionCheckpointId,
  ExecutionCheckpointLedgerInput,
  LedgerApplyResult,
} from "./types";

const day1Start = utcInstant(2026, 2, 1);
const day1Noon = utcInstant(2026, 2, 1, 12);
const day2Start = utcInstant(2026, 2, 2);

const replayDefinition = freezeChallengeDefinition({
  template: MYCRYPTOSTACK_ONE_STEP_V1,
  selectedCapital: "10000",
  selectedSymbol: "BTCUSDT",
  mode: "replay",
});

function replayScope(name = "atomic"): ExecutionScope {
  return {
    mode: "replay",
    accountId: accountId(name + "-account"),
    challengeId: challengeId(name + "-challenge"),
    phaseId: phaseId("phase-1"),
    generation: 0,
    replaySessionId: replaySessionId(name + "-session"),
    branchId: branchId(name + "-branch"),
    datasetHash: name + "-dataset",
  };
}

function liveScope(name = "atomic"): ExecutionScope {
  return {
    mode: "live",
    accountId: accountId(name + "-account"),
    challengeId: challengeId(name + "-challenge"),
    phaseId: phaseId("phase-1"),
    generation: 0,
  };
}

const environment: ChallengeExecutionEnvironment = {
  instrumentPolicy: BTC_INSTRUMENT_POLICY_V1,
  executionPolicy: BTC_EXECUTION_POLICY_V1,
  maximumLeverage: decimalText("20"),
};

function definitionWithCapital(
  selectedCapital: string,
): FrozenChallengeDefinition {
  return freezeChallengeDefinition({
    template: {
      ...MYCRYPTOSTACK_ONE_STEP_V1,
      startingCapitalOptions: [
        ...MYCRYPTOSTACK_ONE_STEP_V1.startingCapitalOptions,
        decimalText(selectedCapital),
      ],
    },
    selectedCapital,
    selectedSymbol: "BTCUSDT",
    mode: "replay",
  });
}

class Harness {
  execution: ExecutionState;
  account: ChallengeAccountState;
  readonly inputs: ChallengeLedgerInput[] = [];
  private inputSequence = 1;
  private identitySequence = 1;

  constructor(
    readonly definition: FrozenChallengeDefinition = replayDefinition,
    readonly scope: ExecutionScope = replayScope(),
  ) {
    this.execution = createExecutionState(scope, environment);
    this.account = initializeChallengeAccount({
      definition,
      phaseId: "phase-1",
      scope,
      occurredAt: day1Start,
    });
  }

  id(prefix: string): string {
    const id = prefix + "-" + this.identitySequence;
    this.identitySequence += 1;
    return id;
  }

  apply(input: ChallengeLedgerInput): LedgerApplyResult {
    const result = applyChallengeAccountInput(
      this.account,
      input,
      this.definition,
    );
    if (result.status === "applied") {
      this.account = result.state;
      this.inputs.push(input);
      this.inputSequence += 1;
      expect(verifyAccountInvariants(this.account)).toEqual({
        ok: true,
        errors: [],
      });
    }
    return result;
  }

  applyFact(fact: ExecutionFact): LedgerApplyResult {
    return this.apply(executionFactLedgerInput(
      this.inputSequence,
      fact,
      this.definition,
    ));
  }

  prepare(command: ExecutionCommand): readonly ExecutionFact[] {
    const result = reduceExecutionCommand(
      this.execution,
      command,
      environment,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.rejection.message);
    this.execution = result.state;
    return result.facts;
  }

  applyFacts(facts: readonly ExecutionFact[]): ChallengeAccountState[] {
    const states: ChallengeAccountState[] = [];
    for (const fact of facts) {
      const result = this.applyFact(fact);
      expect(result.status).toBe("applied");
      if (result.status !== "applied") {
        throw new Error(result.rejection.message);
      }
      states.push(result.state);
    }
    return states;
  }

  checkpointInput(
    facts: readonly ExecutionFact[],
  ): ExecutionCheckpointLedgerInput {
    return executionCheckpointLedgerInput({
      sequence: this.inputSequence,
      facts,
      account: this.account,
      definition: this.definition,
    });
  }

  commit(
    facts: readonly ExecutionFact[],
    patch: Partial<ExecutionCheckpointLedgerInput> = {},
  ): LedgerApplyResult {
    return this.apply({
      ...this.checkpointInput(facts),
      ...patch,
    } as ExecutionCheckpointLedgerInput);
  }

  execute(command: ExecutionCommand): readonly ExecutionFact[] {
    const facts = this.prepare(command);
    this.applyFacts(facts);
    const committed = this.commit(facts);
    expect(committed.status).toBe("applied");
    return facts;
  }

  market(
    patch: Partial<MarketOrderCommand> = {},
  ): MarketOrderCommand {
    const id = this.id("market");
    return {
      kind: "marketOrder",
      commandId: commandId(id),
      scope: this.scope,
      symbol: "BTCUSDT",
      occurredAt: day1Noon,
      side: "buy",
      quantity: "10",
      observedPrice: "99.9",
      leverage: "10",
      availableMarginForAdmission: moneyFromDecimal("100000"),
      reason: "manual",
      newPositionId: positionId(id + "-position"),
      newLifecycleId: lifecycleId(id + "-lifecycle"),
      ...patch,
    };
  }

  observe(price: string): ObservePriceCommand {
    return {
      kind: "observePrice",
      commandId: commandId(this.id("observe")),
      scope: this.scope,
      symbol: "BTCUSDT",
      occurredAt: day1Noon,
      price,
      transition: "segment",
      pathIndex: this.identitySequence,
    };
  }

  working(input: {
    side: "buy" | "sell";
    orderType: "limit" | "stop";
    triggerPrice: string;
    ocoGroupId?: string;
  }): PlaceWorkingEntryCommand {
    const id = this.id("working");
    return {
      kind: "placeWorkingEntry",
      commandId: commandId(id),
      scope: this.scope,
      symbol: "BTCUSDT",
      occurredAt: day1Noon,
      orderId: workingOrderId(id + "-order"),
      reservationId: reservationId(id + "-reservation"),
      side: input.side,
      orderType: input.orderType,
      quantity: "1",
      triggerPrice: input.triggerPrice,
      leverage: "10",
      availableMarginForAdmission: moneyFromDecimal("100000"),
      newPositionId: positionId(id + "-position"),
      newLifecycleId: lifecycleId(id + "-lifecycle"),
      ...(input.ocoGroupId ? { ocoGroupId: input.ocoGroupId } : {}),
    };
  }

  boundary(): LedgerApplyResult {
    return this.apply(dayBoundaryLedgerInput({
      inputId: this.id("boundary"),
      sequence: this.inputSequence,
      definition: this.definition,
      scope: this.scope,
      occurredAt: day2Start,
    }));
  }
}

function expectApplied(result: LedgerApplyResult): ChallengeAccountState {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.rejection.message);
  return result.state;
}

function expectRejected(
  result: LedgerApplyResult,
  code: string,
): void {
  expect(result.status).toBe("rejected");
  if (result.status === "rejected") {
    expect(result.rejection.code).toBe(code);
  }
}

function closeLong(harness: Harness, quantity = "10", observed = "110.1") {
  return harness.market({
    side: "sell",
    quantity,
    observedPrice: observed,
    newPositionId: undefined,
    newLifecycleId: undefined,
  });
}

const lifecycleEligible = (state: ChallengeAccountState): boolean =>
  state.projectionStability === "STABLE";
describe("Task 3A atomic execution checkpoints", () => {
  it("1 checkpoints one complete single-fill command", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    expect(facts.filter((fact) => fact.kind === "FillCommitted")).toHaveLength(1);
    const states = h.applyFacts(facts);
    expect(states.every((state) => !lifecycleEligible(state))).toBe(true);
    const stable = expectApplied(h.commit(facts));
    expect(stable.projectionStability).toBe("STABLE");
    expect(stable.pendingExecutionCommand).toBeNull();
    expect(stable.lastStableCheckpoint).toMatchObject({
      kind: "executionCommand",
      commandId: facts[0].commandId,
      firstFactSequence: facts[0].sequence,
      lastFactSequence: facts[facts.length - 1].sequence,
    });
  });

  it("2 checkpoints a multi-fact close only after every fact", () => {
    const h = new Harness();
    h.execute(h.market());
    const facts = h.prepare(closeLong(h));
    expect(facts.length).toBeGreaterThan(3);
    expect(h.applyFacts(facts).every((state) =>
      state.projectionStability === "INTERMEDIATE")).toBe(true);
    const stable = expectApplied(h.commit(facts));
    expect(stable.position).toBeNull();
    expect(stable.usedMargin).toBe(BigInt(0));
  });

  it("3 never exposes temporary 11010 cash as lifecycle-stable", () => {
    const definition = definitionWithCapital("10964.94");
    const h = new Harness(definition, replayScope("temporary-below"));
    h.execute(h.market({
      quantity: "0.6",
      observedPrice: "24899.9",
      leverage: "20",
    }));
    expect(h.account.cashBalance).toBe(moneyFromDecimal("10950"));

    const facts = h.prepare(closeLong(h, "0.6", "25000.1"));
    const states = h.applyFacts(facts);
    expect(states[0].cashBalance).toBe(moneyFromDecimal("11010"));
    expect(states[0].projectionStability).toBe("INTERMEDIATE");
    expect(states.every((state) => !lifecycleEligible(state))).toBe(true);
    expect(states[states.length - 1].cashBalance)
      .toBe(moneyFromDecimal("10995"));

    const stable = expectApplied(h.commit(facts));
    expect(stable.cashBalance).toBe(moneyFromDecimal("10995"));
    expect(lifecycleEligible(stable)).toBe(true);
  });

  it("4 makes a final-above-target close eligible only at its checkpoint", () => {
    const definition = definitionWithCapital("10950.1");
    const h = new Harness(definition, replayScope("temporary-above"));
    h.execute(h.market({ quantity: "1" }));
    expect(h.account.cashBalance).toBe(moneyFromDecimal("10950"));

    const facts = h.prepare(closeLong(h, "1", "170.1"));
    const states = h.applyFacts(facts);
    expect(states[0].cashBalance).toBe(moneyFromDecimal("11020"));
    expect(states[states.length - 1].cashBalance)
      .toBe(moneyFromDecimal("11019.83"));
    expect(states.every((state) => !lifecycleEligible(state))).toBe(true);
    expect(lifecycleEligible(expectApplied(h.commit(facts)))).toBe(true);
  });

  it("5 makes partial close economics stable as one command", () => {
    const h = new Harness();
    h.execute(h.market());
    const facts = h.prepare(closeLong(h, "4"));
    const states = h.applyFacts(facts);
    expect(states.every((state) => !lifecycleEligible(state))).toBe(true);
    const stable = expectApplied(h.commit(facts));
    expect(stable.position?.quantity).toBe("6");
    expect(stable.usedMargin).toBe(moneyFromDecimal("60"));
    expect(stable.feeAllocations[0]).toMatchObject({
      allocatedEntryFees: moneyFromDecimal("0.4"),
      remainingEntryFees: moneyFromDecimal("0.6"),
    });
  });

  it("6 makes the complete close-and-open reversal one checkpoint", () => {
    const h = new Harness();
    h.execute(h.market());
    const command = h.market({
      side: "sell",
      quantity: "14",
      observedPrice: "110.1",
      newPositionId: positionId("atomic-reversal-position"),
      newLifecycleId: lifecycleId("atomic-reversal-lifecycle"),
    });
    const facts = h.prepare(command);
    expect(facts.filter((fact) => fact.kind === "FillCommitted")).toHaveLength(2);
    const states = h.applyFacts(facts);
    expect(states.every((state) => !lifecycleEligible(state))).toBe(true);
    const stable = expectApplied(h.commit(facts));
    expect(stable.position).toMatchObject({ side: "short", quantity: "4" });
    expect(stable.lastStableCheckpoint?.factIds).toHaveLength(facts.length);
  });

  it("7 checkpoints fill, reservation release, and OCO cancellation together", () => {
    const h = new Harness();
    h.execute(h.working({
      side: "buy", orderType: "limit", triggerPrice: "100", ocoGroupId: "oco-1",
    }));
    h.execute(h.working({
      side: "buy", orderType: "stop", triggerPrice: "110", ocoGroupId: "oco-1",
    }));
    expect(h.account.reservations).toHaveLength(2);
    const facts = h.prepare(h.observe("90"));
    expect(facts.some((fact) => fact.kind === "WorkingOrderCancelled")).toBe(true);
    expect(facts.some((fact) => fact.kind === "FillCommitted")).toBe(true);
    const states = h.applyFacts(facts);
    expect(states.every((state) => !lifecycleEligible(state))).toBe(true);
    const stable = expectApplied(h.commit(facts));
    expect(stable.reservations).toHaveLength(0);
    expect(stable.position).not.toBeNull();
  });

  it("8 rejects a premature checkpoint", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    expectApplied(h.applyFact(facts[0]));
    const checkpoint = h.checkpointInput(facts);
    expectRejected(h.apply(checkpoint), "CHECKPOINT_MISMATCH");
    expect(h.account.projectionStability).toBe("INTERMEDIATE");
  });

  it("9 rejects a checkpoint with a missing fact identity", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    const checkpoint = h.checkpointInput(facts);
    expectRejected(h.apply({
      ...checkpoint,
      factIds: checkpoint.factIds.slice(1),
    }), "CHECKPOINT_MISMATCH");
  });

  it("10 rejects a checkpoint with the wrong fact range", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    const checkpoint = h.checkpointInput(facts);
    expectRejected(h.apply({
      ...checkpoint,
      firstFactSequence: checkpoint.firstFactSequence + 1,
    }), "CHECKPOINT_MISMATCH");
  });

  it("11 rejects a checkpoint for another command", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    expectRejected(h.commit(facts, {
      commandId: commandId("wrong-command"),
    }), "CHECKPOINT_MISMATCH");
  });

  it("12 rejects a checkpoint for another replay scope", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    expectRejected(h.commit(facts, {
      scope: replayScope("wrong-scope"),
    }), "SCOPE_MISMATCH");
  });

  it("13 rejects a checkpoint with a stale account revision", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    const checkpoint = h.checkpointInput(facts);
    expectRejected(h.apply({
      ...checkpoint,
      accountRevision: checkpoint.accountRevision - 1,
    }), "CHECKPOINT_MISMATCH");
  });

  it("14 rejects a checkpoint with the wrong ledger hash", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    expectRejected(h.commit(facts, {
      ledgerHash: "wrong-ledger-hash",
    }), "CHECKPOINT_MISMATCH");
  });

  it("15 identifies duplicate and conflicting checkpoints safely", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    const checkpoint = h.checkpointInput(facts);
    expectApplied(h.apply(checkpoint));

    const duplicate = h.apply(checkpoint);
    expect(duplicate.status).toBe("alreadyApplied");
    const conflicting = {
      ...checkpoint,
      inputId: ledgerInputId("checkpoint:conflicting-command-record"),
      checkpointId: ("checkpoint:" + "a".repeat(64)) as ExecutionCheckpointId,
      sequence: h.account.nextInputSequence,
    };
    expectRejected(h.apply(conflicting), "COMMAND_ALREADY_COMMITTED");
  });

  it("16 rejects an out-of-order checkpoint input sequence", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    const checkpoint = h.checkpointInput(facts);
    expectRejected(h.apply({
      ...checkpoint,
      sequence: checkpoint.sequence + 1,
    }), "OUT_OF_ORDER");
  });

  it("17 records a UTC day boundary as an inherent stable checkpoint", () => {
    const h = new Harness();
    const state = expectApplied(h.boundary());
    expect(state.projectionStability).toBe("STABLE");
    expect(state.stableCheckpointSequence).toBe(1);
    expect(state.lastStableCheckpoint).toMatchObject({
      kind: "dayBoundary",
      commandId: null,
      occurredAt: day2Start,
      stableAccountRevision: state.revision,
      stableLedgerHash: state.ledgerHash,
    });
  });

  it("18 prevents a day boundary from splitting an unfinished command", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    expectApplied(h.applyFact(facts[0]));
    expectRejected(h.boundary(), "UNFINISHED_COMMAND");
    expect(h.account.closedDays).toHaveLength(0);
    expect(h.account.projectionStability).toBe("INTERMEDIATE");
  });

  it("19 rebuilds the same checkpointed account bit-for-bit", () => {
    const h = new Harness();
    h.execute(h.market());
    h.execute(h.observe("105"));
    h.execute(closeLong(h, "4"));
    const rebuilt = rebuildChallengeAccount({
      definition: h.definition,
      phaseId: "phase-1",
      scope: h.scope,
      occurredAt: day1Start,
      inputs: h.inputs,
    });
    expect(rebuilt.state).toEqual(h.account);
    expect(rebuilt.state.checkpoints).toEqual(h.account.checkpoints);
  });

  it("20 prefix rebuild excludes then exactly restores a checkpoint", () => {
    const h = new Harness();
    h.execute(h.market());
    const beforeCheckpoint = rebuildChallengeAccountPrefix({
      definition: h.definition,
      phaseId: "phase-1",
      scope: h.scope,
      occurredAt: day1Start,
      inputs: h.inputs,
    }, h.inputs.length - 1);
    expect(beforeCheckpoint.projectionStability).toBe("INTERMEDIATE");
    expect(beforeCheckpoint.checkpoints).toHaveLength(0);
    expect(beforeCheckpoint.pendingExecutionCommand).not.toBeNull();

    const afterCheckpoint = rebuildChallengeAccountPrefix({
      definition: h.definition,
      phaseId: "phase-1",
      scope: h.scope,
      occurredAt: day1Start,
      inputs: h.inputs,
    }, h.inputs.length);
    expect(afterCheckpoint).toEqual(h.account);
    expect(afterCheckpoint.projectionStability).toBe("STABLE");
  });

  it("21 gives replay and live equivalent stable command economics", () => {
    const liveDefinition = freezeChallengeDefinition({
      template: MYCRYPTOSTACK_ONE_STEP_V1,
      selectedCapital: "10000",
      selectedSymbol: "BTCUSDT",
      mode: "live",
    });
    const replay = new Harness(replayDefinition, replayScope("equivalent"));
    const live = new Harness(liveDefinition, liveScope("equivalent"));
    replay.execute(replay.market());
    live.execute(live.market());
    replay.execute(replay.observe("105"));
    live.execute(live.observe("105"));
    const economics = (state: ChallengeAccountState) => ({
      stability: state.projectionStability,
      checkpointCount: state.stableCheckpointSequence,
      cash: state.cashBalance,
      equity: state.equity,
      fees: state.totalCommissions,
      usedMargin: state.usedMargin,
      position: state.position && {
        side: state.position.side,
        quantity: state.position.quantity,
        entryPrice: state.position.entryPrice,
        mark: state.position.currentMark,
      },
    });
    expect(economics(live.account)).toEqual(economics(replay.account));
  });

  it("22 preserves every existing accounting invariant at all revisions", () => {
    const h = new Harness();
    const openFacts = h.prepare(h.market());
    for (const fact of openFacts) {
      const state = expectApplied(h.applyFact(fact));
      expect(verifyAccountInvariants(state)).toEqual({ ok: true, errors: [] });
    }
    const stable = expectApplied(h.commit(openFacts));
    expect(verifyAccountInvariants(stable)).toEqual({ ok: true, errors: [] });
    expect(stable.cashBalance).toBe(moneyFromDecimal("9999"));
  });

  it("23 keeps checkpoint behavior isolated to Challenge accounting", () => {
    const h = new Harness();
    expect(EXECUTION_CHECKPOINT_POLICY_V1).toMatchObject({
      executionCommandBoundary: "explicitAfterCompleteFactBatch",
      interleavedCommands: "reject",
      dayBoundary: "inherentlyStable",
    });
    expect(h.account.definitionHash).toBe(replayDefinition.definitionHash);
    expect(h.account.checkpointVersion)
      .toBe(EXECUTION_CHECKPOINT_POLICY_V1.checkpointVersion);
  });

  it("24 rejects an unsupported checkpoint contract version", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    expectRejected(h.commit(facts, {
      checkpointVersion: "unknown-checkpoint-version",
    }), "VERSION_MISMATCH");
  });

  it("25 rejects a checkpoint bound to another definition", () => {
    const h = new Harness();
    const facts = h.prepare(h.market());
    h.applyFacts(facts);
    expectRejected(h.commit(facts, {
      definitionHash: "wrong-definition-hash",
    }), "DEFINITION_MISMATCH");
  });

  it("26 rejects a new command while the current command is unfinished", () => {
    const h = new Harness();
    const firstFacts = h.prepare(h.market());
    expectApplied(h.applyFact(firstFacts[0]));
    const stateBeforeInterleave = h.account;

    const secondFacts = h.prepare(h.observe("105"));
    expectRejected(h.applyFact(secondFacts[0]), "UNFINISHED_COMMAND");
    expect(h.account).toBe(stateBeforeInterleave);
    expect(h.account.pendingExecutionCommand?.commandId)
      .toBe(firstFacts[0].commandId);
  });

  it("27 checkpoints a rejected command as a stable no-op outcome", () => {
    const h = new Harness();
    const command = h.market({ quantity: "0" });
    const result = reduceExecutionCommand(h.execution, command, environment);
    expect(result.ok).toBe(false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].kind).toBe("CommandRejected");
    h.execution = result.state;

    const before = h.account.cashBalance;
    h.applyFacts(result.facts);
    expect(h.account.projectionStability).toBe("INTERMEDIATE");
    const stable = expectApplied(h.commit(result.facts));
    expect(stable.projectionStability).toBe("STABLE");
    expect(stable.cashBalance).toBe(before);
    expect(stable.lastStableCheckpoint?.commandId).toBe(command.commandId);
  });});
