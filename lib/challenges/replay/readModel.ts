import {
  evaluateInactivityRule,
  evaluateLossRule,
  evaluateProfitableDaysRule,
  evaluateProfitTargetRule,
} from "../rules/evaluators";
import { subtractMoney } from "../domain/money";
import { deepFreeze } from "../domain/versions";
import type { ChallengeRule, PhaseDefinition } from "../domain/types";
import type {
  ActiveDaysRuleEvaluation,
  InactivityRuleEvaluation,
  LossRuleEvaluation,
  ProfitableDaysRuleEvaluation,
  RuleEvaluation,
} from "../rules/types";
import type {
  ChallengeReplayAvailability,
  ChallengeReplayReadModel,
  ChallengeReplaySnapshot,
  RequiredRuleReadModels,
} from "./types";

function phaseDefinition(snapshot: Omit<ChallengeReplaySnapshot, "readModel">) {
  const phase = snapshot.definition.template.phases.find(
    (candidate) => candidate.id === snapshot.account.phaseId,
  );
  if (!phase) throw new RangeError("Replay account phase is not in its definition.");
  return phase;
}

function rule<Kind extends ChallengeRule["kind"]>(
  phase: Readonly<PhaseDefinition>,
  kind: Kind,
): Extract<ChallengeRule, { kind: Kind }> {
  const found = phase.rules.find((candidate) => candidate.kind === kind);
  if (!found) throw new RangeError(`Phase lacks required ${kind} rule.`);
  return found as Extract<ChallengeRule, { kind: Kind }>;
}

function evaluation<Kind extends RuleEvaluation["kind"]>(
  evaluations: readonly RuleEvaluation[],
  kind: Kind,
): Extract<RuleEvaluation, { kind: Kind }> | undefined {
  return evaluations.find((candidate) => candidate.kind === kind) as
    Extract<RuleEvaluation, { kind: Kind }> | undefined;
}

function requiredEvaluations(
  snapshot: Omit<ChallengeReplaySnapshot, "readModel">,
): RequiredRuleReadModels {
  const phaseProjection = snapshot.lifecycle.phases.find(
    (candidate) => candidate.phaseId === snapshot.account.phaseId,
  );
  if (!phaseProjection) throw new RangeError("Replay lifecycle phase is missing.");
  const phase = phaseDefinition(snapshot);
  const evaluations = phaseProjection.ruleEvaluations;
  const dailyLoss = evaluations.find(
    (item): item is LossRuleEvaluation =>
      item.kind === "loss" && item.window === "daily",
  ) ?? evaluateLossRule(rule(phase, "loss"), snapshot.account, undefined);
  const maximumRule = phase.rules.find(
    (item): item is Extract<ChallengeRule, { kind: "loss" }> =>
      item.kind === "loss" && item.window === "phase",
  );
  if (!maximumRule) throw new RangeError("Phase lacks maximum-loss rule.");
  const maximumLoss = evaluations.find(
    (item): item is LossRuleEvaluation =>
      item.kind === "loss" && item.window === "phase",
  ) ?? evaluateLossRule(maximumRule, snapshot.account, undefined);
  const profitTarget = evaluation(evaluations, "profitTarget") ??
    evaluateProfitTargetRule(rule(phase, "profitTarget"), snapshot.account);
  const inactivity = evaluation(evaluations, "inactivity") ??
    evaluateInactivityRule(
      rule(phase, "inactivity"),
      phaseProjection.lastQualifyingActivityAt ?? snapshot.account.phaseStartedAt,
      snapshot.logicalTime,
    );
  return { dailyLoss, maximumLoss, profitTarget, inactivity };
}

export function buildChallengeReplayReadModel(
  snapshot: Omit<ChallengeReplaySnapshot, "readModel">,
): ChallengeReplayReadModel {
  const phaseProjection = snapshot.lifecycle.phases.find(
    (candidate) => candidate.phaseId === snapshot.account.phaseId,
  );
  if (!phaseProjection) throw new RangeError("Replay lifecycle phase is missing.");
  const required = requiredEvaluations(snapshot);
  const activeDays = evaluation(
    phaseProjection.ruleEvaluations,
    "activeDays",
  ) as ActiveDaysRuleEvaluation | undefined;
  const profitableDays = evaluation(
    phaseProjection.ruleEvaluations,
    "profitableDays",
  ) as ProfitableDaysRuleEvaluation | undefined;
  const phase = phaseDefinition(snapshot);
  const activeRule = rule(phase, "activeDays");
  const profitableRule = rule(phase, "profitableDays");
  const profitableThreshold = profitableDays?.threshold ??
    evaluateProfitableDaysRule(
      profitableRule,
      phaseProjection.profitableDayIds,
      snapshot.account.phaseStartingCash,
    ).threshold;
  const currentDayActive = phaseProjection.activeDayIds.includes(
    snapshot.account.day.currentDayId,
  );
  const position = snapshot.account.position;
  const lastCheckpoint = snapshot.account.lastStableCheckpoint;

  return deepFreeze({
    identity: {
      challengeId: snapshot.lifecycle.challengeId,
      challengeType: snapshot.definition.template.challengeType,
      currentPhaseId: snapshot.account.phaseId,
      mode: "replay",
      status: snapshot.lifecycle.status,
      health: phaseProjection.health,
    },
    account: {
      startingCash: snapshot.account.phaseStartingCash,
      cash: snapshot.account.cashBalance,
      equity: snapshot.account.equity,
      realizedGrossPnl: snapshot.account.realizedGrossPnl,
      commissions: snapshot.account.totalCommissions,
      unrealizedPnl: snapshot.account.unrealizedPnl,
      usedMargin: snapshot.account.usedMargin,
      reservedMargin: snapshot.account.reservedMargin,
      freeMargin: snapshot.account.freeMargin,
    },
    progress: {
      profitTarget: required.profitTarget.targetAmount,
      phaseNetPnl: subtractMoney(
        snapshot.account.cashBalance,
        snapshot.account.phaseStartingCash,
      ),
      requiredCash: required.profitTarget.requiredCash,
      targetProgress: required.profitTarget.progress,
      targetRemaining: required.profitTarget.remaining,
      targetReached: required.profitTarget.reached,
      activeDaysCompleted: activeDays?.completed ?? phaseProjection.activeDayIds.length,
      activeDaysRequired: activeDays?.required ?? activeRule.required,
      profitableDaysCompleted:
        profitableDays?.completed ?? phaseProjection.profitableDayIds.length,
      profitableDaysRequired: profitableDays?.required ?? profitableRule.required,
      currentDay: {
        dayId: snapshot.account.day.currentDayId,
        settledNetPnl: snapshot.account.day.daySettledNetPnl,
        profitableThreshold,
        active: currentDayActive,
        thresholdMet:
          currentDayActive &&
          snapshot.account.day.daySettledNetPnl >= profitableThreshold,
        finalized: false,
      },
    },
    risk: {
      dailyLoss: required.dailyLoss,
      maximumLoss: required.maximumLoss,
      inactivity: required.inactivity as InactivityRuleEvaluation,
    },
    position: position ? {
      positionId: position.positionId,
      lifecycleId: position.lifecycleId,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      currentMark: position.currentMark,
      leverage: position.leverage,
      unrealizedPnl: position.unrealizedPnl,
      grossExposure: position.grossExposure,
      protection: { ...position.protection },
    } : null,
    workingOrders: snapshot.execution.workingOrders.map((order) => ({
      orderId: order.orderId,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      triggerPrice: order.triggerPrice,
      expectedFillPrice: order.expectedFillPrice,
      ocoGroupId: order.ocoGroupId,
    })),
    replay: {
      cursor: snapshot.cursor,
      logicalTime: snapshot.logicalTime,
      datasetId: snapshot.dataset.datasetId,
      datasetHash: snapshot.dataset.datasetHash,
      executionTimeframe: snapshot.dataset.executionTimeframe,
      replaySessionId: snapshot.account.scope.mode === "replay"
        ? snapshot.account.scope.replaySessionId
        : (() => { throw new RangeError("Replay scope required."); })(),
      branchId: snapshot.account.scope.mode === "replay"
        ? snapshot.account.scope.branchId
        : (() => { throw new RangeError("Replay scope required."); })(),
      generation: snapshot.account.generation,
      availability: snapshot.availability as ChallengeReplayAvailability,
    },
    lifecycle: {
      phaseStatus: phaseProjection.status,
      challengeStatus: snapshot.lifecycle.status,
      nextPhaseEligible: snapshot.pendingPhaseTransition,
      terminalBreachEvidence: snapshot.lifecycle.status === "FAILED"
        ? phaseProjection.primaryBreach
        : null,
    },
    consistency: {
      coordinatorRevision: snapshot.coordinatorRevision,
      executionFactSequence: snapshot.execution.nextFactSequence - 1,
      accountRevision: snapshot.account.revision,
      stableCheckpointSequence: snapshot.account.stableCheckpointSequence,
      stableCheckpointId: lastCheckpoint?.checkpointId ?? "",
      lifecycleCheckpointId: phaseProjection.lastCheckpointId ?? "",
    },
  });
}



