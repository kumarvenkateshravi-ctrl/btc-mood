import { deepFreeze } from '../domain/versions';
import { btcQuantityFromDecimal, formatScaledDecimal, moneyFromAtoms, moneyFromDecimal } from '../domain/money';
import { utcDayIdAt } from '../domain/calendar';
import type { Money } from '../domain/types';
import type { ChallengeReplayEvidenceCycle } from '../replay/coordinator';
import type { ChallengeReplaySnapshot } from '../replay/types';
import type { FillFact, CommissionFact, ProtectionChangedFact } from '../execution/types';
import type { RuleEvaluation, PhaseLifecycleProjection } from '../rules/types';
import type { PersistedAttempt, PersistedBranch, PersistedCommit } from '../persistence/types';
import { CHALLENGE_REPORT_VERSION, type ChallengeReportReadModel, type ChallengeReportTrade, type ChallengeReportDay, type ChallengeReportRiskEvent } from './types';

const zero = moneyFromAtoms(BigInt(0));
const add = (...values: readonly bigint[]) => moneyFromAtoms(values.reduce((sum, value) => sum + value, BigInt(0)));
function rule<T extends RuleEvaluation['kind']>(phase: PhaseLifecycleProjection | undefined, kind: T, window?: 'daily' | 'phase') {
  return phase?.ruleEvaluations.find(item => item.kind === kind && (!window || (item.kind === 'loss' && item.window === window))) as Extract<RuleEvaluation, { kind: T }> | undefined;
}
function phaseAt(cycle: ChallengeReplayEvidenceCycle, phaseId = cycle.phaseId) {
  return cycle.lifecycle.phases.find(item => String(item.phaseId) === phaseId);
}

function buildTrades(cycles: readonly ChallengeReplayEvidenceCycle[], logicalTime: number): ChallengeReportTrade[] {
  const allFacts = cycles.flatMap(cycle => cycle.facts);
  const fills = allFacts.filter((fact): fact is FillFact => fact.kind === 'FillCommitted');
  const commissions = allFacts.filter((fact): fact is CommissionFact => fact.kind === 'CommissionAssessed');
  const protection = allFacts.filter((fact): fact is ProtectionChangedFact => fact.kind === 'ProtectionChanged');
  const related = new Map<string, string[]>();
  for (const cycle of cycles) {
    const cycleFills = cycle.facts.filter((fact): fact is FillFact => fact.kind === 'FillCommitted');
    if (cycleFills.some(item => item.fill.classification === 'exit') && cycleFills.some(item => item.fill.classification === 'entry')) {
      const ids = [...new Set(cycleFills.map(item => String(item.fill.lifecycleId)))];
      for (const id of ids) related.set(id, ids.filter(other => other !== id));
    }
  }
  const groups = new Map<string, FillFact[]>();
  for (const fill of fills) {
    const key = String(fill.fill.lifecycleId);
    const group = groups.get(key) ?? [];
    group.push(fill); groups.set(key, group);
  }
  return [...groups.entries()].map(([lifecycleId, group]): ChallengeReportTrade => {
    const entries = group.filter(item => item.fill.classification !== 'exit');
    const exits = group.filter(item => item.fill.classification === 'exit');
    const first = entries[0] ?? group[0];
    const lastExit = exits.at(-1) ?? null;
    const entryAtoms = entries.reduce((sum, item) => sum + btcQuantityFromDecimal(item.fill.quantity), BigInt(0));
    const closeAtoms = exits.reduce((sum, item) => sum + btcQuantityFromDecimal(item.fill.quantity), BigInt(0));
    const closed = closeAtoms === entryAtoms && entryAtoms > BigInt(0);
    const ids = new Set(group.map(item => String(item.fill.fillId)));
    const fees = commissions.filter(item => ids.has(String(item.fillId)));
    const entryFees = add(...fees.filter(item => item.classification === 'entry').map(item => item.amount));
    const exitFees = add(...fees.filter(item => item.classification === 'exit').map(item => item.amount));
    const grossPnl = add(...exits.map(item => item.fill.grossRealizedPnl));
    const protectionEvents = protection.filter(item => String(item.positionId) === String(first.fill.positionId));
    let running = BigInt(0);
    let partialClose = false;
    for (const item of group) {
      running += btcQuantityFromDecimal(item.fill.quantity) * (item.fill.classification === 'exit' ? -BigInt(1) : BigInt(1));
      if (item.fill.classification === 'exit' && running > BigInt(0)) partialClose = true;
    }
    return {
      lifecycleId, positionId: String(first.fill.positionId), phaseId: String(first.scope.phaseId),
      side: first.fill.side === 'buy' ? 'long' : 'short', status: closed ? 'CLOSED' : 'OPEN',
      entryAt: Number(first.occurredAt), exitAt: closed && lastExit ? Number(lastExit.occurredAt) : null,
      entryPrice: String(first.fill.price), exitPrice: closed ? String(lastExit?.fill.price ?? '') : null,
      entryQuantity: formatScaledDecimal(entryAtoms, 8), closedQuantity: formatScaledDecimal(closeAtoms, 8),
      grossPnl, entryFees, exitFees, netPnl: add(grossPnl, -entryFees, -exitFees),
      durationMs: Math.max(0, (closed && lastExit ? Number(lastExit.occurredAt) : logicalTime) - Number(first.occurredAt)),
      exitReason: closed ? lastExit?.fill.reason ?? null : null, protection: protectionEvents.at(-1)?.after ?? null,
      partialClose, reversal: related.has(lifecycleId), relatedLifecycleIds: related.get(lifecycleId) ?? [],
      fillIds: group.map(item => String(item.fill.fillId)),
      fills: group.map(item => ({ fillId: String(item.fill.fillId), occurredAt: Number(item.occurredAt), classification: item.fill.classification, price: String(item.fill.price), quantity: String(item.fill.quantity), reason: item.fill.reason, grossPnl: item.fill.grossRealizedPnl, commission: add(...fees.filter(fee => fee.fillId === item.fill.fillId).map(fee => fee.amount)) })),
      protectionHistory: protectionEvents.map(item => ({ occurredAt: Number(item.occurredAt), before: item.before, after: item.after, source: item.source })),
    };
  }).sort((left, right) => left.entryAt - right.entryAt || left.lifecycleId.localeCompare(right.lifecycleId));
}

function buildDays(cycles: readonly ChallengeReplayEvidenceCycle[], phaseIds: readonly string[]): ChallengeReportDay[] {
  const rows: ChallengeReportDay[] = [];
  for (const phaseId of phaseIds) {
    const phaseCycles = cycles.filter(cycle => cycle.phaseId === phaseId);
    const latest = phaseCycles.at(-1);
    if (!latest) continue;
    const account = latest.account;
    const phase = phaseAt(latest);
    const threshold = rule(phase, 'profitableDays')?.threshold ?? zero;
    const stats = (dayId: string, startingEquity: Money) => {
      const observed = phaseCycles.filter(cycle => String(utcDayIdAt(cycle.account.lastOccurredAt)) === dayId);
      const daily = observed.map(cycle => rule(phaseAt(cycle), 'loss', 'daily')).filter(item => item !== undefined);
      return { lowestEquity: observed.reduce((low, cycle) => cycle.account.equity < low ? cycle.account.equity : low, startingEquity), dailyFloor: daily.at(-1)?.floor ?? zero, maximumDailyLossUsage: daily.reduce((high, item) => item.consumedAmount > high ? item.consumedAmount : high, zero) };
    };
    for (const day of account.closedDays) rows.push({
      phaseId, dayId: String(day.dayId), state: 'FINALIZED', active: phase?.activeDayIds.includes(day.dayId) ?? false,
      grossPnl: day.realizedGrossPnl, fees: day.commissions, settledNetPnl: day.settledNetPnl,
      profitableThreshold: threshold, qualified: phase?.profitableDayIds.includes(day.dayId) ?? false,
      startingCash: day.startCash, ...stats(String(day.dayId), day.startEquity), endingCash: day.endingCash,
      endingEquity: day.endingEquity, finalizedAt: Number(day.closedAt),
    });
    const day = account.day;
    rows.push({ phaseId, dayId: String(day.currentDayId), state: 'IN_PROGRESS', active: phase?.activeDayIds.includes(day.currentDayId) ?? false,
      grossPnl: day.dayRealizedGrossPnl, fees: day.dayCommissions, settledNetPnl: day.daySettledNetPnl,
      profitableThreshold: threshold, qualified: false, startingCash: day.dayStartCash,
      ...stats(String(day.currentDayId), day.dayStartEquity), endingCash: account.cashBalance, endingEquity: account.equity, finalizedAt: null });
  }
  return rows.sort((left, right) => left.dayId.localeCompare(right.dayId) || left.phaseId.localeCompare(right.phaseId));
}

function buildRisk(cycles: readonly ChallengeReplayEvidenceCycle[], decisions: ChallengeReplaySnapshot['lifecycle']['decisions']): ChallengeReportRiskEvent[] {
  const accepted = new Set(['RuleStatusChanged', 'WarningRaised', 'DangerRaised', 'WarningRearmed', 'BreachRecorded']);
  const result: ChallengeReportRiskEvent[] = [];
  for (const decision of decisions) {
    if (!accepted.has(decision.kind)) continue;
    const cycle = cycles.find(item => item.account.lastStableCheckpoint?.checkpointId === decision.checkpointId) ?? cycles.find(item => Number(item.occurredAt) === Number(decision.occurredAt) && item.phaseId === String(decision.phaseId) && item.decisions.some(candidate => candidate.kind === decision.kind && candidate.ruleId === decision.ruleId));
    if (!cycle) continue;
    const item = phaseAt(cycle, String(decision.phaseId))?.ruleEvaluations.find(item => item.ruleId === decision.ruleId);
    if (item?.kind !== 'loss' && item?.kind !== 'inactivity') continue;
    const metric = item.kind === 'loss' ? { observed: item.observed, floor: item.floor, headroom: item.headroom } : { observed: item.evaluatedAt, floor: item.deadline, headroom: item.remainingDurationMs };
    const status = decision.kind === 'WarningRearmed' ? 'SAFE' : decision.kind === 'WarningRaised' ? 'WARNING' : decision.kind === 'DangerRaised' ? 'DANGER' : decision.kind === 'BreachRecorded' ? 'BREACHED' : decision.status ?? 'SAFE';
    result.push({ decisionId: String(decision.decisionId), sequence: decision.decisionSequence, phaseId: String(decision.phaseId), ruleId: decision.ruleId ?? null, kind: decision.kind, status, occurredAt: Number(decision.occurredAt), checkpointId: String(decision.checkpointId), ...metric });
  }
  return result.sort((a, b) => a.sequence - b.sequence);
}

export function buildChallengeReport(input: {
  snapshot: ChallengeReplaySnapshot; cycles: readonly ChallengeReplayEvidenceCycle[];
  attempt: PersistedAttempt; branch: PersistedBranch; commit: PersistedCommit;
  generatedAt?: number;
}): ChallengeReportReadModel {
  const { snapshot, cycles, attempt, branch, commit } = input;
  const specs = [...snapshot.definition.template.phases].sort((a, b) => a.sequence - b.sequence);
  const trades = buildTrades(cycles, Number(snapshot.logicalTime));
  const phases = specs.map(spec => {
    const phaseId = String(spec.id);
    const phaseCycles = cycles.filter(cycle => cycle.phaseId === phaseId);
    const account = phaseCycles.at(-1)?.account;
    const projection = snapshot.lifecycle.phases.find(item => String(item.phaseId) === phaseId)!;
    const target = rule(projection, 'profitTarget');
    const active = rule(projection, 'activeDays');
    const profitable = rule(projection, 'profitableDays');
    const startingCash = account?.phaseStartingCash ?? moneyFromDecimal(snapshot.definition.selectedCapital);
    const cash = account?.cashBalance ?? null;
    const fees = account?.totalCommissions ?? zero;
    const gross = account?.realizedGrossPnl ?? zero;
    const terminal = projection.status === 'PASSED' || projection.status === 'FAILED';
    const terminalDecision = snapshot.lifecycle.decisions.find(item => String(item.phaseId) === phaseId && (item.kind === 'PhasePassed' || item.kind === 'PhaseFailed'));
    const terminalCycle = terminalDecision ? phaseCycles.find(cycle => cycle.account.lastStableCheckpoint?.checkpointId === terminalDecision.checkpointId) ?? phaseCycles.find(cycle => Number(cycle.occurredAt) === Number(terminalDecision.occurredAt) && cycle.decisions.some(decision => decision.kind === terminalDecision.kind)) : undefined;
    return { phaseId, sequence: spec.sequence, name: spec.name, status: projection.status,
      startedAt: projection.phaseStartedAt === null ? null : Number(projection.phaseStartedAt),
      endedAt: terminal ? Number(terminalDecision?.occurredAt ?? phaseCycles.at(-1)?.occurredAt ?? snapshot.logicalTime) : null,
      startCursor: phaseCycles[0]?.cursor ?? null, endCursor: terminalCycle?.cursor ?? phaseCycles.at(-1)?.cursor ?? null,
      startingCash, endingCash: cash, endingEquity: account?.equity ?? null, grossPnl: gross, fees,
      netPnl: add(gross, -fees), targetAmount: target?.targetAmount ?? null, targetReached: projection.targetReached,
      activeDays: [active?.completed ?? 0, active?.required ?? spec.rules.find(item => item.kind === 'activeDays')?.required ?? 0] as const,
      profitableDays: [profitable?.completed ?? 0, profitable?.required ?? spec.rules.find(item => item.kind === 'profitableDays')?.required ?? 0] as const,
      completedLifecycles: trades.filter(item => item.phaseId === phaseId && item.status === 'CLOSED').length,
      failure: projection.primaryBreach,
    };
  });
  const current = phases.find(item => item.phaseId === String(snapshot.lifecycle.currentPhaseId)) ?? phases[0];
  const riskTimeline = buildRisk(cycles, snapshot.lifecycle.decisions);
  const primary = snapshot.lifecycle.phases.find(item => item.primaryBreach)?.primaryBreach ?? null;
  const failureAnalysis = primary ? (() => {
    const breachIndex = cycles.findIndex(cycle => cycle.account.lastStableCheckpoint?.checkpointId === primary.checkpointId);
    const breachCycle = cycles[breachIndex] ?? [...cycles].reverse().find(cycle => cycle.phaseId === String(primary.phaseId) && Number(cycle.occurredAt) === Number(primary.occurredAt));
    const resolvedBreachIndex = breachCycle ? cycles.indexOf(breachCycle) : cycles.length;
    const previousCycle = cycles.slice(0, resolvedBreachIndex).filter(cycle => cycle.phaseId === String(primary.phaseId)).at(-1);
    const previousRule = previousCycle ? phaseAt(previousCycle)?.ruleEvaluations.find(item => item.ruleId === primary.ruleId) : undefined;
    const priorHeadroom = previousRule?.kind === 'loss' ? previousRule.headroom : previousRule?.kind === 'inactivity' ? previousRule.remainingDurationMs : null;
    const beforeDecision = snapshot.lifecycle.decisions.find(item => item.evidence?.evidenceId === primary.evidenceId)?.decisionSequence ?? Infinity;
    const warning = riskTimeline.filter(item => item.ruleId === primary.ruleId && item.sequence < beforeDecision && item.kind === 'WarningRaised').at(-1);
    const danger = riskTimeline.filter(item => item.ruleId === primary.ruleId && item.sequence < beforeDecision && item.kind === 'DangerRaised').at(-1);
    const position = breachCycle?.facts.find(item => item.kind === 'PositionTransitioned' && item.value.positionBefore);
    const relevantLifecycleId = primary.ruleKind === 'inactivity' ? null : String(breachCycle?.account.position?.lifecycleId ?? (position?.kind === 'PositionTransitioned' ? position.value.positionBefore?.lifecycleId : '') ?? '') || null;
    return { primaryBreach: primary, precedingRisk: [warning, danger].filter(item => item !== undefined), priorHeadroom, relevantLifecycleId,
      checkpoint: { checkpointId: String(primary.checkpointId), accountRevision: primary.accountRevision, definitionHash: primary.definitionHash, supportingFactIds: primary.supportingFactIds.map(String) } };
  })() : null;
  const summary = { challengeId: String(snapshot.readModel.identity.challengeId), challengeType: snapshot.readModel.identity.challengeType,
    symbol: 'BTCUSDT' as const, mode: 'replay' as const, currentPhaseId: String(snapshot.lifecycle.currentPhaseId),
    status: snapshot.lifecycle.status, health: snapshot.readModel.identity.health, startingCash: phases[0].startingCash,
    currentCash: snapshot.account.cashBalance, currentEquity: snapshot.account.equity,
    grossPnl: add(...phases.map(item => item.grossPnl)), fees: add(...phases.map(item => item.fees)), netPnl: add(...phases.map(item => item.netPnl)),
    targetAmount: current.targetAmount ?? zero, targetProgress: snapshot.readModel.progress.targetProgress,
    activeDays: current.activeDays, profitableDays: current.profitableDays,
    replayStartedAt: Number(cycles[0]?.occurredAt ?? snapshot.logicalTime), replayEndedAt: Number(snapshot.logicalTime), timeframe: snapshot.dataset.executionTimeframe };
  const passAnalysis = snapshot.lifecycle.status === 'PASSED' ? {
    finalCash: snapshot.account.cashBalance, targetAmount: current.targetAmount ?? zero, excess: add(current.netPnl, -(current.targetAmount ?? zero)),
    activeDays: current.activeDays[0], profitableDays: current.profitableDays[0], totalFees: summary.fees,
    completedLifecycles: trades.filter(item => item.status === 'CLOSED').length,
    phaseTimeline: phases.map(item => ({ phaseId: item.phaseId, startedAt: item.startedAt, endedAt: item.endedAt })) } : null;
  return deepFreeze({ summary, phases, trades, days: buildDays(cycles, specs.map(item => String(item.id))), riskTimeline,
    decisionTimeline: snapshot.lifecycle.decisions.map(item => ({ decisionId: String(item.decisionId), sequence: item.decisionSequence,
      phaseId: String(item.phaseId), kind: item.kind, occurredAt: Number(item.occurredAt), checkpointId: String(item.checkpointId),
      accountRevision: item.accountRevision, ruleId: item.ruleId ?? null, status: item.status ?? null,
      primaryBreachEvidenceId: item.primaryBreachEvidenceId ?? null })).sort((a, b) => a.sequence - b.sequence),
    failureAnalysis, passAnalysis,
    branch: { branchId: branch.branchId, generation: branch.generation, active: branch.active, parentBranchId: branch.parentBranchId,
      forkCursor: branch.forkCursor, createdAt: branch.createdAt, creationReason: branch.creationReason },
    provenance: { reportVersion: CHALLENGE_REPORT_VERSION, definitionHash: snapshot.definition.definitionHash,
      datasetId: snapshot.dataset.datasetId, datasetHash: snapshot.dataset.datasetHash, branchId: branch.branchId, generation: branch.generation,
      attemptRevision: attempt.revision, commitKey: commit.commitKey, checkpointId: String(snapshot.account.lastStableCheckpoint?.checkpointId ?? ''),
      ledgerHash: snapshot.account.ledgerHash, stateWitnessHash: commit.stateWitnessHash, generatedAt: input.generatedAt ?? 0, versions: { ...attempt.versions }, source: 'frozen-definition+journal' as const } });
}
