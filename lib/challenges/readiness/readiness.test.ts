import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { moneyFromAtoms, moneyFromDecimal } from '../domain/money';
import type { Money } from '../domain/types';
import { canonicalHash } from '../domain/versions';
import type { ChallengeReportDay, ChallengeReportPhase, ChallengeReportReadModel, ChallengeReportRiskEvent, ChallengeReportTrade } from '../report';
import { ChallengeReadinessSection } from '@/components/challenges/ChallengeReadiness';
import { CHALLENGE_READINESS_CONFIG_V1, CHALLENGE_READINESS_CONFIG_V1_HASH } from './config';
import { buildChallengeReadiness, gradeReadinessScore } from './scorer';
import type { ReadinessComponentKey } from './types';

const M = (value: string) => moneyFromDecimal(value);
const A = (...values: readonly bigint[]): Money => moneyFromAtoms(values.reduce((total, value) => total + value, BigInt(0)));
let serial = 0;

interface TradeSpec { phaseId?: string; gross?: string; fees?: string; reversal?: boolean; related?: string[]; exits?: number; }
interface DaySpec { phaseId?: string; net?: string; usage?: string; active?: boolean; state?: 'FINALIZED' | 'IN_PROGRESS'; }
interface EventSpec { phaseId?: string; kind: 'WarningRaised' | 'DangerRaised' | 'BreachRecorded'; rule?: 'daily-loss' | 'maximum-loss' | 'inactivity'; observed?: string; floor?: string; }
interface ReportOptions {
  status?: 'ACTIVE' | 'PASSED' | 'FAILED';
  trades?: TradeSpec[];
  days?: DaySpec[];
  events?: EventSpec[];
  phaseCount?: 1 | 2;
  phaseStatuses?: string[];
  branchId?: string;
  generation?: number;
  generatedAt?: number;
}

function tradeRow(spec: TradeSpec, index: number): ChallengeReportTrade {
  const gross = M(spec.gross ?? '400'); const fees = M(spec.fees ?? '10'); const exits = spec.exits ?? 1;
  const fills: Array<ChallengeReportTrade['fills'][number]> = [{ fillId: `entry-${index}`, occurredAt: index * 1000, classification: 'entry', price: '10000', quantity: '1', reason: 'market', grossPnl: M('0'), commission: fees },
    ...Array.from({ length: exits }, (_, exit) => ({ fillId: `exit-${index}-${exit}`, occurredAt: index * 1000 + exit + 1, classification: 'exit', price: '10400', quantity: exits === 1 ? '1' : '0.2', reason: 'manual' as const, grossPnl: exit === exits - 1 ? gross : M('0'), commission: M('0') }))];
  return { lifecycleId: `life-${index}`, positionId: `position-${index}`, phaseId: spec.phaseId ?? 'phase-1', side: 'long', status: 'CLOSED',
    entryAt: index * 1000, exitAt: index * 1000 + exits, entryPrice: '10000', exitPrice: '10400', entryQuantity: '1', closedQuantity: '1',
    grossPnl: gross, entryFees: fees, exitFees: M('0'), netPnl: A(gross, -fees), durationMs: exits, exitReason: 'manual', protection: null,
    partialClose: exits > 1, reversal: spec.reversal ?? false, relatedLifecycleIds: spec.related ?? [], fillIds: fills.map(item => item.fillId), fills, protectionHistory: [] };
}
function dayRow(spec: DaySpec, index: number): ChallengeReportDay {
  const net = M(spec.net ?? '390'); const phaseId = spec.phaseId ?? 'phase-1'; const state = spec.state ?? 'FINALIZED';
  return { phaseId, dayId: `2026-01-${String(index + 1).padStart(2, '0')}`, state, active: spec.active ?? true,
    grossPnl: A(net, M('10')), fees: M('10'), settledNetPnl: net, profitableThreshold: M('10'), qualified: state === 'FINALIZED' && net >= M('10'),
    startingCash: M('10000'), lowestEquity: M('9950'), dailyFloor: M('9500'), maximumDailyLossUsage: M(spec.usage ?? '50'),
    endingCash: A(M('10000'), net), endingEquity: A(M('10000'), net), finalizedAt: state === 'FINALIZED' ? index * 86_400_000 : null };
}
function phaseRow(index: number, status: string, trades: ChallengeReportTrade[], days: ChallengeReportDay[]): ChallengeReportPhase {
  const id = `phase-${index + 1}`; const phaseTrades = trades.filter(item => item.phaseId === id); const phaseDays = days.filter(item => item.phaseId === id && item.state === 'FINALIZED' && item.active);
  const net = A(...phaseTrades.map(item => item.netPnl)); const fees = A(...phaseTrades.flatMap(item => [item.entryFees, item.exitFees]));
  return { phaseId: id, sequence: index + 1, name: `Phase ${index + 1}`, status, startedAt: 1, endedAt: status === 'PASSED' || status === 'FAILED' ? 10 : null,
    startCursor: 0, endCursor: 10, startingCash: M('10000'), endingCash: A(M('10000'), net), endingEquity: A(M('10000'), net),
    grossPnl: A(net, fees), fees, netPnl: net, targetAmount: M(index ? '500' : '1000'), targetReached: status === 'PASSED',
    activeDays: [phaseDays.length, 3], profitableDays: [phaseDays.filter(item => item.qualified).length, 3], completedLifecycles: phaseTrades.length, failure: null };
}
function eventRow(spec: EventSpec, index: number): ChallengeReportRiskEvent {
  const rule = spec.rule ?? 'daily-loss';
  return { decisionId: `decision-${index}`, sequence: index + 1, phaseId: spec.phaseId ?? 'phase-1', ruleId: `${spec.phaseId ?? 'phase-1'}.${rule}`,
    kind: spec.kind, status: spec.kind === 'WarningRaised' ? 'WARNING' : spec.kind === 'DangerRaised' ? 'DANGER' : 'BREACHED',
    occurredAt: index + 1, checkpointId: `checkpoint-${index}`, observed: rule === 'inactivity' ? 1 : M(spec.observed ?? '9550'), floor: rule === 'inactivity' ? 2 : M(spec.floor ?? (rule === 'maximum-loss' ? '9000' : '9500')), headroom: rule === 'inactivity' ? 0 : M('50') };
}
function makeReport(options: ReportOptions = {}): ChallengeReportReadModel {
  const status = options.status ?? 'ACTIVE'; const phaseCount = options.phaseCount ?? 1;
  const tradeSpecs = options.trades ?? [{}, {}, {}]; const daySpecs = options.days ?? [{}, {}, {}];
  const trades = tradeSpecs.map(tradeRow); const days = daySpecs.map(dayRow); const phaseStatuses = options.phaseStatuses ?? Array.from({ length: phaseCount }, (_, index) => index === phaseCount - 1 ? status : 'PASSED');
  const phases = Array.from({ length: phaseCount }, (_, index) => phaseRow(index, phaseStatuses[index], trades, days));
  const events = (options.events ?? []).map(eventRow); const id = `readiness-${++serial}`; const branchId = options.branchId ?? `branch-${id}`;
  const gross = A(...trades.map(item => item.grossPnl)); const fees = A(...trades.flatMap(item => [item.entryFees, item.exitFees])); const net = A(gross, -fees);
  return { summary: { challengeId: id, challengeType: phaseCount === 2 ? 'twoStep' : 'oneStep', symbol: 'BTCUSDT', mode: 'replay', currentPhaseId: `phase-${phaseCount}`, status, health: status === 'FAILED' ? 'BREACHED' : 'SAFE',
      startingCash: M('10000'), currentCash: A(M('10000'), net), currentEquity: A(M('10000'), net), grossPnl: gross, fees, netPnl: net, targetAmount: M('1000'), targetProgress: '1',
      activeDays: [days.filter(item => item.phaseId === `phase-${phaseCount}` && item.active && item.state === 'FINALIZED').length, 3], profitableDays: [days.filter(item => item.phaseId === `phase-${phaseCount}` && item.qualified).length, 3], replayStartedAt: 1, replayEndedAt: 10, timeframe: '1d' },
    phases, trades, days, riskTimeline: events, decisionTimeline: [], failureAnalysis: null, passAnalysis: null,
    branch: { branchId, generation: options.generation ?? 0, active: true, parentBranchId: null, forkCursor: null, createdAt: 1, creationReason: 'attempt-created' },
    provenance: { reportVersion: 'mcs.challenge-report/1', definitionHash: 'sha256:def', datasetId: 'btc-fixture', datasetHash: 'sha256:data', branchId, generation: options.generation ?? 0, attemptRevision: 1, commitKey: 'commit', checkpointId: 'checkpoint', ledgerHash: 'sha256:ledger', stateWitnessHash: 'sha256:witness', generatedAt: options.generatedAt ?? 10, versions: { accounting: 'usd-micros/1', rules: 'mcs.challenge.rules/1', execution: 'mcs.challenge.execution/1' }, source: 'frozen-definition+journal' } };
}
const component = (report: ChallengeReportReadModel, key: ReadinessComponentKey) => buildChallengeReadiness(report).components.find(item => item.key === key)!;

describe('Task 9 deterministic Readiness Score v1', () => {
  it('withholds the overall score for insufficient evidence', () => {
    const value = buildChallengeReadiness(makeReport({ trades: [], days: [] }));
    expect(value).toMatchObject({ status: 'INSUFFICIENT_DATA', score: null, grade: null });
    expect(value.components.every(item => item.status === 'INSUFFICIENT_DATA')).toBe(true);
  });
  it('becomes scorable exactly at three closed lifecycles, three finalized active days and three risk observations', () => {
    expect(buildChallengeReadiness(makeReport()).status).toBe('SCORABLE');
  });
  it('does not count open or in-progress evidence toward eligibility', () => {
    const report = makeReport({ days: [{}, {}, { state: 'IN_PROGRESS' }] }); (report.trades as ChallengeReportTrade[])[2] = { ...report.trades[2], status: 'OPEN' };
    expect(buildChallengeReadiness(report).eligibility.gaps.map(item => item.code)).toEqual(expect.arrayContaining(['minimum-trades', 'minimum-days', 'minimum-risk-observations']));
  });
  it('binds the exact recommended v1 weights to 100 percent', () => {
    expect(CHALLENGE_READINESS_CONFIG_V1.weights).toEqual({ riskDiscipline: 30, consistency: 25, profitabilityQuality: 20, executionControl: 15, ruleDiscipline: 10 });
    expect(Object.values(CHALLENGE_READINESS_CONFIG_V1.weights).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('produces the exact clean fixture component and overall scores', () => {
    const value = buildChallengeReadiness(makeReport());
    expect(value.components.map(item => [item.key, item.score, item.weightedContribution])).toEqual([
      ['riskDiscipline', 94, 28.2], ['consistency', 100, 25], ['profitabilityQuality', 98, 19.6], ['executionControl', 98, 14.7], ['ruleDiscipline', 100, 10],
    ]);
    expect(value.score).toBe(98);
  });
  it('scores low daily-capacity use as high Risk Discipline', () => expect(component(makeReport(), 'riskDiscipline').score).toBe(94));
  it('reduces Risk Discipline monotonically for danger evidence', () => {
    const warning = component(makeReport({ events: [{ kind: 'WarningRaised' }] }), 'riskDiscipline').score!;
    const danger = component(makeReport({ events: [{ kind: 'WarningRaised' }, { kind: 'DangerRaised' }] }), 'riskDiscipline').score!;
    expect(danger).toBeLessThan(warning);
  });
  it('applies a bounded material loss-breach penalty', () => {
    const clean = component(makeReport(), 'riskDiscipline').score!;
    const breached = component(makeReport({ events: [{ kind: 'BreachRecorded' }] }), 'riskDiscipline').score!;
    expect(clean - breached).toBe(24); expect(breached).toBeGreaterThan(0);
  });
  it('keeps inactivity events out of loss-capacity Risk Discipline', () => {
    const clean = component(makeReport(), 'riskDiscipline').score;
    const inactivity = component(makeReport({ events: [{ kind: 'WarningRaised', rule: 'inactivity' }] }), 'riskDiscipline').score;
    expect(inactivity).toBe(clean);
  });
  it('uses maximum-loss transition utilization when present', () => {
    const value = component(makeReport({ events: [{ kind: 'WarningRaised', rule: 'maximum-loss', observed: '9100', floor: '9000' }] }), 'riskDiscipline');
    expect(value.evidence.find(item => item.code === 'peak-loss-use')?.value).toBe(9000);
  });
  it('scores stable positive finalized active days at 100 Consistency', () => expect(component(makeReport(), 'consistency').score).toBe(100));
  it('penalizes a single-day concentration of positive P&L', () => {
    const stable = component(makeReport(), 'consistency').score!;
    const concentrated = component(makeReport({ days: [{ net: '1170' }, { net: '0' }, { net: '0' }] }), 'consistency').score!;
    expect(concentrated).toBeLessThan(stable);
  });
  it('penalizes high day-return variance', () => {
    const stable = component(makeReport(), 'consistency').score!;
    const varied = component(makeReport({ days: [{ net: '1000' }, { net: '-500' }, { net: '670' }] }), 'consistency').score!;
    expect(varied).toBeLessThan(stable);
  });
  it('uses finalized active days only for Consistency', () => {
    const base = component(makeReport(), 'consistency').score;
    const withCurrent = component(makeReport({ days: [{}, {}, {}, { state: 'IN_PROGRESS', net: '-9000' }] }), 'consistency').score;
    expect(withCurrent).toBe(base);
  });
  it('scores a profitable fee-complete case highly', () => expect(component(makeReport(), 'profitabilityQuality').score).toBeGreaterThanOrEqual(90));
  it('reduces Profitability Quality as fee drag rises', () => {
    const clean = component(makeReport(), 'profitabilityQuality').score!;
    const costly = component(makeReport({ trades: [{ fees: '150' }, { fees: '150' }, { fees: '150' }] }), 'profitabilityQuality').score!;
    expect(costly).toBeLessThan(clean);
  });
  it('keeps a negative profitability case bounded and non-fabricated', () => {
    const value = component(makeReport({ trades: [{ gross: '-100', fees: '10' }, { gross: '-100', fees: '10' }, { gross: '-100', fees: '10' }] }), 'profitabilityQuality');
    expect(value.score).toBeGreaterThanOrEqual(0); expect(value.score).toBeLessThan(50);
    expect(value.negativeFactors.map(item => item.code)).toContain('nonpositive-net-pnl');
  });
  it('scores clean canonical lifecycles highly for Execution Control', () => expect(component(makeReport(), 'executionControl').score).toBe(98));
  it('penalizes reversal frequency without inspecting trade duration', () => {
    const report = makeReport({ trades: [{ reversal: true, related: ['life-1'] }, { reversal: true, related: ['life-0'] }, {}] });
    expect(component(report, 'executionControl').score).toBeLessThan(component(makeReport(), 'executionControl').score!);
  });
  it('penalizes only partial exits beyond the three-fill allowance', () => {
    expect(component(makeReport({ trades: [{ exits: 3 }, {}, {}] }), 'executionControl').evidence.find(item => item.code === 'partial-exit-overage')?.value).toBe(0);
    expect(component(makeReport({ trades: [{ exits: 5 }, {}, {}] }), 'executionControl').score).toBeLessThan(98);
  });
  it('does not judge strategy holding duration', () => {
    const report = makeReport(); (report.trades as ChallengeReportTrade[])[0] = { ...report.trades[0], durationMs: 999_999_999 };
    expect(component(report, 'executionControl').score).toBe(98);
  });
  it('scores clean canonical requirements at 100 Rule Discipline', () => expect(component(makeReport(), 'ruleDiscipline').score).toBe(100));
  it('applies a small explicit warning reliability penalty', () => expect(component(makeReport({ events: [{ kind: 'WarningRaised' }] }), 'ruleDiscipline').score).toBe(98));
  it('applies the dedicated inactivity breach penalty', () => {
    const value = component(makeReport({ events: [{ kind: 'BreachRecorded', rule: 'inactivity' }] }), 'ruleDiscipline');
    expect(value.score).toBe(62); expect(value.negativeFactors.map(item => item.code)).toContain('inactivity-breach');
  });
  it('bounds simultaneous breach penalties instead of forcing zero', () => {
    const value = component(makeReport({ events: [{ kind: 'BreachRecorded' }, { kind: 'BreachRecorded', rule: 'maximum-loss' }] }), 'ruleDiscipline');
    expect(value.score).toBe(84);
  });
  it('does not penalize incomplete day requirements on an active provisional attempt', () => {
    const report = makeReport({ days: [{}, {}, {}] }); (report.phases as ChallengeReportPhase[])[0] = { ...report.phases[0], activeDays: [3, 8], profitableDays: [3, 8] };
    expect(component(report, 'ruleDiscipline').score).toBe(100);
  });
  it('penalizes terminal day-requirement shortfall explicitly', () => {
    const report = makeReport({ status: 'FAILED' }); (report.phases as ChallengeReportPhase[])[0] = { ...report.phases[0], activeDays: [3, 6], profitableDays: [1, 3] };
    expect(component(report, 'ruleDiscipline').score).toBeLessThan(100);
  });
  it.each([[90, 'EXCELLENT'], [89, 'STRONG'], [80, 'STRONG'], [79, 'DEVELOPING'], [70, 'DEVELOPING'], [69, 'WEAK'], [60, 'WEAK'], [59, 'NOT_READY'], [0, 'NOT_READY']] as const)('maps score %s to exact grade %s', (score, grade) => expect(gradeReadinessScore(score)).toBe(grade));
  it('rejects grade values outside the contract', () => expect(() => gradeReadinessScore(101)).toThrow(RangeError));
  it('allows a passed Challenge to have moderate readiness', () => {
    const value = buildChallengeReadiness(makeReport({ status: 'PASSED', days: [{ usage: '480' }, { usage: '480' }, { usage: '480' }], events: [{ kind: 'WarningRaised' }, { kind: 'DangerRaised' }] }));
    expect(value.finality).toBe('FINAL'); expect(value.score).not.toBeNull(); expect(value.score!).toBeLessThan(80);
  });
  it('allows a failed Challenge to retain a non-zero evidence score', () => {
    const value = buildChallengeReadiness(makeReport({ status: 'FAILED', events: [{ kind: 'BreachRecorded' }] }));
    expect(value.status).toBe('COMPLETE'); expect(value.score).toBeGreaterThan(0);
  });
  it('marks a scorable active attempt PROVISIONAL', () => expect(buildChallengeReadiness(makeReport()).finality).toBe('PROVISIONAL'));
  it('marks a scorable terminal attempt FINAL and COMPLETE', () => expect(buildChallengeReadiness(makeReport({ status: 'PASSED' }))).toMatchObject({ finality: 'FINAL', status: 'COMPLETE' }));
  it('pools Two-Step evidence instead of averaging phase scores', () => {
    const report = makeReport({ phaseCount: 2, phaseStatuses: ['PASSED', 'ACTIVE'],
      trades: [{ phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-2', gross: '-300' }],
      days: [{ phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-2', net: '-310' }] });
    const value = buildChallengeReadiness(report);
    expect(value.phaseResults[0].score).not.toBeNull(); expect(value.phaseResults[1].score).toBeNull(); expect(value.score).not.toBeNull();
  });
  it('isolates Phase 1 and Phase 2 component evidence', () => {
    const report = makeReport({ phaseCount: 2, status: 'PASSED', phaseStatuses: ['PASSED', 'PASSED'],
      trades: [{ phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-2', gross: '-100' }, { phaseId: 'phase-2', gross: '-100' }, { phaseId: 'phase-2', gross: '-100' }],
      days: [{ phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-1' }, { phaseId: 'phase-2', net: '-110' }, { phaseId: 'phase-2', net: '-110' }, { phaseId: 'phase-2', net: '-110' }] });
    const phases = buildChallengeReadiness(report).phaseResults;
    expect(phases[0].score).toBeGreaterThan(phases[1].score!);
  });
  it('binds identity to one branch without changing evidence scoring', () => {
    const left = buildChallengeReadiness(makeReport({ branchId: 'branch-left' })); const right = buildChallengeReadiness(makeReport({ branchId: 'branch-right' }));
    expect(left.identity.branchId).toBe('branch-left'); expect(right.identity.branchId).toBe('branch-right'); expect(left.score).toBe(right.score);
  });
  it('is deterministic across repeated calculations', () => {
    const report = makeReport(); expect(canonicalHash(buildChallengeReadiness(report))).toBe(canonicalHash(buildChallengeReadiness(report)));
  });
  it('is equivalent after an evidence-preserving structured reload', () => {
    const report = makeReport(); expect(buildChallengeReadiness(structuredClone(report))).toEqual(buildChallengeReadiness(report));
  });
  it('binds every result to the readiness version and frozen config hash', () => {
    const value = buildChallengeReadiness(makeReport());
    expect(value.version).toBe('mcs.challenge.readiness/1'); expect(value.provenance.scoringConfigHash).toBe(CHALLENGE_READINESS_CONFIG_V1_HASH);
  });
  it('binds result provenance to the exact report hash', () => {
    const report = makeReport(); expect(buildChallengeReadiness(report).provenance.reportHash).toBe(canonicalHash(report));
  });
  it('rejects unsupported readiness versions explicitly', () => expect(() => buildChallengeReadiness(makeReport(), 'mcs.challenge.readiness/2')).toThrow(/Unsupported readiness version/));
  it('does not mutate Task 8 report, Task 4 decisions, accounting, or execution evidence', () => {
    const report = makeReport({ events: [{ kind: 'WarningRaised' }] }); const before = canonicalHash(report); buildChallengeReadiness(report);
    expect(canonicalHash(report)).toBe(before); expect(report.decisionTimeline).toEqual([]); expect(report.trades[0].netPnl).toBe(M('390'));
  });
  it('has no scorer dependency on accounting, execution, rules, replay, or persistence engines', () => {
    const source = readFileSync('lib/challenges/readiness/scorer.ts', 'utf8');
    expect(source).not.toMatch(/accounting\/(ledger|reducer)|execution\/(reducer|engine)|rules\/engine|replay\/coordinator|persistence\/repository/);
  });
  it('keeps React presentation-only and free of scoring calls', () => {
    const source = readFileSync('components/challenges/ChallengeReadiness.tsx', 'utf8');
    expect(source).not.toContain('buildChallengeReadiness'); expect(source).not.toContain('CHALLENGE_READINESS_CONFIG');
  });
  it('renders a premium horizontal breakdown and deterministic evidence labels', () => {
    const html = renderToStaticMarkup(createElement(ChallengeReadinessSection, { readiness: buildChallengeReadiness(makeReport()) }));
    for (const label of ['Readiness', 'Risk Discipline', 'Consistency', 'Profitability Quality', 'Execution Control', 'Rule Discipline', 'Strengths']) expect(html).toContain(label);
    expect(html).toContain('transition-[width]'); expect(html).not.toContain('radar');
  });
  it('renders insufficient evidence without fabricating 50 out of 100', () => {
    const html = renderToStaticMarkup(createElement(ChallengeReadinessSection, { readiness: buildChallengeReadiness(makeReport({ trades: [], days: [] })) }));
    expect(html).toContain('Readiness withheld'); expect(html).not.toContain('50<!-- --> / 100');
  });
  it('renders the required non-guarantee disclosure', () => {
    const html = renderToStaticMarkup(createElement(ChallengeReadinessSection, { readiness: buildChallengeReadiness(makeReport()) }));
    expect(html).toContain('does not predict or guarantee results in a real evaluation');
  });
  it('integrates Readiness after Summary and before Phase Results', () => {
    const source = readFileSync('components/challenges/ChallengeReport.tsx', 'utf8');
    expect(source.indexOf('ChallengeReadinessSection readiness')).toBeGreaterThan(source.indexOf('summary-heading'));
    expect(source.indexOf('ChallengeReadinessSection readiness')).toBeLessThan(source.indexOf('<PhaseResults'));
  });
  it('constructs readiness once in the report service rather than during render', () => {
    const service = readFileSync('lib/challenges/readiness/service.ts', 'utf8');
    expect(service.match(/buildChallengeReadiness\(/g)).toHaveLength(1);
    expect(readFileSync('components/challenges/ChallengeReport.tsx', 'utf8')).not.toContain('buildChallengeReadiness');
  });
  it('does not add readiness fields to the Task 8 report model', () => {
    const report = makeReport(); buildChallengeReadiness(report); expect('readinessScore' in report).toBe(false);
  });
  it('retains deterministic evidence codes for every scored component', () => {
    const value = buildChallengeReadiness(makeReport());
    expect(value.components.every(item => item.evidence.length > 0 && item.evidence.every(entry => entry.code.length > 0))).toBe(true);
  });
  it('measures cheap scoring across short, medium and long report evidence', () => {
    const timings: number[] = [];
    for (const count of [3, 120, 400]) {
      const report = makeReport({ trades: Array.from({ length: count }, () => ({})), days: Array.from({ length: count }, () => ({})) });
      const start = performance.now(); buildChallengeReadiness(report); timings.push(performance.now() - start);
    }
    console.info('TASK9_READINESS_BUILD_MS', timings);
    expect(timings.every(value => value < 250)).toBe(true);
  });
});
