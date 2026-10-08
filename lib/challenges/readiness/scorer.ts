import { roundDivideHalfEven } from '../domain/money';
import { canonicalHash, deepFreeze } from '../domain/versions';
import type { ChallengeReportDay, ChallengeReportPhase, ChallengeReportReadModel, ChallengeReportRiskEvent, ChallengeReportTrade } from '../report';
import { CHALLENGE_READINESS_CONFIG_V1, CHALLENGE_READINESS_CONFIG_V1_HASH, type ChallengeReadinessConfigV1 } from './config';
import { CHALLENGE_READINESS_VERSION, type ChallengeReadinessReadModel, type ChallengeReadinessScopeResult, type ReadinessComponent, type ReadinessComponentKey, type ReadinessEvidenceCounts, type ReadinessEvidenceItem, type ReadinessFactor, type ReadinessFinality, type ReadinessGrade, type ReadinessVersion } from './types';

const BI_ZERO = BigInt(0);
const BI_100 = BigInt(100);
const BI_10K = BigInt(10_000);
const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const halfEven = (numerator: bigint, denominator: bigint) => Number(roundDivideHalfEven(numerator, denominator));
const ratioBp = (numerator: bigint, denominator: bigint) => denominator <= BI_ZERO ? 0 : clamp(halfEven(numerator * BI_10K, denominator), 0, 10_000);
const pointsForBp = (points: number, basisPoints: number) => halfEven(BigInt(points) * BigInt(clamp(basisPoints, 0, 10_000)), BI_10K);
const contribution = (score: number, weight: number) => Number((score * weight / 100).toFixed(2));
const factor = (code: string, label: string): ReadinessFactor => ({ code, label });
const evidence = (code: string, label: string, value: number | string, unit: ReadinessEvidenceItem['unit']): ReadinessEvidenceItem => ({ code, label, value, unit });
const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, BI_ZERO);
const absolute = (value: bigint) => value < BI_ZERO ? -value : value;

export class UnsupportedReadinessVersionError extends RangeError {
  readonly code = 'UNSUPPORTED_READINESS_VERSION';
  constructor(version: string) { super(`Unsupported readiness version "${version}". Expected "${CHALLENGE_READINESS_VERSION}".`); }
}

interface ScopeEvidence {
  phaseId: string | null;
  phaseStatus: string;
  phases: readonly ChallengeReportPhase[];
  trades: readonly ChallengeReportTrade[];
  days: readonly ChallengeReportDay[];
  risk: readonly ChallengeReportRiskEvent[];
  terminal: boolean;
}

export function gradeReadinessScore(score: number, version: ReadinessVersion | string = CHALLENGE_READINESS_VERSION): ReadinessGrade {
  if (version !== CHALLENGE_READINESS_VERSION) throw new UnsupportedReadinessVersionError(version);
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError('Readiness score must be an integer from 0 through 100.');
  return CHALLENGE_READINESS_CONFIG_V1.grades.find(band => score >= band.minimum)!.grade;
}

function statusIsTerminal(status: string): boolean { return ['PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(status); }
function activeFinalDays(scope: ScopeEvidence) { return scope.days.filter(day => day.state === 'FINALIZED' && day.active); }
function closedTrades(scope: ScopeEvidence) { return scope.trades.filter(trade => trade.status === 'CLOSED'); }
function canonicalEvents(scope: ScopeEvidence, kind: string) { return scope.risk.filter(item => item.kind === kind); }
function reversalTransitions(trades: readonly ChallengeReportTrade[]): number {
  const pairs = new Set<string>();
  for (const trade of trades.filter(item => item.reversal)) for (const related of trade.relatedLifecycleIds) pairs.add([trade.lifecycleId, related].sort().join('|'));
  return pairs.size;
}
function partialExitOverage(trades: readonly ChallengeReportTrade[], free: number): number {
  return trades.reduce((total, trade) => total + Math.max(0, trade.fills.filter(fill => fill.classification === 'exit').length - free), 0);
}
function countsFor(scope: ScopeEvidence, config: ChallengeReadinessConfigV1): ReadinessEvidenceCounts {
  const completed = closedTrades(scope); const finalDays = scope.days.filter(day => day.state === 'FINALIZED'); const active = activeFinalDays(scope);
  const breaches = canonicalEvents(scope, 'BreachRecorded');
  return { completedLifecycles: completed.length, finalizedActiveDays: active.length, finalizedDays: finalDays.length,
    riskObservations: active.filter(day => day.startingCash > day.dailyFloor).length,
    warningEvents: canonicalEvents(scope, 'WarningRaised').length, dangerEvents: canonicalEvents(scope, 'DangerRaised').length,
    breachEvents: breaches.length, inactivityBreaches: breaches.filter(item => item.ruleId?.includes('inactivity')).length,
    reversalTransitions: reversalTransitions(completed), partialExitOverage: partialExitOverage(completed, config.execution.freeExitFillsPerLifecycle) };
}

function eligibilityFor(counts: ReadinessEvidenceCounts, terminal: boolean, config: ChallengeReadinessConfigV1) {
  const gaps: ReadinessFactor[] = [];
  if (counts.completedLifecycles < config.eligibility.minimumCompletedLifecycles) gaps.push(factor('minimum-trades', `${config.eligibility.minimumCompletedLifecycles - counts.completedLifecycles} more completed lifecycle(s) required`));
  if (counts.finalizedActiveDays < config.eligibility.minimumFinalizedActiveDays) gaps.push(factor('minimum-days', `${config.eligibility.minimumFinalizedActiveDays - counts.finalizedActiveDays} more finalized active day(s) required`));
  if (counts.riskObservations < config.eligibility.minimumRiskObservations) gaps.push(factor('minimum-risk-observations', `${config.eligibility.minimumRiskObservations - counts.riskObservations} more finalized daily-risk observation(s) required`));
  const eligible = gaps.length === 0;
  return { status: eligible ? terminal ? 'COMPLETE' as const : 'SCORABLE' as const : 'INSUFFICIENT_DATA' as const, eligible,
    minimumCompletedLifecycles: config.eligibility.minimumCompletedLifecycles, minimumFinalizedActiveDays: config.eligibility.minimumFinalizedActiveDays,
    minimumRiskObservations: config.eligibility.minimumRiskObservations, gaps };
}

function component(key: ReadinessComponentKey, label: string, score: number, weight: number, evidenceItems: ReadinessEvidenceItem[], positiveFactors: ReadinessFactor[], negativeFactors: ReadinessFactor[]): ReadinessComponent {
  const bounded = clamp(score);
  return { key, label, score: bounded, weight, weightedContribution: contribution(bounded, weight), status: 'SCORED', evidence: evidenceItems, positiveFactors, negativeFactors, insufficientData: [] };
}
function insufficientComponent(key: ReadinessComponentKey, label: string, weight: number, gaps: readonly ReadinessFactor[]): ReadinessComponent {
  return { key, label, score: null, weight, weightedContribution: null, status: 'INSUFFICIENT_DATA', evidence: [], positiveFactors: [], negativeFactors: [], insufficientData: gaps };
}

function riskScore(scope: ScopeEvidence, counts: ReadinessEvidenceCounts, config: ChallengeReadinessConfigV1): ReadinessComponent {
  const days = activeFinalDays(scope);
  const dailyBp = days.map(day => ratioBp(day.maximumDailyLossUsage, day.startingCash - day.dailyFloor));
  const overallBp: number[] = [];
  for (const item of scope.risk) {
    if (!item.ruleId?.includes('maximum-loss') || typeof item.observed !== 'bigint' || typeof item.floor !== 'bigint') continue;
    const phase = scope.phases.find(candidate => candidate.phaseId === item.phaseId);
    if (phase) overallBp.push(ratioBp(phase.startingCash - item.observed, phase.startingCash - item.floor));
  }
  const peak = Math.max(0, ...dailyBp, ...overallBp);
  const average = dailyBp.length ? halfEven(dailyBp.reduce((total, item) => total + BigInt(item), BI_ZERO), BigInt(dailyBp.length)) : 0;
  const lossWarnings = scope.risk.filter(item => item.kind === 'WarningRaised' && (item.ruleId?.includes('daily-loss') || item.ruleId?.includes('maximum-loss'))).length;
  const lossDangers = scope.risk.filter(item => item.kind === 'DangerRaised' && (item.ruleId?.includes('daily-loss') || item.ruleId?.includes('maximum-loss'))).length;
  const lossBreaches = scope.risk.filter(item => item.kind === 'BreachRecorded' && (item.ruleId?.includes('daily-loss') || item.ruleId?.includes('maximum-loss'))).length;
  const peakPenalty = pointsForBp(config.risk.peakCapacityPoints, peak);
  const averagePenalty = pointsForBp(config.risk.averageDailyPoints, average);
  const warningPenalty = Math.min(config.risk.warningCap, lossWarnings * config.risk.warningPenalty);
  const dangerPenalty = Math.min(config.risk.dangerCap, lossDangers * config.risk.dangerPenalty);
  const breachPenalty = Math.min(config.risk.lossBreachCap, lossBreaches * config.risk.lossBreachPenalty);
  const positives = [peak <= 5000 ? factor('healthy-risk-headroom', 'Peak observed loss use stayed at or below 50% of capacity') : null, lossBreaches === 0 ? factor('no-loss-breach', 'No daily or maximum-loss breach was recorded') : null].filter(Boolean) as ReadinessFactor[];
  const negatives = [peak > 8000 ? factor('near-loss-limit', 'Peak observed loss use exceeded 80% of capacity') : null, lossWarnings ? factor('risk-warnings', `${lossWarnings} canonical loss warning event(s) recorded`) : null, lossDangers ? factor('risk-danger', `${lossDangers} canonical loss danger event(s) recorded`) : null, lossBreaches ? factor('loss-breach', `${lossBreaches} loss-limit breach event(s) recorded`) : null].filter(Boolean) as ReadinessFactor[];
  return component('riskDiscipline', 'Risk Discipline', 100 - peakPenalty - averagePenalty - warningPenalty - dangerPenalty - breachPenalty, config.weights.riskDiscipline,
    [evidence('peak-loss-use', 'Peak observed loss-capacity use', peak, 'basisPoints'), evidence('average-daily-loss-use', 'Average daily loss-capacity use', average, 'basisPoints'), evidence('warnings', 'Loss warnings', lossWarnings, 'count'), evidence('danger', 'Loss danger events', lossDangers, 'count'), evidence('loss-breaches', 'Loss-limit breaches', lossBreaches, 'count')], positives, negatives);
}

function consistencyScore(scope: ScopeEvidence, config: ChallengeReadinessConfigV1): ReadinessComponent {
  const days = activeFinalDays(scope);
  const returns = days.map(day => halfEven(day.settledNetPnl * BI_10K, day.startingCash));
  const positives = returns.filter(value => value > 0).length;
  const positiveShare = halfEven(BigInt(positives) * BI_10K, BigInt(returns.length));
  const mean = halfEven(returns.reduce((total, value) => total + BigInt(value), BI_ZERO), BigInt(returns.length));
  const dispersion = halfEven(returns.reduce((total, value) => total + BigInt(Math.abs(value - mean)), BI_ZERO), BigInt(returns.length));
  const positiveAmounts = days.map(day => day.settledNetPnl > BI_ZERO ? day.settledNetPnl : BI_ZERO); const positiveTotal = sum(positiveAmounts);
  const concentration = positiveTotal > BI_ZERO ? ratioBp(positiveAmounts.reduce((high, value) => value > high ? value : high, BI_ZERO), positiveTotal) : 10_000;
  const sharePoints = pointsForBp(config.consistency.positiveSharePoints, positiveShare);
  const stabilityPoints = config.consistency.stabilityPoints - pointsForBp(config.consistency.stabilityPoints, clamp(halfEven(BigInt(dispersion) * BI_10K, BigInt(config.consistency.fullDispersionBasisPoints)), 0, 10_000));
  const concentrationExcess = clamp(halfEven(BigInt(Math.max(0, concentration - config.consistency.concentrationFreeBasisPoints)) * BI_10K, BigInt(10_000 - config.consistency.concentrationFreeBasisPoints)), 0, 10_000);
  const concentrationPoints = config.consistency.concentrationPoints - pointsForBp(config.consistency.concentrationPoints, concentrationExcess);
  const good: ReadinessFactor[] = []; const bad: ReadinessFactor[] = [];
  if (positiveShare >= 7500) good.push(factor('mostly-positive-days', 'At least three quarters of finalized active days were positive'));
  if (dispersion <= 50) good.push(factor('stable-daily-results', 'Daily net-return dispersion stayed at or below 0.50%'));
  if (concentration > 7500) bad.push(factor('profit-concentration', 'More than 75% of positive day P&L came from one day'));
  if (dispersion >= 150) bad.push(factor('high-daily-variance', 'Daily net-return dispersion reached at least 1.50%'));
  if (positiveShare < 5000) bad.push(factor('more-nonpositive-days', 'Fewer than half of finalized active days were positive'));
  return component('consistency', 'Consistency', sharePoints + stabilityPoints + concentrationPoints, config.weights.consistency,
    [evidence('positive-day-share', 'Positive finalized active days', positiveShare, 'basisPoints'), evidence('return-dispersion', 'Mean absolute daily return dispersion', dispersion, 'basisPoints'), evidence('positive-pnl-concentration', 'Largest positive-day concentration', concentration, 'basisPoints')], good, bad);
}

function profitabilityScore(scope: ScopeEvidence, config: ChallengeReadinessConfigV1): ReadinessComponent {
  const trades = closedTrades(scope); const gross = sum(trades.map(item => item.grossPnl)); const fees = sum(trades.map(item => item.entryFees + item.exitFees)); const net = sum(trades.map(item => item.netPnl));
  const capital = sum(scope.phases.filter(phase => trades.some(trade => trade.phaseId === phase.phaseId)).map(phase => phase.startingCash));
  const netBp = capital > BI_ZERO ? halfEven(net * BI_10K, capital) : 0;
  const range = config.profitability.netReturnCeilingBasisPoints - config.profitability.netReturnFloorBasisPoints;
  const netPosition = clamp(halfEven(BigInt(netBp - config.profitability.netReturnFloorBasisPoints) * BI_10K, BigInt(range)), 0, 10_000);
  const winningGross = sum(trades.filter(item => item.grossPnl > BI_ZERO).map(item => item.grossPnl)); const losingGross = sum(trades.filter(item => item.grossPnl < BI_ZERO).map(item => -item.grossPnl));
  const profitBalance = winningGross + losingGross > BI_ZERO ? ratioBp(winningGross, winningGross + losingGross) : 0;
  const feeDrag = gross !== BI_ZERO ? ratioBp(fees, absolute(gross)) : 10_000;
  const feePenaltyRatio = clamp(halfEven(BigInt(feeDrag) * BI_10K, BigInt(config.profitability.fullFeeDragBasisPoints)), 0, 10_000);
  const score = pointsForBp(config.profitability.netReturnPoints, netPosition) + pointsForBp(config.profitability.profitBalancePoints, profitBalance) + config.profitability.feeEfficiencyPoints - pointsForBp(config.profitability.feeEfficiencyPoints, feePenaltyRatio);
  const good: ReadinessFactor[] = []; const bad: ReadinessFactor[] = [];
  if (net > BI_ZERO) good.push(factor('positive-net-pnl', 'Completed lifecycles produced positive fee-complete net P&L'));
  if (profitBalance >= 6500) good.push(factor('favorable-profit-balance', 'Winning gross P&L supplied at least 65% of directional gross movement'));
  if (net <= BI_ZERO) bad.push(factor('nonpositive-net-pnl', 'Completed lifecycles produced non-positive fee-complete net P&L'));
  if (feeDrag >= 1000) bad.push(factor('elevated-fee-drag', 'Fees consumed at least 10% of absolute gross P&L'));
  return component('profitabilityQuality', 'Profitability Quality', score, config.weights.profitabilityQuality,
    [evidence('net-return', 'Net return on phase capital', netBp, 'basisPoints'), evidence('profit-balance', 'Winning share of absolute gross P&L', profitBalance, 'basisPoints'), evidence('fee-drag', 'Fee drag on absolute gross P&L', feeDrag, 'basisPoints'), evidence('net-pnl', 'Fee-complete net P&L atoms', net.toString(), 'moneyAtoms')], good, bad);
}

function executionScore(scope: ScopeEvidence, counts: ReadinessEvidenceCounts, config: ChallengeReadinessConfigV1): ReadinessComponent {
  const trades = closedTrades(scope); const reversalsBp = ratioBp(BigInt(counts.reversalTransitions), BigInt(Math.max(1, trades.length)));
  const reversalPenalty = pointsForBp(config.execution.reversalPenaltyPoints, reversalsBp);
  const churnPenalty = Math.min(config.execution.churnPenaltyCap, counts.partialExitOverage * config.execution.churnPenaltyPerExit);
  const fees = sum(trades.map(item => item.entryFees + item.exitFees)); const gross = sum(trades.map(item => item.grossPnl)); const feeDrag = gross !== BI_ZERO ? ratioBp(fees, absolute(gross)) : 10_000;
  const feePenaltyRatio = clamp(halfEven(BigInt(feeDrag) * BI_10K, BigInt(config.execution.fullFeeDragBasisPoints)), 0, 10_000);
  const feePenalty = pointsForBp(config.execution.feeDragPenaltyPoints, feePenaltyRatio);
  const good: ReadinessFactor[] = []; const bad: ReadinessFactor[] = [];
  if (counts.reversalTransitions === 0) good.push(factor('no-reversal-churn', 'No reversal transition was recorded among completed lifecycles'));
  if (counts.partialExitOverage === 0) good.push(factor('bounded-exit-sequencing', 'Completed lifecycles stayed within three exit fills each'));
  if (counts.reversalTransitions > 0) bad.push(factor('reversal-frequency', `${counts.reversalTransitions} reversal transition(s) recorded`));
  if (counts.partialExitOverage > 0) bad.push(factor('partial-exit-churn', `${counts.partialExitOverage} exit fill(s) exceeded the per-lifecycle allowance`));
  if (feeDrag >= 1000) bad.push(factor('execution-fee-drag', 'Execution fees reached at least 10% of absolute gross P&L'));
  return component('executionControl', 'Execution Control', 100 - reversalPenalty - churnPenalty - feePenalty, config.weights.executionControl,
    [evidence('reversal-transitions', 'Reversal transitions', counts.reversalTransitions, 'count'), evidence('partial-exit-overage', 'Exit fills above three per lifecycle', counts.partialExitOverage, 'count'), evidence('execution-fee-drag', 'Fee drag on absolute gross P&L', feeDrag, 'basisPoints')], good, bad);
}

function shortfallPenalty(completed: number, required: number, points: number): number {
  if (required <= 0 || completed >= required) return 0;
  return pointsForBp(points, ratioBp(BigInt(required - completed), BigInt(required)));
}
function ruleScore(scope: ScopeEvidence, counts: ReadinessEvidenceCounts, config: ChallengeReadinessConfigV1): ReadinessComponent {
  const warningPenalty = Math.min(config.rules.warningCap, counts.warningEvents * config.rules.warningPenalty);
  const dangerPenalty = Math.min(config.rules.dangerCap, counts.dangerEvents * config.rules.dangerPenalty);
  const breachPenalty = Math.min(config.rules.breachCap, counts.breachEvents * config.rules.breachPenalty);
  const inactivityPenalty = Math.min(config.rules.inactivityCap, counts.inactivityBreaches * config.rules.inactivityPenalty);
  const activePenalty = scope.terminal ? Math.max(0, ...scope.phases.map(phase => shortfallPenalty(phase.activeDays[0], phase.activeDays[1], config.rules.terminalActiveDayShortfallPoints))) : 0;
  const profitablePenalty = scope.terminal ? Math.max(0, ...scope.phases.map(phase => shortfallPenalty(phase.profitableDays[0], phase.profitableDays[1], config.rules.terminalProfitableDayShortfallPoints))) : 0;
  const good: ReadinessFactor[] = []; const bad: ReadinessFactor[] = [];
  if (counts.breachEvents === 0) good.push(factor('no-hard-breach', 'No hard rule breach was recorded'));
  if (scope.terminal && activePenalty === 0 && profitablePenalty === 0) good.push(factor('requirements-complete', 'Terminal phase day requirements were satisfied'));
  if (counts.warningEvents) bad.push(factor('rule-warnings', `${counts.warningEvents} canonical warning event(s) reduced rule reliability`));
  if (counts.inactivityBreaches) bad.push(factor('inactivity-breach', `${counts.inactivityBreaches} inactivity breach event(s) recorded`));
  if (scope.terminal && (activePenalty || profitablePenalty)) bad.push(factor('requirements-shortfall', 'A terminal phase ended before all day requirements were satisfied'));
  return component('ruleDiscipline', 'Rule Discipline', 100 - warningPenalty - dangerPenalty - breachPenalty - inactivityPenalty - activePenalty - profitablePenalty, config.weights.ruleDiscipline,
    [evidence('rule-warnings', 'Warnings', counts.warningEvents, 'count'), evidence('rule-danger', 'Danger events', counts.dangerEvents, 'count'), evidence('hard-breaches', 'Hard breaches', counts.breachEvents, 'count'), evidence('inactivity-breaches', 'Inactivity breaches', counts.inactivityBreaches, 'count'), evidence('terminal-active-shortfall-penalty', 'Terminal active-day shortfall penalty', activePenalty, 'count'), evidence('terminal-profitable-shortfall-penalty', 'Terminal profitable-day shortfall penalty', profitablePenalty, 'count')], good, bad);
}

function scoreScope(scope: ScopeEvidence, config: ChallengeReadinessConfigV1): ChallengeReadinessScopeResult {
  const counts = countsFor(scope, config); const eligibility = eligibilityFor(counts, scope.terminal, config); const finality: ReadinessFinality = scope.terminal ? 'FINAL' : 'PROVISIONAL';
  const definitions: readonly [ReadinessComponentKey, string][] = [['riskDiscipline', 'Risk Discipline'], ['consistency', 'Consistency'], ['profitabilityQuality', 'Profitability Quality'], ['executionControl', 'Execution Control'], ['ruleDiscipline', 'Rule Discipline']];
  if (!eligibility.eligible) return { scope: scope.phaseId ? 'phase' : 'challenge', phaseId: scope.phaseId, phaseStatus: scope.phaseStatus, finality, eligibility, score: null, grade: null,
    components: definitions.map(([key, label]) => insufficientComponent(key, label, config.weights[key], eligibility.gaps)), strengths: [], weaknesses: [], evidenceCounts: counts };
  const components = [riskScore(scope, counts, config), consistencyScore(scope, config), profitabilityScore(scope, config), executionScore(scope, counts, config), ruleScore(scope, counts, config)];
  const weighted = components.reduce((total, item) => total + BigInt(item.score!) * BigInt(item.weight), BI_ZERO);
  const score = clamp(halfEven(weighted, BI_100));
  const strengths = components.filter(item => item.score! >= 80).flatMap(item => item.positiveFactors).slice(0, 4);
  const weaknesses = components.filter(item => item.score! < 70).flatMap(item => item.negativeFactors).slice(0, 4);
  return { scope: scope.phaseId ? 'phase' : 'challenge', phaseId: scope.phaseId, phaseStatus: scope.phaseStatus, finality, eligibility, score, grade: gradeReadinessScore(score, config.version), components, strengths, weaknesses, evidenceCounts: counts };
}

export function buildChallengeReadiness(report: ChallengeReportReadModel, version: ReadinessVersion | string = CHALLENGE_READINESS_VERSION): ChallengeReadinessReadModel {
  if (version !== CHALLENGE_READINESS_VERSION) throw new UnsupportedReadinessVersionError(version);
  const config = CHALLENGE_READINESS_CONFIG_V1; const activated = report.phases.filter(phase => phase.startedAt !== null);
  const scopeFor = (phase: ChallengeReportPhase): ScopeEvidence => ({ phaseId: phase.phaseId, phaseStatus: phase.status, phases: [phase], trades: report.trades.filter(item => item.phaseId === phase.phaseId), days: report.days.filter(item => item.phaseId === phase.phaseId), risk: report.riskTimeline.filter(item => item.phaseId === phase.phaseId), terminal: statusIsTerminal(phase.status) });
  const challengeScope: ScopeEvidence = { phaseId: null, phaseStatus: report.summary.status, phases: activated, trades: report.trades.filter(item => activated.some(phase => phase.phaseId === item.phaseId)), days: report.days.filter(item => activated.some(phase => phase.phaseId === item.phaseId)), risk: report.riskTimeline.filter(item => activated.some(phase => phase.phaseId === item.phaseId)), terminal: statusIsTerminal(report.summary.status) };
  const overall = scoreScope(challengeScope, config); const phaseResults = activated.map(phase => scoreScope(scopeFor(phase), config));
  return deepFreeze({ scope: 'challenge' as const, identity: { challengeId: report.summary.challengeId, branchId: report.branch.branchId, generation: report.branch.generation, symbol: 'BTCUSDT', mode: 'replay' },
    status: overall.eligibility.status, score: overall.score, grade: overall.grade, finality: overall.finality, eligibility: overall.eligibility,
    components: overall.components, strengths: overall.strengths, weaknesses: overall.weaknesses, evidenceCounts: overall.evidenceCounts, phaseResults,
    provenance: { readinessVersion: CHALLENGE_READINESS_VERSION, reportVersion: report.provenance.reportVersion, reportHash: canonicalHash(report), definitionHash: report.provenance.definitionHash,
      datasetId: report.provenance.datasetId, datasetHash: report.provenance.datasetHash, branchId: report.branch.branchId, generation: report.branch.generation,
      challengeId: report.summary.challengeId, generatedAt: report.provenance.generatedAt, scoringConfigHash: CHALLENGE_READINESS_CONFIG_V1_HASH }, version: CHALLENGE_READINESS_VERSION });
}
