import { moneyFromAtoms, moneyFromDecimal } from "../domain/money";
import {
  accountId,
  instantMs,
  phaseId,
  type ChallengeRule,
  type ExecutionScope,
  type FrozenChallengeDefinition,
  type InstantMs,
  type PhaseDefinition,
} from "../domain/types";
import {
  canonicalHash,
  deepFreeze,
  RULES_VERSION,
} from "../domain/versions";
import { verifyFrozenChallengeDefinition } from "../domain/templates";
import { EXECUTION_CHECKPOINT_VERSION } from "../accounting/checkpoint";
import type {
  ChallengeAccountState,
  StableAccountCheckpoint,
} from "../accounting/types";
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
import type {
  BreachEvidence,
  ChallengeRuleLifecycleState,
  InitializeRuleLifecycleInput,
  PhaseLifecycleProjection,
  RuleDecision,
  RuleDecisionId,
  RuleEngineRejection,
  RuleEngineRejectionCode,
  RuleEngineResult,
  RuleEvaluation,
} from "./types";

function scopesEqual(left: ExecutionScope, right: ExecutionScope): boolean {
  if (
    left.mode !== right.mode ||
    left.accountId !== right.accountId ||
    left.challengeId !== right.challengeId ||
    left.phaseId !== right.phaseId ||
    left.generation !== right.generation
  ) return false;
  if (left.mode === "live" && right.mode === "live") return true;
  return left.mode === "replay" && right.mode === "replay" &&
    left.replaySessionId === right.replaySessionId &&
    left.branchId === right.branchId &&
    left.datasetHash === right.datasetHash;
}

function sameChallengeBranch(
  left: ExecutionScope,
  right: ExecutionScope,
): boolean {
  if (
    left.mode !== right.mode ||
    left.challengeId !== right.challengeId ||
    left.generation !== right.generation
  ) return false;
  if (left.mode === "live" && right.mode === "live") return true;
  return left.mode === "replay" && right.mode === "replay" &&
    left.replaySessionId === right.replaySessionId &&
    left.branchId === right.branchId &&
    left.datasetHash === right.datasetHash;
}

function rejection(
  code: RuleEngineRejectionCode,
  message: string,
  checkpoint?: StableAccountCheckpoint | null,
  field?: string,
): RuleEngineRejection {
  return {
    code,
    message,
    ...(checkpoint ? { checkpointId: checkpoint.checkpointId } : {}),
    ...(field ? { field } : {}),
  };
}

function rejected(
  state: ChallengeRuleLifecycleState,
  reason: RuleEngineRejection,
): RuleEngineResult {
  return deepFreeze({
    status: "rejected",
    state,
    decisions: [] as const,
    rejection: reason,
  });
}

function alreadyEvaluated(
  state: ChallengeRuleLifecycleState,
  checkpoint: StableAccountCheckpoint,
): RuleEngineResult {
  return deepFreeze({
    status: "alreadyEvaluated",
    state,
    decisions: [] as const,
    rejection: rejection(
      "ALREADY_EVALUATED",
      "Stable checkpoint was already evaluated.",
      checkpoint,
    ),
  });
}

function phaseDefinition(
  definition: FrozenChallengeDefinition,
  id: string,
): Readonly<PhaseDefinition> {
  const phase = definition.template.phases.find((candidate) => candidate.id === id);
  if (!phase) throw new RangeError(`Unknown phase "${id}".`);
  return phase;
}

function validateRules(definition: FrozenChallengeDefinition): void {
  if (definition.versions.rules !== RULES_VERSION) {
    throw new RangeError("Unsupported Challenge rules version.");
  }
  for (const phase of definition.template.phases) {
    for (const rule of phase.rules) assertSupportedRule(rule);
  }
}

function emptyPhase(
  phase: Readonly<PhaseDefinition>,
  firstAccount: ChallengeAccountState | null,
): PhaseLifecycleProjection {
  return {
    phaseId: phaseId(phase.id),
    sequence: phase.sequence,
    status: firstAccount ? "ACTIVE" : "LOCKED",
    accountId: firstAccount?.accountId ?? null,
    scope: firstAccount ? { ...firstAccount.scope } : null,
    phaseStartedAt: firstAccount?.phaseStartedAt ?? null,
    nextCheckpointSequence: 1,
    lastCheckpointId: null,
    ruleEvaluations: [],
    health: "SAFE",
    activeDayIds: [],
    qualifyingFillFactIds: [],
    processedClosedDayIds: [],
    profitableDayIds: [],
    lastQualifyingActivityAt: null,
    targetReached: false,
    breaches: [],
    primaryBreach: null,
  };
}

export function initializeChallengeRuleLifecycle(
  input: InitializeRuleLifecycleInput,
): ChallengeRuleLifecycleState {
  const definition = verifyFrozenChallengeDefinition(input.definition);
  validateRules(definition);
  const firstPhase = [...definition.template.phases]
    .sort((left, right) => left.sequence - right.sequence)[0];
  if (!firstPhase) throw new RangeError("Challenge requires at least one phase.");
  const account = input.initialAccount;
  if (
    account.definitionHash !== definition.definitionHash ||
    account.phaseId !== firstPhase.id ||
    account.symbol !== definition.selectedSymbol ||
    account.mode !== definition.mode ||
    account.challengeId !== account.scope.challengeId
  ) {
    throw new RangeError("Initial Task 3 account does not match the first phase.");
  }
  if (account.revision !== 0 || account.stableCheckpointSequence !== 0 ||
      account.projectionStability !== "STABLE") {
    throw new RangeError("Rule lifecycle must start from the initial stable account.");
  }
  const phases = [...definition.template.phases]
    .sort((left, right) => left.sequence - right.sequence)
    .map((phase, index) => emptyPhase(phase, index === 0 ? account : null));
  return deepFreeze({
    rulesVersion: RULES_VERSION,
    definitionHash: definition.definitionHash,
    challengeId: account.challengeId,
    mode: definition.mode,
    generation: account.generation,
    symbol: definition.selectedSymbol,
    rootScope: { ...account.scope },
    status: "NOT_STARTED",
    currentPhaseId: phases[0].phaseId,
    phases,
    processedCheckpointIds: [],
    decisions: [],
    nextDecisionSequence: 1,
  });
}

type DecisionDraft = Omit<RuleDecision, "decisionId" | "decisionSequence">;

function finalizeDecisions(
  state: ChallengeRuleLifecycleState,
  drafts: readonly DecisionDraft[],
): readonly RuleDecision[] {
  return drafts.map((draft, index) => {
    const decisionSequence = state.nextDecisionSequence + index;
    const basis = {
      rulesVersion: state.rulesVersion,
      decision: draft,
      decisionSequence,
    };
    return deepFreeze({
      decisionId: (`decision:${canonicalHash(basis)}`) as RuleDecisionId,
      decisionSequence,
      ...draft,
    });
  });
}

function decisionBase(
  account: ChallengeAccountState,
  checkpoint: StableAccountCheckpoint,
) {
  return {
    challengeId: account.challengeId,
    accountId: account.accountId,
    phaseId: account.phaseId,
    checkpointId: checkpoint.checkpointId,
    accountRevision: account.revision,
    definitionHash: account.definitionHash,
    occurredAt: checkpoint.occurredAt,
  };
}
function previousRule(
  phase: PhaseLifecycleProjection,
  ruleId: string,
): RuleEvaluation | undefined {
  return phase.ruleEvaluations.find((evaluation) => evaluation.ruleId === ruleId);
}

function exposureIncreasingFills(account: ChallengeAccountState) {
  return account.fills.filter((record) =>
    record.fill.classification === "entry" ||
    record.fill.classification === "increase");
}

function findRule<Kind extends ChallengeRule["kind"]>(
  phase: Readonly<PhaseDefinition>,
  kind: Kind,
): Extract<ChallengeRule, { kind: Kind }> {
  const rule = phase.rules.find((candidate) => candidate.kind === kind);
  if (!rule) throw new RangeError(`Phase "${phase.id}" lacks ${kind} rule.`);
  return rule as Extract<ChallengeRule, { kind: Kind }>;
}

function evaluateRules(
  definitionPhase: Readonly<PhaseDefinition>,
  phase: PhaseLifecycleProjection,
  account: ChallengeAccountState,
  activeDayIds: PhaseLifecycleProjection["activeDayIds"],
  profitableDayIds: PhaseLifecycleProjection["profitableDayIds"],
  lastActivity: InstantMs,
  evaluatedAt: InstantMs,
  checkpoint: StableAccountCheckpoint,
): readonly RuleEvaluation[] {
  const finalizedDay = checkpoint.kind === "dayBoundary"
    ? account.closedDays.find((day) => day.closedAt === checkpoint.occurredAt)
    : undefined;
  const dailyObservationAccount = finalizedDay
    ? {
        ...account,
        equity: finalizedDay.endingEquity,
        day: { ...account.day, dayStartCash: finalizedDay.startCash },
      }
    : account;
  return definitionPhase.rules.map((rule) => {
    switch (rule.kind) {
      case "loss":
        return evaluateLossRule(
          rule,
          rule.window === "daily" ? dailyObservationAccount : account,
          previousRule(phase, rule.id),
        );
      case "profitTarget":
        return evaluateProfitTargetRule(rule, account);
      case "activeDays":
        return evaluateActiveDaysRule(rule, activeDayIds);
      case "profitableDays":
        return evaluateProfitableDaysRule(
          rule,
          profitableDayIds,
          account.phaseStartingCash,
        );
      case "inactivity":
        return evaluateInactivityRule(rule, lastActivity, evaluatedAt);
      case "leverage":
        return evaluateLeverageRule(rule);
      default:
        throw new RangeError("Unsupported Challenge rule kind.");
    }
  });
}

function breachEvidence(
  evaluation: RuleEvaluation,
  account: ChallengeAccountState,
  checkpoint: StableAccountCheckpoint,
): BreachEvidence | null {
  if (evaluation.status !== "BREACHED" ||
      evaluation.enforcement !== "hard") return null;
  const base = decisionBase(account, checkpoint);
  if (evaluation.kind === "loss") {
    const evidenceBasis = {
      ...base,
      ruleId: evaluation.ruleId,
      ruleKind: "loss" as const,
      metric: "equity" as const,
      operator: "<=" as const,
      actual: evaluation.observed,
      threshold: evaluation.floor,
      headroom: evaluation.headroom,
      excess: moneyFromAtoms(
        evaluation.floor > evaluation.observed
          ? evaluation.floor - evaluation.observed
          : BigInt(0),
      ),
      supportingFactIds: [...checkpoint.factIds],
    };
    return {
      evidenceId: `breach:${canonicalHash(evidenceBasis)}`,
      ...evidenceBasis,
    };
  }
  if (evaluation.kind === "inactivity") {
    const evidenceBasis = {
      ...base,
      ruleId: evaluation.ruleId,
      ruleKind: "inactivity" as const,
      metric: "logicalTime" as const,
      operator: ">=" as const,
      actual: evaluation.evaluatedAt,
      threshold: evaluation.deadline,
      headroom: evaluation.deadline - evaluation.evaluatedAt,
      excess: Math.max(0, evaluation.evaluatedAt - evaluation.deadline),
      supportingFactIds: [...checkpoint.factIds],
    };
    return {
      evidenceId: `breach:${canonicalHash(evidenceBasis)}`,
      ...evidenceBasis,
    };
  }
  return null;
}

function appendRuleTransitionDecisions(
  drafts: DecisionDraft[],
  phase: PhaseLifecycleProjection,
  evaluations: readonly RuleEvaluation[],
  account: ChallengeAccountState,
  checkpoint: StableAccountCheckpoint,
): void {
  const base = decisionBase(account, checkpoint);
  for (const evaluation of evaluations) {
    const previous = previousRule(phase, evaluation.ruleId)?.status;
    if (previous !== evaluation.status) {
      drafts.push({
        kind: "RuleStatusChanged",
        ...base,
        ruleId: evaluation.ruleId,
        ...(previous ? { previousStatus: previous } : {}),
        status: evaluation.status,
      });
    }
    const previouslyArmed = previous === "WARNING" || previous === "DANGER";
    if (evaluation.status === "WARNING" && !previouslyArmed) {
      drafts.push({ kind: "WarningRaised", ...base, ruleId: evaluation.ruleId });
    }
    if (evaluation.status === "DANGER" && previous !== "DANGER") {
      drafts.push({ kind: "DangerRaised", ...base, ruleId: evaluation.ruleId });
    }
    if (previouslyArmed && evaluation.status === "SAFE") {
      drafts.push({ kind: "WarningRearmed", ...base, ruleId: evaluation.ruleId });
    }
  }
}

function validationFailure(
  state: ChallengeRuleLifecycleState,
  account: ChallengeAccountState,
  definition: FrozenChallengeDefinition,
): RuleEngineResult | null {
  const checkpoint = account.lastStableCheckpoint;
  if (account.projectionStability !== "STABLE" || account.pendingExecutionCommand) {
    return rejected(state, rejection(
      "INTERMEDIATE_PROJECTION",
      "Lifecycle evaluation requires an explicit stable Task 3A checkpoint.",
      checkpoint,
      "projectionStability",
    ));
  }
  if (!checkpoint) {
    return rejected(state, rejection(
      "NO_STABLE_CHECKPOINT",
      "Lifecycle evaluation requires a recorded stable checkpoint.",
    ));
  }
  if (state.processedCheckpointIds.includes(checkpoint.checkpointId)) {
    return alreadyEvaluated(state, checkpoint);
  }
  if (
    definition.definitionHash !== state.definitionHash ||
    account.definitionHash !== state.definitionHash
  ) {
    return rejected(state, rejection(
      "DEFINITION_MISMATCH",
      "Frozen definition does not match the lifecycle state and account.",
      checkpoint,
      "definitionHash",
    ));
  }
  if (
    definition.versions.rules !== RULES_VERSION ||
    state.rulesVersion !== RULES_VERSION ||
    account.checkpointVersion !== EXECUTION_CHECKPOINT_VERSION ||
    account.executionVersion !== definition.versions.execution ||
    account.accountingVersion !== definition.versions.accounting ||
    account.instrumentPolicyVersion !== definition.instrumentPolicy.policyVersion
  ) {
    return rejected(state, rejection(
      "VERSION_MISMATCH",
      "Rule or upstream Challenge contract version mismatch.",
      checkpoint,
    ));
  }
  if (
    checkpoint.stableAccountRevision !== account.revision ||
    checkpoint.stableLedgerHash !== account.ledgerHash ||
    checkpoint.checkpointSequence !== account.stableCheckpointSequence ||
    account.checkpoints.at(-1)?.checkpointId !== checkpoint.checkpointId
  ) {
    return rejected(state, rejection(
      "INVALID_PROJECTION",
      "Stable checkpoint does not match the supplied account projection.",
      checkpoint,
    ));
  }
  if (
    account.symbol !== state.symbol ||
    account.phaseId !== account.scope.phaseId ||
    account.accountId !== account.scope.accountId ||
    !sameChallengeBranch(account.scope, state.rootScope)
  ) {
    return rejected(state, rejection(
      "SCOPE_MISMATCH",
      "Account scope does not belong to this Challenge branch.",
      checkpoint,
      "scope",
    ));
  }
  return null;
}
export function evaluateStableCheckpoint(
  state: ChallengeRuleLifecycleState,
  account: ChallengeAccountState,
  inputDefinition: Readonly<FrozenChallengeDefinition>,
): RuleEngineResult {
  let definition: Readonly<FrozenChallengeDefinition>;
  try {
    definition = verifyFrozenChallengeDefinition(inputDefinition);
    validateRules(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unsupported rule contract.";
    const code: RuleEngineRejectionCode = message.includes("version")
      ? "VERSION_MISMATCH"
      : message.includes("Unsupported") ? "UNSUPPORTED_RULE" : "DEFINITION_MISMATCH";
    return rejected(state, rejection(code, message, account.lastStableCheckpoint));
  }
  const invalid = validationFailure(state, account, definition);
  if (invalid) return invalid;
  const checkpoint = account.lastStableCheckpoint as StableAccountCheckpoint;
  const phaseIndex = state.phases.findIndex(
    (candidate) => candidate.phaseId === account.phaseId,
  );
  if (phaseIndex < 0) {
    return rejected(state, rejection(
      "SCOPE_MISMATCH",
      "Account phase is not present in the frozen Challenge definition.",
      checkpoint,
      "phaseId",
    ));
  }

  let phase = state.phases[phaseIndex];
  const definitionPhase = phaseDefinition(definition, phase.phaseId);
  const drafts: DecisionDraft[] = [];
  const base = decisionBase(account, checkpoint);
  let challengeStatus = state.status;

  if (phase.scope === null) {
    if (phase.status !== "LOCKED" || state.currentPhaseId !== phase.phaseId) {
      return rejected(state, rejection(
        "SCOPE_MISMATCH",
        "Phase is not eligible for activation.",
        checkpoint,
        "phaseId",
      ));
    }
    phase = {
      ...phase,
      status: "ACTIVE",
      accountId: accountId(account.accountId),
      scope: { ...account.scope },
      phaseStartedAt: account.phaseStartedAt,
    };
    drafts.push({ kind: "PhaseActivated", ...base });
  } else if (!scopesEqual(phase.scope, account.scope) ||
      phase.phaseStartedAt !== account.phaseStartedAt) {
    return rejected(state, rejection(
      "SCOPE_MISMATCH",
      "Account scope or phase-start time changed within the phase.",
      checkpoint,
      "scope",
    ));
  }

  if (checkpoint.checkpointSequence !== phase.nextCheckpointSequence) {
    return rejected(state, rejection(
      "OUT_OF_ORDER",
      "Stable checkpoints must be evaluated in checkpoint-sequence order.",
      checkpoint,
      "checkpointSequence",
    ));
  }
  if (account.phaseStartingCash !== moneyFromDecimal(definition.selectedCapital)) {
    return rejected(state, rejection(
      "INVALID_PROJECTION",
      "Phase starting cash does not match the frozen selected capital.",
      checkpoint,
      "phaseStartingCash",
    ));
  }

  if (phase.status === "PASSED" || phase.status === "FAILED") {
    const terminalPhase = {
      ...phase,
      nextCheckpointSequence: phase.nextCheckpointSequence + 1,
      lastCheckpointId: checkpoint.checkpointId,
    };
    const terminalState = deepFreeze({
      ...state,
      phases: state.phases.map((candidate, index) =>
        index === phaseIndex ? terminalPhase : candidate),
      processedCheckpointIds: [
        ...state.processedCheckpointIds,
        checkpoint.checkpointId,
      ],
    });
    return deepFreeze({
      status: "applied",
      state: terminalState,
      decisions: [] as const,
    });
  }

  if (challengeStatus === "NOT_STARTED") {
    challengeStatus = "ACTIVE";
    drafts.push({ kind: "ChallengeStarted", ...base });
  }

  const newQualifyingFills = exposureIncreasingFills(account).filter(
    (record) => !phase.qualifyingFillFactIds.includes(record.factId),
  );
  const qualifyingFillFactIds = [
    ...phase.qualifyingFillFactIds,
    ...newQualifyingFills.map((record) => record.factId),
  ];
  const activeDayIds = [...phase.activeDayIds];
  for (const record of newQualifyingFills) {
    if (!activeDayIds.includes(record.dayId)) {
      activeDayIds.push(record.dayId);
      drafts.push({
        kind: "ActiveDayQualified",
        ...base,
        ruleId: findRule(definitionPhase, "activeDays").id,
        dayId: record.dayId,
      });
    }
  }
  const activityTimes = newQualifyingFills.map((record) => record.occurredAt);
  const lastQualifyingActivityAt = activityTimes.length > 0
    ? instantMs(Math.max(
        phase.lastQualifyingActivityAt ?? phase.phaseStartedAt ?? account.phaseStartedAt,
        ...activityTimes,
      ))
    : phase.lastQualifyingActivityAt;
  const inactivityReference = lastQualifyingActivityAt ??
    phase.phaseStartedAt ?? account.phaseStartedAt;

  const processedClosedDayIds = [...phase.processedClosedDayIds];
  const profitableDayIds = [...phase.profitableDayIds];
  const profitableRule = findRule(definitionPhase, "profitableDays");
  const profitableThreshold = evaluateProfitableDaysRule(
    profitableRule,
    [],
    account.phaseStartingCash,
  ).threshold;
  for (const closedDay of account.closedDays) {
    if (processedClosedDayIds.includes(closedDay.dayId)) continue;
    processedClosedDayIds.push(closedDay.dayId);
    if (
      activeDayIds.includes(closedDay.dayId) &&
      closedDay.settledNetPnl >= profitableThreshold &&
      !profitableDayIds.includes(closedDay.dayId)
    ) {
      profitableDayIds.push(closedDay.dayId);
      drafts.push({
        kind: "ProfitableDayQualified",
        ...base,
        ruleId: profitableRule.id,
        dayId: closedDay.dayId,
      });
    }
  }

  let evaluations: readonly RuleEvaluation[];
  try {
    evaluations = evaluateRules(
      definitionPhase,
      phase,
      account,
      activeDayIds,
      profitableDayIds,
      inactivityReference,
      checkpoint.occurredAt,
      checkpoint,
    );
  } catch (error) {
    return rejected(state, rejection(
      "UNSUPPORTED_RULE",
      error instanceof Error ? error.message : "Unsupported Challenge rule.",
      checkpoint,
    ));
  }
  appendRuleTransitionDecisions(drafts, phase, evaluations, account, checkpoint);

  const newBreaches = evaluations
    .map((evaluation) => breachEvidence(evaluation, account, checkpoint))
    .filter((evidence): evidence is BreachEvidence => evidence !== null);
  for (const evidence of newBreaches) {
    drafts.push({
      kind: "BreachRecorded",
      ...base,
      ruleId: evidence.ruleId,
      evidence,
    });
  }

  const target = evaluations.find(
    (evaluation) => evaluation.kind === "profitTarget",
  );
  const activeDays = evaluations.find(
    (evaluation) => evaluation.kind === "activeDays",
  );
  const profitableDays = evaluations.find(
    (evaluation) => evaluation.kind === "profitableDays",
  );
  if (!target || target.kind !== "profitTarget" ||
      !activeDays || activeDays.kind !== "activeDays" ||
      !profitableDays || profitableDays.kind !== "profitableDays") {
    return rejected(state, rejection(
      "UNSUPPORTED_RULE",
      "Phase lacks required completion-rule evaluations.",
      checkpoint,
    ));
  }
  if (target.reached && !phase.targetReached) {
    drafts.push({
      kind: "TargetReached",
      ...base,
      ruleId: target.ruleId,
    });
  }

  let phaseStatus: PhaseLifecycleProjection["status"] = phase.status;
  let currentPhaseId = state.currentPhaseId;
  let primaryBreach = phase.primaryBreach;
  const breaches = [...phase.breaches, ...newBreaches];
  if (newBreaches.length > 0) {
    primaryBreach = primaryBreach ?? newBreaches[0];
    phaseStatus = "FAILED";
    challengeStatus = "FAILED";
    drafts.push({
      kind: "PhaseFailed",
      ...base,
      primaryBreachEvidenceId: primaryBreach.evidenceId,
    });
    drafts.push({
      kind: "ChallengeFailed",
      ...base,
      primaryBreachEvidenceId: primaryBreach.evidenceId,
    });
  } else {
    const completionReady =
      target.reached &&
      activeDays.completed >= activeDays.required &&
      profitableDays.completed >= profitableDays.required &&
      account.position === null &&
      account.reservations.length === 0;
    if (completionReady) {
      phaseStatus = "PASSED";
      drafts.push({ kind: "PhasePassed", ...base });
      if (definitionPhase.transition.nextPhaseId) {
        currentPhaseId = phaseId(definitionPhase.transition.nextPhaseId);
        drafts.push({
          kind: "NextPhaseEligible",
          ...base,
          nextPhaseId: currentPhaseId,
        });
      } else {
        challengeStatus = "PASSED";
        drafts.push({ kind: "ChallengePassed", ...base });
      }
    }
  }

  const updatedPhase: PhaseLifecycleProjection = {
    ...phase,
    status: phaseStatus,
    nextCheckpointSequence: phase.nextCheckpointSequence + 1,
    lastCheckpointId: checkpoint.checkpointId,
    ruleEvaluations: [...evaluations],
    health: healthFromRules(evaluations),
    activeDayIds,
    qualifyingFillFactIds,
    processedClosedDayIds,
    profitableDayIds,
    lastQualifyingActivityAt,
    targetReached: target.reached,
    breaches,
    primaryBreach,
  };
  const decisions = finalizeDecisions(state, drafts);
  const nextState = deepFreeze({
    ...state,
    status: challengeStatus,
    currentPhaseId,
    phases: state.phases.map((candidate, index) =>
      index === phaseIndex ? updatedPhase : candidate),
    processedCheckpointIds: [
      ...state.processedCheckpointIds,
      checkpoint.checkpointId,
    ],
    decisions: [...state.decisions, ...decisions],
    nextDecisionSequence: state.nextDecisionSequence + decisions.length,
  });
  return deepFreeze({ status: "applied", state: nextState, decisions });
}
