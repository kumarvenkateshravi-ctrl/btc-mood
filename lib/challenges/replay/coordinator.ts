import {
  applyChallengeAccountInput,
  dayBoundaryLedgerInput,
  executionCheckpointLedgerInput,
  executionFactLedgerInput,
  initializeChallengeAccount,
} from "../accounting/ledger";
import { assertAccountInvariants } from "../accounting/invariants";
import type { ChallengeAccountState } from "../accounting/types";
import { nextUtcDayBoundary } from "../domain/calendar";
import {
  accountId,
  branchId,
  instantMs,
  type ExecutionScope,
  type FrozenChallengeDefinition,
  type InstantMs,
} from "../domain/types";
import { canonicalHash, deepFreeze } from "../domain/versions";
import { createExecutionState, reduceExecutionCommand } from "../execution/reducer";
import { replayCandleObservations } from "../execution/replay";
import {
  commandId,
  lifecycleId,
  positionId,
  reservationId,
  workingOrderId,
} from "../execution/policy";
import type {
  ChallengeExecutionEnvironment,
  ExecutionCommand,
  ExecutionFact,
  ExecutionState,
} from "../execution/types";
import {
  evaluateStableCheckpoint,
  initializeChallengeRuleLifecycle,
} from "../rules/engine";
import type { ChallengeRuleLifecycleState, RuleDecision } from "../rules/types";
import type { Candle } from "../../types";
import { candleInstantMs, verifyChallengeReplayDataset } from "./dataset";
import { buildChallengeReplayReadModel } from "./readModel";
import type {
  AcceptedChallengeReplayAction,
  ArchivedChallengeReplayBranch,
  ChallengeReplayContext,
  ChallengeReplayIdentities,
  ChallengeReplayJournal,
  ChallengeReplayOperationResult,
  ChallengeReplayRejection,
  ChallengeReplaySnapshot,
  ChallengeReplayStableState,
  ChallengeReplayTradingIntent,
  StartReplayChallengeInput,
} from "./types";

interface CoreState {
  execution: ExecutionState;
  account: ChallengeAccountState;
  lifecycle: ChallengeRuleLifecycleState;
  cursor: number;
  logicalTime: InstantMs;
  commandSequence: number;
  pendingPhaseTransition: boolean;
  actions: readonly AcceptedChallengeReplayAction[];
  availability: "ACTIVE" | "DATASET_EXHAUSTED";
}

interface CycleResult {
  ok: boolean;
  decisions: readonly RuleDecision[];
  rejection?: ChallengeReplayRejection;
}

/** Immutable, regenerated evidence emitted only after an accounting checkpoint is stable. */
export interface ChallengeReplayEvidenceCycle {
  readonly kind: "execution" | "dayBoundary";
  readonly cursor: number;
  readonly occurredAt: InstantMs;
  readonly phaseId: string;
  readonly command: ExecutionCommand | null;
  readonly facts: readonly ExecutionFact[];
  readonly account: ChallengeAccountState;
  readonly lifecycle: ChallengeRuleLifecycleState;
  readonly decisions: readonly RuleDecision[];
}

const rejection = (
  code: ChallengeReplayRejection["code"],
  message: string,
  field?: string,
): ChallengeReplayRejection => ({ code, message, ...(field ? { field } : {}) });

function phaseMaximumLeverage(
  definition: FrozenChallengeDefinition,
  phaseIdValue: string,
) {
  const phase = definition.template.phases.find((item) => item.id === phaseIdValue);
  const leverage = phase?.rules.find((item) => item.kind === "leverage");
  if (!phase || !leverage || leverage.kind !== "leverage") {
    throw new RangeError("Challenge phase lacks its leverage rule.");
  }
  return leverage.maximum;
}

function environment(
  definition: FrozenChallengeDefinition,
  phaseIdValue: string,
): ChallengeExecutionEnvironment {
  return {
    instrumentPolicy: definition.instrumentPolicy,
    executionPolicy: definition.executionPolicy,
    maximumLeverage: phaseMaximumLeverage(definition, phaseIdValue),
  };
}

function replayScope(identities: ChallengeReplayIdentities): ExecutionScope {
  return {
    mode: "replay",
    challengeId: identities.challengeId,
    accountId: identities.accountId,
    phaseId: identities.phaseId,
    generation: identities.generation,
    replaySessionId: identities.replaySessionId,
    branchId: identities.branchId,
    datasetHash: "",
  };
}

function withDatasetHash(scope: ExecutionScope, datasetHash: string): ExecutionScope {
  if (scope.mode !== "replay") throw new RangeError("Replay scope required.");
  return { ...scope, datasetHash };
}

function isTerminal(lifecycle: ChallengeRuleLifecycleState): boolean {
  return lifecycle.status === "FAILED" || lifecycle.status === "PASSED";
}

function cloneIntent(intent: ChallengeReplayTradingIntent): ChallengeReplayTradingIntent {
  if (intent.kind === "market") {
    return { ...intent, ...(intent.protection ? { protection: { ...intent.protection } } : {}) };
  }
  if (intent.kind === "placeWorkingEntry") {
    return { ...intent, ...(intent.protection ? { protection: { ...intent.protection } } : {}) };
  }
  if (intent.kind === "updateProtection") {
    return { ...intent, update: { ...intent.update } };
  }
  return { ...intent };
}

export class ChallengeReplayCoordinator {
  private readonly definition: Readonly<FrozenChallengeDefinition>;
  private readonly dataset: StartReplayChallengeInput["dataset"];
  private readonly startingCursor: number;
  private rootIdentities: ChallengeReplayIdentities;
  private state: CoreState;
  private snapshotValue: ChallengeReplaySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly archives = new Map<string, ArchivedChallengeReplayBranch>();
  private readonly evidenceCycles: ChallengeReplayEvidenceCycle[] = [];

  private constructor(input: StartReplayChallengeInput, state: CoreState, private readonly captureEvidence = false) {
    this.definition = input.frozenDefinition;
    this.dataset = input.dataset;
    this.startingCursor = input.startingCursor;
    this.rootIdentities = { ...input.identities };
    this.state = state;
    this.snapshotValue = this.makeSnapshot();
  }

  static start(input: StartReplayChallengeInput, captureEvidence = false): ChallengeReplayCoordinator {
    const dataset = verifyChallengeReplayDataset(input.dataset);
    if (input.frozenDefinition.mode !== "replay") {
      throw new RangeError("Challenge Replay requires a replay definition.");
    }
    if (input.frozenDefinition.selectedSymbol !== dataset.symbol) {
      throw new RangeError("Replay dataset symbol does not match the Challenge definition.");
    }
    if (input.executionTimeframe !== dataset.executionTimeframe) {
      throw new RangeError("Execution timeframe does not match the frozen replay dataset.");
    }
    if (!Number.isSafeInteger(input.startingCursor) || input.startingCursor < 0 ||
        input.startingCursor >= dataset.candles.length) {
      throw new RangeError("Starting replay cursor is outside the frozen dataset.");
    }
    if (!Number.isSafeInteger(input.identities.generation) || input.identities.generation < 0) {
      throw new RangeError("Replay generation must be a non-negative safe integer.");
    }
    const firstPhase = [...input.frozenDefinition.template.phases]
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (!firstPhase || input.selectedPhase !== firstPhase.id ||
        input.identities.phaseId !== input.selectedPhase) {
      throw new RangeError("A new replay attempt must begin in its first phase.");
    }
    const normalizedInput = { ...input, dataset };
    const scope = withDatasetHash(
      replayScope(input.identities),
      dataset.datasetHash,
    );
    const occurredAt = instantMs(candleInstantMs(dataset.candles[input.startingCursor]));
    const account = initializeChallengeAccount({
      definition: input.frozenDefinition,
      phaseId: input.selectedPhase,
      scope,
      occurredAt,
    });
    const execution = createExecutionState(
      scope,
      environment(input.frozenDefinition, input.selectedPhase),
    );
    const lifecycle = initializeChallengeRuleLifecycle({
      definition: input.frozenDefinition,
      initialAccount: account,
    });
    const coordinator = new ChallengeReplayCoordinator(normalizedInput, {
      execution,
      account,
      lifecycle,
      cursor: input.startingCursor,
      logicalTime: occurredAt,
      commandSequence: 1,
      pendingPhaseTransition: false,
      actions: [],
      availability: input.startingCursor >= dataset.candles.length - 1
        ? "DATASET_EXHAUSTED"
        : "ACTIVE",
    }, captureEvidence);
    const initial = coordinator.observationCommand(
      dataset.candles[input.startingCursor].close.toString(),
      "segment",
      3,
      occurredAt,
      { source: "initial-close", cursor: input.startingCursor },
    );
    const result = coordinator.runCommandCycle(initial);
    if (!result.ok) throw new RangeError(result.rejection?.message ?? "Initial replay mark failed.");
    coordinator.publish();
    return coordinator;
  }

  /** @internal Restores a hash-verified stable cache; callers retain the canonical journal. */
  static restoreStable(
    input: StartReplayChallengeInput,
    stable: ChallengeReplayStableState,
  ): ChallengeReplayCoordinator {
    const dataset = verifyChallengeReplayDataset(input.dataset);
    const scope = stable.account.scope;
    if (input.frozenDefinition.mode !== "replay" || scope.mode !== "replay" ||
        input.frozenDefinition.selectedSymbol !== dataset.symbol ||
        input.executionTimeframe !== dataset.executionTimeframe ||
        stable.cursor < input.startingCursor || stable.cursor >= dataset.candles.length ||
        scope.challengeId !== input.identities.challengeId ||
        scope.replaySessionId !== input.identities.replaySessionId ||
        scope.branchId !== input.identities.branchId ||
        scope.generation !== input.identities.generation ||
        scope.datasetHash !== dataset.datasetHash ||
        canonicalHash(stable.execution.scope) !== canonicalHash(scope) ||
        stable.lifecycle.challengeId !== scope.challengeId ||
        stable.lifecycle.currentPhaseId !== scope.phaseId ||
        stable.lifecycle.generation !== scope.generation ||
        stable.account.accountId !== scope.accountId ||
        stable.account.phaseId !== scope.phaseId ||
        stable.actions.some((action) => action.cursor < input.startingCursor || action.cursor > stable.cursor) ||
        !Number.isSafeInteger(stable.commandSequence) || stable.commandSequence < 1 ||
        !stable.account.lastStableCheckpoint) {
      throw new RangeError("Stable replay checkpoint scope or state is invalid.");
    }
    assertAccountInvariants(stable.account);
    const coordinator = new ChallengeReplayCoordinator({ ...input, dataset }, {
      execution: stable.execution,
      account: stable.account,
      lifecycle: stable.lifecycle,
      cursor: stable.cursor,
      logicalTime: stable.logicalTime,
      commandSequence: stable.commandSequence,
      pendingPhaseTransition: stable.pendingPhaseTransition,
      actions: stable.actions,
      availability: stable.availability,
    });
    coordinator.publish();
    return coordinator;
  }
  getSnapshot(): ChallengeReplaySnapshot { return this.snapshotValue; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getContext(): ChallengeReplayContext {
    const scope = this.state.account.scope;
    if (scope.mode !== "replay") throw new RangeError("Replay scope required.");
    return {
      replaySessionId: scope.replaySessionId,
      branchId: scope.branchId,
      datasetHash: scope.datasetHash,
      executionTimeframe: this.dataset.executionTimeframe,
      generation: scope.generation,
      accountId: scope.accountId,
      phaseId: scope.phaseId,
      cursor: this.state.cursor,
    };
  }

  getArchivedBranches(): readonly ArchivedChallengeReplayBranch[] {
    return [...this.archives.values()];
  }

  exportJournal(): ChallengeReplayJournal {
    return deepFreeze({
      definition: this.definition,
      dataset: this.dataset,
      executionTimeframe: this.dataset.executionTimeframe,
      startingCursor: this.startingCursor,
      identities: { ...this.rootIdentities },
      actions: this.state.actions.map((action) => ({
        ...action,
        intent: cloneIntent(action.intent),
      })),
      cursor: this.state.cursor,
    });
  }

  trade(
    context: ChallengeReplayContext,
    intent: ChallengeReplayTradingIntent,
  ): ChallengeReplayOperationResult {
    const invalid = this.validateContext(context);
    if (invalid) return this.rejectedResult(invalid);
    if (isTerminal(this.state.lifecycle)) {
      return this.rejectedResult(rejection(
        "TERMINAL_CHALLENGE",
        "Trading is blocked on a terminal Challenge branch.",
      ));
    }
    if (this.state.pendingPhaseTransition) {
      return this.rejectedResult(rejection(
        "PHASE_TRANSITION_PENDING",
        "The next Challenge phase begins on the next replay observation.",
      ));
    }
    if ((intent.kind === "closeFull" || intent.kind === "closePartial") &&
        !this.state.execution.position) {
      return this.rejectedResult(rejection(
        "NO_POSITION", "A close command requires an active position.", "position"));
    }
    const action: AcceptedChallengeReplayAction = deepFreeze({
      actionId: `action:${canonicalHash({
        branchId: context.branchId,
        generation: context.generation,
        cursor: context.cursor,
        ordinal: this.state.actions.length + 1,
        intent,
      })}`,
      cursor: this.state.cursor,
      occurredAt: this.state.logicalTime,
      intent: cloneIntent(intent),
    });
    const command = this.tradingCommand(action);
    const cycle = this.runCommandCycle(command);
    if (!cycle.ok && cycle.rejection?.code !== "EXECUTION_REJECTED") {
      return this.rejectedResult(cycle.rejection as ChallengeReplayRejection, cycle.decisions);
    }
    this.state = {
      ...this.state,
      actions: [...this.state.actions, action],
    };
    this.publish();
    return cycle.ok
      ? { status: "applied", snapshot: this.snapshotValue, decisions: cycle.decisions }
      : {
          status: "rejected",
          snapshot: this.snapshotValue,
          decisions: cycle.decisions,
          rejection: cycle.rejection as ChallengeReplayRejection,
        };
  }

  advanceTo(
    context: ChallengeReplayContext,
    targetCursor: number,
    options: { speed?: number } = {},
  ): ChallengeReplayOperationResult {
    const invalid = this.validateContext(context);
    if (invalid) return this.rejectedResult(invalid);
    if (!Number.isSafeInteger(targetCursor)) {
      return this.rejectedResult(rejection(
        "OUT_OF_ORDER_CURSOR", "Replay cursor must be a safe integer.", "targetCursor"));
    }
    if (targetCursor < this.state.cursor) return this.rewind(context, targetCursor);
    if (options.speed !== undefined &&
        (!Number.isFinite(options.speed) || options.speed <= 0)) {
      return this.rejectedResult(rejection(
        "OUT_OF_ORDER_CURSOR", "Replay speed must be positive.", "speed"));
    }
    const last = this.dataset.candles.length - 1;
    const target = Math.min(targetCursor, last);
    const decisions: RuleDecision[] = [];
    for (let cursor = this.state.cursor + 1; cursor <= target; cursor += 1) {
      const cycle = this.processCandle(cursor, this.dataset.candles[cursor]);
      decisions.push(...cycle.decisions);
      if (!cycle.ok) {
        return this.rejectedResult(cycle.rejection as ChallengeReplayRejection, decisions);
      }
    }
    this.state = {
      ...this.state,
      availability: targetCursor >= last ? "DATASET_EXHAUSTED" : "ACTIVE",
    };
    this.publish();
    if (targetCursor > last) {
      return {
        status: "rejected",
        snapshot: this.snapshotValue,
        decisions,
        rejection: rejection(
          "DATASET_EXHAUSTED",
          "Replay reached the final frozen candle; no boundary was fabricated.",
        ),
      };
    }
    return { status: "applied", snapshot: this.snapshotValue, decisions };
  }

  rewind(
    context: ChallengeReplayContext,
    targetCursor: number,
  ): ChallengeReplayOperationResult {
    const invalid = this.validateContext(context);
    if (invalid) return this.rejectedResult(invalid);
    if (!Number.isSafeInteger(targetCursor) || targetCursor < this.startingCursor ||
        targetCursor >= this.state.cursor) {
      return this.rejectedResult(rejection(
        "OUT_OF_ORDER_CURSOR",
        "Rewind target must be within the active branch prefix.",
        "targetCursor",
      ));
    }
    const oldScope = this.state.account.scope;
    if (oldScope.mode !== "replay") throw new RangeError("Replay scope required.");
    this.archives.set(String(oldScope.branchId), deepFreeze({
      branchId: oldScope.branchId,
      generation: oldScope.generation,
      cursor: this.state.cursor,
      actions: this.state.actions.map((action) => ({ ...action, intent: cloneIntent(action.intent) })),
      readModel: this.snapshotValue.readModel,
    }));
    const generation = oldScope.generation + 1;
    const retained = this.state.actions.filter((action) => action.cursor <= targetCursor);
    const nextBranch = branchId(`branch:${canonicalHash({
      parentBranchId: oldScope.branchId,
      generation,
      targetCursor,
      retainedActions: retained.map((action) => ({
        cursor: action.cursor,
        occurredAt: action.occurredAt,
        intent: action.intent,
      })),
    })}`);
    const remapped = retained.map((action, index) => deepFreeze({
      ...action,
      actionId: `action:${canonicalHash({
        branchId: nextBranch,
        generation,
        cursor: action.cursor,
        ordinal: index + 1,
        intent: action.intent,
      })}`,
      intent: cloneIntent(action.intent),
    }));
    const identities: ChallengeReplayIdentities = {
      ...this.rootIdentities,
      branchId: nextBranch,
      generation,
    };
    const rebuilt = reconstructReplayChallenge({
      definition: this.definition,
      dataset: this.dataset,
      executionTimeframe: this.dataset.executionTimeframe,
      startingCursor: this.startingCursor,
      identities,
      actions: remapped,
      cursor: targetCursor,
    });
    this.rootIdentities = identities;
    this.state = rebuilt.coordinator.state;
    this.snapshotValue = rebuilt.coordinator.snapshotValue;
    this.publish();
    return { status: "applied", snapshot: this.snapshotValue, decisions: [] };
  }

  private validateContext(context: ChallengeReplayContext): ChallengeReplayRejection | null {
    const scope = this.state.account.scope;
    if (scope.mode !== "replay") throw new RangeError("Replay scope required.");
    if (context.replaySessionId !== scope.replaySessionId) {
      return rejection("REPLAY_SESSION_MISMATCH", "Replay session identity mismatch.", "replaySessionId");
    }
    if (context.datasetHash !== this.dataset.datasetHash) {
      return rejection("DATASET_HASH_MISMATCH", "Frozen dataset hash mismatch.", "datasetHash");
    }
    if (context.executionTimeframe !== this.dataset.executionTimeframe) {
      return rejection("TIMEFRAME_MISMATCH", "Execution timeframe mismatch.", "executionTimeframe");
    }
    if (context.generation !== scope.generation) {
      return rejection("STALE_GENERATION", "Replay generation is stale.", "generation");
    }
    if (context.branchId !== scope.branchId) {
      return rejection("WRONG_BRANCH", "Replay branch identity mismatch.", "branchId");
    }
    if (context.phaseId !== scope.phaseId) {
      return rejection("WRONG_PHASE", "Challenge phase identity mismatch.", "phaseId");
    }
    if (context.accountId !== scope.accountId) {
      return rejection("WRONG_ACCOUNT", "Challenge account identity mismatch.", "accountId");
    }
    if (context.cursor !== this.state.cursor) {
      return rejection("WRONG_CURSOR", "Replay command cursor is stale.", "cursor");
    }
    return null;
  }

  private tradingCommand(action: AcceptedChallengeReplayAction): ExecutionCommand {
    const scope = this.state.account.scope;
    const sequence = this.state.commandSequence;
    const id = commandId(`command:${canonicalHash({
      branchId: scope.mode === "replay" ? scope.branchId : "",
      generation: scope.generation,
      phaseId: scope.phaseId,
      sequence,
      actionId: action.actionId,
    })}`);
    const identityBasis = { commandId: id, scope, sequence };
    const base = {
      commandId: id,
      scope,
      symbol: "BTCUSDT" as const,
      occurredAt: action.occurredAt,
    };
    const intent = action.intent;
    if (intent.kind === "market") {
      return {
        ...base,
        kind: "marketOrder",
        side: intent.side,
        quantity: intent.quantity,
        observedPrice: intent.observedPrice,
        leverage: intent.leverage,
        availableMarginForAdmission: this.state.account.freeMargin,
        reason: "market",
        newPositionId: positionId(`position:${canonicalHash(identityBasis)}`),
        newLifecycleId: lifecycleId(`lifecycle:${canonicalHash(identityBasis)}`),
        ...(intent.protection ? { protection: { ...intent.protection } } : {}),
      };
    }
    if (intent.kind === "closeFull" || intent.kind === "closePartial") {
      const position = this.state.execution.position;
      if (!position) throw new RangeError("Close command requires a position.");
      return {
        ...base,
        kind: "marketOrder",
        side: position.side === "long" ? "sell" : "buy",
        quantity: intent.kind === "closeFull" ? position.quantity : intent.quantity,
        observedPrice: intent.observedPrice,
        leverage: position.leverage,
        availableMarginForAdmission: this.state.account.freeMargin,
        reason: "manual",
      };
    }
    if (intent.kind === "updateProtection") {
      return { ...base, kind: "updateProtection", update: { ...intent.update } };
    }
    if (intent.kind === "cancelWorkingOrder") {
      return {
        ...base,
        kind: "cancelWorkingOrder",
        orderId: intent.orderId,
        reason: "user",
      };
    }
    return {
      ...base,
      kind: "placeWorkingEntry",
      orderId: workingOrderId(`order:${canonicalHash(identityBasis)}`),
      reservationId: reservationId(`reservation:${canonicalHash(identityBasis)}`),
      side: intent.side,
      orderType: intent.orderType,
      quantity: intent.quantity,
      triggerPrice: intent.triggerPrice,
      leverage: intent.leverage,
      availableMarginForAdmission: this.state.account.freeMargin,
      newPositionId: positionId(`position:${canonicalHash(identityBasis)}`),
      newLifecycleId: lifecycleId(`lifecycle:${canonicalHash(identityBasis)}`),
      ...(intent.protection ? { protection: { ...intent.protection } } : {}),
      ...(intent.ocoGroupId === undefined ? {} : { ocoGroupId: intent.ocoGroupId }),
    };
  }

  private observationCommand(
    price: string,
    transition: "gap" | "segment",
    pathIndex: number,
    occurredAt: InstantMs,
    cause: unknown,
  ): ExecutionCommand {
    const scope = this.state.account.scope;
    return {
      kind: "observePrice",
      commandId: commandId(`command:${canonicalHash({
        branchId: scope.mode === "replay" ? scope.branchId : "",
        generation: scope.generation,
        phaseId: scope.phaseId,
        sequence: this.state.commandSequence,
        cause,
      })}`),
      scope,
      symbol: "BTCUSDT",
      occurredAt,
      price,
      transition,
      pathIndex,
    };
  }

  private runCommandCycle(command: ExecutionCommand, evidenceCursor = this.state.cursor): CycleResult {
    const env = environment(this.definition, this.state.account.phaseId);
    const executionResult = reduceExecutionCommand(this.state.execution, command, env);
    if (executionResult.facts.length === 0) {
      return {
        ok: false,
        decisions: [],
        rejection: rejection("EXECUTION_REJECTED", executionResult.ok
          ? "Execution emitted no checkpointable facts."
          : executionResult.rejection.message),
      };
    }
    let account = this.state.account;
    for (const fact of executionResult.facts) {
      const applied = applyChallengeAccountInput(
        account,
        executionFactLedgerInput(account.nextInputSequence, fact, this.definition),
        this.definition,
      );
      if (applied.status !== "applied") {
        return {
          ok: false,
          decisions: [],
          rejection: rejection(
            "ACCOUNTING_REJECTED", applied.rejection.message, applied.rejection.field),
        };
      }
      account = applied.state;
    }
    const checkpoint = executionCheckpointLedgerInput({
      sequence: account.nextInputSequence,
      facts: executionResult.facts,
      account,
      definition: this.definition,
    });
    const committed = applyChallengeAccountInput(account, checkpoint, this.definition);
    if (committed.status !== "applied") {
      return {
        ok: false,
        decisions: [],
        rejection: rejection(
          "ACCOUNTING_REJECTED", committed.rejection.message, committed.rejection.field),
      };
    }
    const rules = evaluateStableCheckpoint(
      this.state.lifecycle,
      committed.state,
      this.definition,
    );
    if (rules.status !== "applied") {
      return {
        ok: false,
        decisions: [],
        rejection: rejection(
          "RULE_ENGINE_REJECTED", rules.rejection.message, rules.rejection.field),
      };
    }
    this.state = {
      ...this.state,
      execution: executionResult.state,
      account: committed.state,
      lifecycle: rules.state,
      commandSequence: this.state.commandSequence + 1,
      pendingPhaseTransition:
        rules.state.status === "ACTIVE" &&
        rules.state.currentPhaseId !== committed.state.phaseId,
    };
    if (this.captureEvidence) this.evidenceCycles.push(Object.freeze({
      kind: "execution",
      cursor: evidenceCursor,
      occurredAt: command.occurredAt,
      phaseId: String(committed.state.phaseId),
      command,
      facts: executionResult.facts,
      account: committed.state,
      lifecycle: rules.state,
      decisions: rules.decisions,
    }));
    if (!executionResult.ok) {
      return {
        ok: false,
        decisions: rules.decisions,
        rejection: {
          code: "EXECUTION_REJECTED",
          message: executionResult.rejection.message,
          field: executionResult.rejection.field,
          executionRejection: executionResult.rejection,
        },
      };
    }
    return { ok: true, decisions: rules.decisions };
  }

  private processDayBoundaries(until: InstantMs): CycleResult {
    const decisions: RuleDecision[] = [];
    while (nextUtcDayBoundary(this.state.account.lastOccurredAt) <= until) {
      const occurredAt = nextUtcDayBoundary(this.state.account.lastOccurredAt);
      const input = dayBoundaryLedgerInput({
        inputId: `boundary:${canonicalHash({
          branchId: this.state.account.scope.mode === "replay"
            ? this.state.account.scope.branchId : "",
          generation: this.state.account.generation,
          phaseId: this.state.account.phaseId,
          occurredAt,
        })}`,
        sequence: this.state.account.nextInputSequence,
        definition: this.definition,
        scope: this.state.account.scope,
        occurredAt,
        ...(this.state.account.position && this.state.account.lastMarkPrice
          ? { markPrice: this.state.account.lastMarkPrice }
          : {}),
      });
      const applied = applyChallengeAccountInput(
        this.state.account,
        input,
        this.definition,
      );
      if (applied.status !== "applied") {
        return {
          ok: false,
          decisions,
          rejection: rejection(
            "ACCOUNTING_REJECTED", applied.rejection.message, applied.rejection.field),
        };
      }
      const rules = evaluateStableCheckpoint(
        this.state.lifecycle,
        applied.state,
        this.definition,
      );
      if (rules.status !== "applied") {
        return {
          ok: false,
          decisions,
          rejection: rejection(
            "RULE_ENGINE_REJECTED", rules.rejection.message, rules.rejection.field),
        };
      }
      decisions.push(...rules.decisions);
      this.state = {
        ...this.state,
        account: applied.state,
        lifecycle: rules.state,
        logicalTime: occurredAt,
        pendingPhaseTransition:
          rules.state.status === "ACTIVE" &&
          rules.state.currentPhaseId !== applied.state.phaseId,
      };
      if (this.captureEvidence) this.evidenceCycles.push(Object.freeze({
        kind: "dayBoundary",
        cursor: this.state.cursor,
        occurredAt,
        phaseId: String(applied.state.phaseId),
        command: null,
        facts: [],
        account: applied.state,
        lifecycle: rules.state,
        decisions: rules.decisions,
      }));
    }
    return { ok: true, decisions };
  }

  private activateNextPhase(occurredAt: InstantMs): void {
    if (!this.state.pendingPhaseTransition) return;
    const nextPhaseId = this.state.lifecycle.currentPhaseId;
    const currentScope = this.state.account.scope;
    if (currentScope.mode !== "replay") throw new RangeError("Replay scope required.");
    const nextAccountId = accountId(`account:${canonicalHash({
      challengeId: currentScope.challengeId,
      branchId: currentScope.branchId,
      generation: currentScope.generation,
      phaseId: nextPhaseId,
    })}`);
    const nextScope: ExecutionScope = {
      ...currentScope,
      accountId: nextAccountId,
      phaseId: nextPhaseId,
    };
    const account = initializeChallengeAccount({
      definition: this.definition,
      phaseId: nextPhaseId,
      scope: nextScope,
      occurredAt,
    });
    const execution = createExecutionState(
      nextScope,
      environment(this.definition, nextPhaseId),
    );
    this.state = {
      ...this.state,
      account,
      execution,
      logicalTime: occurredAt,
      pendingPhaseTransition: false,
    };
  }

  /** @internal Used by deterministic reconstruction. */
  processCandle(cursor: number, candle: Readonly<Candle>): CycleResult {
    const occurredAt = instantMs(candleInstantMs(candle));
    if (isTerminal(this.state.lifecycle)) {
      // Terminal economics and evidence are immutable. Replay may keep navigating so
      // the user can inspect later bars, but no marks, boundaries, or rules may alter
      // the persisted PASS/FAIL result.
      this.state = {
        ...this.state,
        cursor,
        logicalTime: occurredAt,
        availability: cursor >= this.dataset.candles.length - 1
          ? "DATASET_EXHAUSTED" : "ACTIVE",
      };
      return { ok: true, decisions: [] };
    }
    const boundary = this.processDayBoundaries(occurredAt);
    if (!boundary.ok) return boundary;
    const decisions: RuleDecision[] = [...boundary.decisions];
    const modeled = replayCandleObservations({
      commandIdPrefix: "modeled",
      scope: this.state.account.scope,
      symbol: "BTCUSDT",
      occurredAt,
    }, {
      open: candle.open.toString(),
      high: candle.high.toString(),
      low: candle.low.toString(),
      close: candle.close.toString(),
    }, this.definition.executionPolicy);
    if (!this.state.pendingPhaseTransition && this.state.execution.position == null &&
        this.state.execution.workingOrders.length === 0) {
      // A flat account without working orders has no price-sensitive economic state.
      // UTC boundaries above still finalize days and evaluate inactivity. Preserve the
      // command sequence so later deterministic command identities remain unchanged.
      this.state = {
        ...this.state,
        cursor,
        logicalTime: occurredAt,
        commandSequence: this.state.commandSequence + modeled.length,
        availability: cursor >= this.dataset.candles.length - 1
          ? "DATASET_EXHAUSTED" : "ACTIVE",
      };
      return { ok: true, decisions };
    }
    for (const observation of modeled) {
      this.activateNextPhase(occurredAt);
      const command = this.observationCommand(
        observation.price,
        observation.transition,
        observation.pathIndex,
        occurredAt,
        { source: "candle", cursor, pathIndex: observation.pathIndex },
      );
      // Reports retain every economically meaningful cycle. An identical observation
      // with no pending trigger cannot change execution, accounting, or rule status.
      if (this.captureEvidence && observation.price === this.state.execution.lastObservedPrice &&
          this.state.execution.workingOrders.length === 0) {
        this.state = { ...this.state, commandSequence: this.state.commandSequence + 1 };
        continue;
      }
      const cycle = this.runCommandCycle(command, cursor);
      decisions.push(...cycle.decisions);
      if (!cycle.ok) return { ...cycle, decisions };
    }
    this.state = {
      ...this.state,
      cursor,
      logicalTime: occurredAt,
      availability: cursor >= this.dataset.candles.length - 1
        ? "DATASET_EXHAUSTED" : "ACTIVE",
    };
    return { ok: true, decisions };
  }

  private makeSnapshot(): ChallengeReplaySnapshot {
    const withoutReadModel = {
      definition: this.definition,
      dataset: this.dataset,
      execution: this.state.execution,
      account: this.state.account,
      lifecycle: this.state.lifecycle,
      cursor: this.state.cursor,
      logicalTime: this.state.logicalTime,
      coordinatorRevision: this.state.lifecycle.processedCheckpointIds.length,
      commandSequence: this.state.commandSequence,
      availability: this.state.availability,
      pendingPhaseTransition: this.state.pendingPhaseTransition,
      actions: this.state.actions,
    };
    return deepFreeze({
      ...withoutReadModel,
      readModel: buildChallengeReplayReadModel(withoutReadModel),
    });
  }

  /** @internal Publishes only a fully stable coordinator projection. */
  publish(): void {
    this.snapshotValue = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }

  /** Read-only regenerated evidence for deterministic reporting and audit views. */
  getEvidenceCycles(): readonly ChallengeReplayEvidenceCycle[] {
    return this.evidenceCycles;
  }

  private rejectedResult(
    reason: ChallengeReplayRejection,
    decisions: readonly RuleDecision[] = [],
  ): ChallengeReplayOperationResult {
    return {
      status: "rejected",
      snapshot: this.snapshotValue,
      decisions,
      rejection: reason,
    };
  }

  /** @internal Replays a previously accepted journal action. */
  replayAction(action: AcceptedChallengeReplayAction): CycleResult {
    const command = this.tradingCommand(action);
    const cycle = this.runCommandCycle(command);
    if (cycle.ok || cycle.rejection?.code === "EXECUTION_REJECTED") {
      this.state = { ...this.state, actions: [...this.state.actions, action] };
    }
    return cycle;
  }
}

export function startReplayChallenge(
  input: StartReplayChallengeInput,
): ChallengeReplayCoordinator {
  return ChallengeReplayCoordinator.start(input);
}

export function reconstructReplayChallenge(
  journal: ChallengeReplayJournal,
  captureEvidence = false,
): { coordinator: ChallengeReplayCoordinator; snapshot: ChallengeReplaySnapshot } {
  const coordinator = ChallengeReplayCoordinator.start({
    frozenDefinition: journal.definition,
    selectedPhase: journal.identities.phaseId,
    dataset: journal.dataset,
    executionTimeframe: journal.executionTimeframe,
    startingCursor: journal.startingCursor,
    identities: journal.identities,
  }, captureEvidence);
  const actionsByCursor = new Map<number, AcceptedChallengeReplayAction[]>();
  for (const action of journal.actions) {
    if (action.cursor > journal.cursor) continue;
    const list = actionsByCursor.get(action.cursor) ?? [];
    list.push(action);
    actionsByCursor.set(action.cursor, list);
  }
  const applyActions = (cursor: number) => {
    for (const action of actionsByCursor.get(cursor) ?? []) {
      const cycle = coordinator.replayAction(action);
      if (!cycle.ok && cycle.rejection?.code !== "EXECUTION_REJECTED") {
        throw new RangeError(`Replay reconstruction failed: ${cycle.rejection?.message}`);
      }
    }
  };
  applyActions(journal.startingCursor);
  for (let cursor = journal.startingCursor + 1; cursor <= journal.cursor; cursor += 1) {
    const cycle = coordinator.processCandle(cursor, journal.dataset.candles[cursor]);
    if (!cycle.ok) throw new RangeError(`Replay reconstruction failed: ${cycle.rejection?.message}`);
    applyActions(cursor);
  }
  coordinator.publish();
  return { coordinator, snapshot: coordinator.getSnapshot() };
}




export function reconstructReplayChallengeFromCheckpoint(
  journal: ChallengeReplayJournal,
  stable: ChallengeReplayStableState,
): { coordinator: ChallengeReplayCoordinator; snapshot: ChallengeReplaySnapshot } {
  if (stable.actions.length > journal.actions.length ||
      stable.actions.some((action, index) => canonicalHash(action) !== canonicalHash(journal.actions[index]))) {
    throw new RangeError("Stable replay checkpoint journal prefix is invalid.");
  }
  const coordinator = ChallengeReplayCoordinator.restoreStable({
    frozenDefinition: journal.definition,
    selectedPhase: journal.identities.phaseId,
    dataset: journal.dataset,
    executionTimeframe: journal.executionTimeframe,
    startingCursor: journal.startingCursor,
    identities: journal.identities,
  }, stable);
  let actionIndex = stable.actions.length;
  const applyActions = (cursor: number) => {
    while (actionIndex < journal.actions.length && journal.actions[actionIndex].cursor === cursor) {
      const cycle = coordinator.replayAction(journal.actions[actionIndex]);
      if (!cycle.ok && cycle.rejection?.code !== "EXECUTION_REJECTED") {
        throw new RangeError(`Replay reconstruction failed: ${cycle.rejection?.message}`);
      }
      actionIndex += 1;
    }
  };
  applyActions(stable.cursor);
  for (let cursor = stable.cursor + 1; cursor <= journal.cursor; cursor += 1) {
    const cycle = coordinator.processCandle(cursor, journal.dataset.candles[cursor]);
    if (!cycle.ok) throw new RangeError(`Replay reconstruction failed: ${cycle.rejection?.message}`);
    applyActions(cursor);
  }
  if (actionIndex !== journal.actions.length) {
    throw new RangeError("Replay checkpoint suffix contains an out-of-order action.");
  }
  coordinator.publish();
  return { coordinator, snapshot: coordinator.getSnapshot() };
}


