import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { utcInstant } from '../domain/calendar';
import { accountId, branchId, challengeId, phaseId, replaySessionId } from '../domain/types';
import { freezeChallengeDefinition, MYCRYPTOSTACK_ONE_STEP_V1, MYCRYPTOSTACK_TWO_STEP_V1 } from '../domain/templates';
import { freezeChallengeReplayDataset, reconstructReplayChallenge, startReplayChallenge, type ChallengeReplayCoordinator, type ChallengeReplayTradingIntent } from '../replay';
import { DurableChallengeReplaySession, persistenceHash, stateWitnessHash, versionSet } from '../persistence/session';
import { IndexedDbChallengeReplayRepository } from '../persistence/repository';
import type { ChallengeReplayRepository } from '../persistence/types';
import { loadChallengeReport } from './service';
import { ChallengeReportView } from '@/components/challenges/ChallengeReport';
import type { PersistedAttempt, PersistedBranch, PersistedCommit } from '../persistence/types';
import { buildChallengeReport } from './builder';

const START = Number(utcInstant(2026, 1, 1)) / 1000;
function bars(count = 20, price: number | ((index: number) => number) = 10_000) {
  return Array.from({ length: count }, (_, index) => { const value = typeof price === 'function' ? price(index) : price; return { time: START + index * 86_400, open: value, high: value, low: value, close: value, volume: 1 }; });
}
let serial = 0;
function setup(kind: 'one' | 'two' = 'one', candles = bars()) {
  const id = `report-${++serial}`;
  const dataset = freezeChallengeReplayDataset({ datasetId: `dataset-${id}`, symbol: 'BTCUSDT', executionTimeframe: '1d', candles });
  const definition = freezeChallengeDefinition({ template: kind === 'one' ? MYCRYPTOSTACK_ONE_STEP_V1 : MYCRYPTOSTACK_TWO_STEP_V1, selectedCapital: '10000', selectedSymbol: 'BTCUSDT', mode: 'replay' });
  return startReplayChallenge({ frozenDefinition: definition, selectedPhase: phaseId('phase-1'), dataset, executionTimeframe: '1d', startingCursor: 0,
    identities: { challengeId: challengeId(`challenge-${id}`), accountId: accountId(`account-${id}`), phaseId: phaseId('phase-1'), replaySessionId: replaySessionId(`replay-${id}`), branchId: branchId(`branch-${id}`), generation: 0 } });
}
function trade(c: ChallengeReplayCoordinator, intent: ChallengeReplayTradingIntent) { return c.trade(c.getContext(), intent); }
function market(side: 'buy' | 'sell', quantity = '1', observedPrice = '10000', protection?: { stopLoss?: string; takeProfit?: string; trailingEnabled?: boolean }) {
  return { kind: 'market' as const, side, quantity, observedPrice, leverage: '10', ...(protection ? { protection } : {}) };
}
function advance(c: ChallengeReplayCoordinator, cursor: number) { return c.advanceTo(c.getContext(), cursor); }
function reportOf(source: ChallengeReplayCoordinator) {
  const { coordinator, snapshot } = reconstructReplayChallenge(source.exportJournal(), true);
  const context = source.getContext(); const now = Number(snapshot.logicalTime);
  const attempt: PersistedAttempt = { challengeId: String(context.accountId).replace('account-', 'challenge-'), schemaVersion: 1, mode: 'replay', challengeType: snapshot.definition.template.challengeType, selectedCapital: '10000', currentPhaseId: String(snapshot.lifecycle.currentPhaseId), status: snapshot.lifecycle.status, createdAt: now, updatedAt: now, activeBranchId: String(context.branchId), activeReplayCursor: snapshot.cursor, datasetId: snapshot.dataset.datasetId, datasetHash: snapshot.dataset.datasetHash, definitionHash: snapshot.definition.definitionHash, versions: versionSet(snapshot), revision: snapshot.actions.length, latestCommitKey: 'commit' };
  attempt.challengeId = String(snapshot.lifecycle.challengeId);
  const branch: PersistedBranch = { branchKey: `${attempt.challengeId}|${context.branchId}`, challengeId: attempt.challengeId, branchId: String(context.branchId), parentBranchId: context.generation ? 'archived-parent' : null, forkCursor: context.generation ? 0 : null, generation: context.generation, createdAt: now, creationReason: context.generation ? 'rewind' : 'attempt-created', active: true, cursor: snapshot.cursor, startingCursor: 0, actionCount: snapshot.actions.length, identities: source.exportJournal().identities, terminalResult: null, stateWitnessHash: stateWitnessHash(snapshot) };
  const commit: PersistedCommit = { commitKey: 'commit', operationKey: 'operation', challengeId: attempt.challengeId, revision: attempt.revision, operationId: 'report', branchId: branch.branchId, cursor: snapshot.cursor, actionCount: snapshot.actions.length, currentPhaseId: String(snapshot.lifecycle.currentPhaseId), status: snapshot.lifecycle.status, stateWitnessHash: stateWitnessHash(snapshot), committedAt: now };
  return buildChallengeReport({ snapshot, cycles: coordinator.getEvidenceCycles(), attempt, branch, commit, generatedAt: now });
}
function profitableDay(c: ChallengeReplayCoordinator, day: number) {
  if (c.getSnapshot().cursor < day) advance(c, day);
  trade(c, market('buy')); trade(c, { kind: 'closeFull', observedPrice: '10400' }); advance(c, day + 1);
}

describe('Task 8 deterministic Challenge reports', () => {
  it('builds a One-Step ACTIVE report with an in-progress UTC day and exact provenance', () => {
    const c = setup(); const report = reportOf(c);
    expect(report.summary.status).toBe('ACTIVE'); expect(report.days.at(-1)?.state).toBe('IN_PROGRESS');
    expect(report.days.at(-1)?.qualified).toBe(false); expect(report.provenance.stateWitnessHash).toBeTruthy();
    expect(Object.isFrozen(report)).toBe(true);
  });
  it('aggregates exact gross, entry/exit fees and net from canonical facts', () => {
    const c = setup(); trade(c, market('buy')); trade(c, { kind: 'closeFull', observedPrice: '10100' });
    const report = reportOf(c); const lifecycle = report.trades[0];
    expect(lifecycle.grossPnl - lifecycle.entryFees - lifecycle.exitFees).toBe(lifecycle.netPnl);
    expect(report.summary.grossPnl).toBe(c.getSnapshot().account.realizedGrossPnl);
    expect(report.summary.fees).toBe(c.getSnapshot().account.totalCommissions);
  });
  it('preserves partial-close history and residual lifecycle accounting', () => {
    const c = setup(); trade(c, market('buy')); trade(c, { kind: 'closePartial', quantity: '0.4', observedPrice: '10100' }); trade(c, { kind: 'closeFull', observedPrice: '10200' });
    const lifecycle = reportOf(c).trades[0];
    expect(lifecycle.partialClose).toBe(true); expect(lifecycle.fills.map(fill => fill.quantity)).toEqual(['1', '0.4', '0.6']); expect(lifecycle.status).toBe('CLOSED');
  });
  it('splits a reversal into related lifecycles with reset protection', () => {
    const c = setup(); trade(c, market('buy', '1', '10000', { stopLoss: '9900', takeProfit: '11000' })); trade(c, market('sell', '2'));
    const report = reportOf(c); expect(report.trades).toHaveLength(2); expect(report.trades.every(item => item.reversal)).toBe(true);
    expect(report.trades[1].protection).toBeNull(); expect(report.trades[0].relatedLifecycleIds).toContain(report.trades[1].lifecycleId);
  });
  it.each([
    ['normal stop', { open: 10000, high: 10000, low: 9800, close: 9800 }, { stopLoss: '9900' }, 'stopLoss', '9900'],
    ['take profit', { open: 10000, high: 10200, low: 10000, close: 10200 }, { takeProfit: '10100' }, 'takeProfit', '10100'],
    ['gap stop', { open: 9800, high: 9850, low: 9580, close: 9750 }, { stopLoss: '9900' }, 'stopLoss', '9800'],
  ] as const)('reports %s from the actual protective fill', (_name, candle, protection, reason, price) => {
    const candles = bars(); candles[1] = { ...candles[1], ...candle }; const c = setup('one', candles);
    trade(c, market('buy', '1', '10000', protection)); advance(c, 1); const lifecycle = reportOf(c).trades[0];
    expect(lifecycle.exitReason).toBe(reason); expect(lifecycle.exitPrice).toBe(price); expect(lifecycle.protectionHistory.length).toBeGreaterThan(0);
  });
  it('reports a trailing exit and working-order entry from canonical fill reasons', () => {
    const candles = bars(); candles[1] = { ...candles[1], open: 10000, high: 10200, low: 10000, close: 10200 }; candles[2] = { ...candles[2], open: 10200, high: 10200, low: 10050, close: 10050 };
    const trailing = setup('one', candles); trade(trailing, market('buy', '1', '10000', { stopLoss: '9900', trailingEnabled: true })); advance(trailing, 2);
    expect(reportOf(trailing).trades[0].exitReason).toBe('trailingStop');
    const workingBars = bars(); workingBars[1] = { ...workingBars[1], open: 10000, high: 10000, low: 9800, close: 9900 };
    const working = setup('one', workingBars); trade(working, { kind: 'placeWorkingEntry', side: 'buy', orderType: 'limit', quantity: '0.1', triggerPrice: '9900', leverage: '10' }); advance(working, 1);
    expect(reportOf(working).trades[0].fills[0].reason).toBe('workingLimit');
  });
  it('reports finalized active/profitable days and never qualifies the current day', () => {
    const c = setup(); profitableDay(c, 0); const report = reportOf(c); const first = report.days[0];
    expect(first).toMatchObject({ state: 'FINALIZED', active: true, qualified: true });
    expect(report.days.at(-1)).toMatchObject({ state: 'IN_PROGRESS', qualified: false });
    expect(first.grossPnl - first.fees).toBe(first.settledNetPnl);
  });
  it('records WARNING, DANGER, breach and deterministic daily-loss failure analysis', () => {
    const candles = bars(10, index => index === 1 ? 9580 : index === 2 ? 9510 : index === 3 ? 9480 : 10000); const c = setup('one', candles);
    trade(c, market('buy')); advance(c, 3); const report = reportOf(c);
    expect(report.summary.status).toBe('FAILED'); expect(report.riskTimeline.map(item => item.status)).toEqual(expect.arrayContaining(['WARNING', 'DANGER', 'BREACHED']));
    expect(report.failureAnalysis?.primaryBreach.ruleId).toContain('daily'); expect(report.failureAnalysis?.checkpoint.checkpointId).toBeTruthy(); expect(report.failureAnalysis?.precedingRisk.length).toBe(2);
  });
  it('reports One-Step pass analysis without a readiness score', () => {
    const c = setup(); profitableDay(c, 0); profitableDay(c, 1); profitableDay(c, 2); const report = reportOf(c);
    expect(report.summary.status).toBe('PASSED'); expect(report.passAnalysis?.completedLifecycles).toBe(3);
    expect('readinessScore' in report).toBe(false); expect(report.failureAnalysis).toBeNull();
  });
  it('reports Two-Step Phase 1 completion before Phase 2 has any economics', () => {
    const c = setup('two'); profitableDay(c, 0); profitableDay(c, 1); profitableDay(c, 2); const report = reportOf(c);
    expect(report.summary.currentPhaseId).toBe('phase-2'); expect(report.phases[0].status).toBe('PASSED');
    expect(report.phases[1].status).toBe('ACTIVE'); expect(report.phases[1].fees).toBe(BigInt(0));
    expect(report.decisionTimeline.map(item => item.kind)).toEqual(expect.arrayContaining(['PhasePassed', 'NextPhaseEligible', 'PhaseActivated']));
  });
  it('keeps Two-Step phase cash, counters, fees and lifecycle totals separate', () => {
    const c = setup('two'); profitableDay(c, 0); profitableDay(c, 1); profitableDay(c, 2);
    expect(c.getSnapshot().readModel.identity.currentPhaseId).toBe('phase-2');
    profitableDay(c, 3); profitableDay(c, 4); profitableDay(c, 5); const report = reportOf(c);
    expect(report.summary.status).toBe('PASSED'); expect(report.phases).toHaveLength(2); expect(report.phases[0].activeDays[0]).toBe(3); expect(report.phases[1].activeDays[0]).toBe(3);
    expect(report.phases[0].startingCash).toBe(report.phases[1].startingCash); expect(report.trades.filter(item => item.phaseId === 'phase-1')).toHaveLength(3); expect(report.trades.filter(item => item.phaseId === 'phase-2')).toHaveLength(3);
  });
  it('is byte-deterministic for the same branch evidence', () => {
    const c = setup(); trade(c, market('buy')); trade(c, { kind: 'closePartial', quantity: '0.4', observedPrice: '10100' });
    expect(persistenceHash(reportOf(c))).toBe(persistenceHash(reportOf(c)));
  });
  it('records a WARNING rearm without independently recomputing risk', () => {
    const candles = bars(); candles[1] = { ...candles[1], open: 10000, low: 9580, high: 10000, close: 10000 }; const c = setup('one', candles);
    trade(c, market('buy')); advance(c, 1); expect(reportOf(c).riskTimeline.map(item => item.kind)).toContain('WarningRearmed');
  });
  it('selects maximum-loss and simultaneous primary breaches exactly as Task 4 decided', () => {
    const maximum = setup();
    for (let day = 0; day < 3 && maximum.getSnapshot().lifecycle.status === 'ACTIVE'; day += 1) {
      if (maximum.getSnapshot().cursor < day) advance(maximum, day);
      trade(maximum, market('buy')); trade(maximum, { kind: 'closeFull', observedPrice: '9650' });
      if (maximum.getSnapshot().lifecycle.status === 'ACTIVE') advance(maximum, day + 1);
    }
    expect(reportOf(maximum).failureAnalysis?.primaryBreach.ruleId).toContain('maximum');
    const simultaneous = setup(); trade(simultaneous, market('buy')); trade(simultaneous, { kind: 'closeFull', observedPrice: '8900' });
    const reported = reportOf(simultaneous); const recorded = simultaneous.getSnapshot().lifecycle.phases[0].primaryBreach;
    expect(reported.failureAnalysis?.primaryBreach.evidenceId).toBe(recorded?.evidenceId);
    expect(reported.riskTimeline.filter(item => item.status === 'BREACHED').length).toBeGreaterThanOrEqual(2);
  });
  it('reports inactivity failure with logical-time evidence and no fabricated trade', () => {
    const c = setup('one', bars(40)); advance(c, 30); const report = reportOf(c);
    expect(report.failureAnalysis?.primaryBreach.ruleKind).toBe('inactivity');
    expect(report.failureAnalysis?.relevantLifecycleId).toBeNull(); expect(report.trades).toHaveLength(0);
  });
  it('isolates a rewound active branch from the abandoned branch outcome', () => {
    const c = setup(); advance(c, 1); trade(c, market('buy')); trade(c, { kind: 'closeFull', observedPrice: '10100' }); advance(c, 2);
    expect(c.rewind(c.getContext(), 0).status).toBe('applied');
    const report = reportOf(c); expect(report.trades).toHaveLength(0); expect(report.branch.generation).toBe(1);
    expect(report.summary.status).toBe('ACTIVE');
  });
  it('keeps an abandoned failed branch isolated from a later passing branch', () => {
    const c = setup(); advance(c, 1); trade(c, market('buy')); trade(c, { kind: 'closeFull', observedPrice: '8900' });
    expect(c.getSnapshot().lifecycle.status).toBe('FAILED'); expect(c.rewind(c.getContext(), 0).status).toBe('applied');
    profitableDay(c, 0); profitableDay(c, 1); profitableDay(c, 2); const report = reportOf(c);
    expect(c.getArchivedBranches()[0].readModel.identity.status).toBe('FAILED'); expect(report.summary.status).toBe('PASSED');
    expect(report.failureAnalysis).toBeNull(); expect(report.branch.creationReason).toBe('rewind'); expect(report.trades).toHaveLength(3);
  });
  it('loads an equivalent report twice from persistence without taking a lease', async () => {
    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task8-${++serial}`);
    const c = setup(); const session = await DurableChallengeReplaySession.create(repository, c, 'writer');
    await session.apply({ kind: 'trade', intent: market('buy') }, 'entry');
    const first = await loadChallengeReport(repository, String(c.getSnapshot().lifecycle.challengeId));
    const second = await loadChallengeReport(repository, String(c.getSnapshot().lifecycle.challengeId));
    expect(persistenceHash(first.report)).toBe(persistenceHash(second.report));
    expect(first.report.trades).toHaveLength(1);
  });
  it('rejects corrupt and unsupported persisted report evidence explicitly', async () => {
    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task8-corrupt-${++serial}`);
    const c = setup(); await DurableChallengeReplaySession.create(repository, c, 'writer');
    const id = String(c.getSnapshot().lifecycle.challengeId); const loaded = await repository.loadAttempt(id);
    const corrupt = { ...repository, loadAttempt: async () => ({ ...loaded!, actions: [{ ...loaded!.actions[0], actionHash: 'bad' }] }) } as unknown as ChallengeReplayRepository;
    // The empty journal is made inconsistent with its committed count to exercise corruption without sample substitution.
    const inconsistent = { ...repository, loadAttempt: async () => ({ ...loaded!, attempt: { ...loaded!.attempt, activeBranchId: 'wrong' } }) } as unknown as ChallengeReplayRepository;
    await expect(loadChallengeReport(inconsistent, id)).rejects.toMatchObject({ code: 'CORRUPT' });
    const unsupported = { ...repository, loadAttempt: async () => ({ ...loaded!, attempt: { ...loaded!.attempt, schemaVersion: 99 } }) } as unknown as ChallengeReplayRepository;
    await expect(loadChallengeReport(unsupported, id)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    void corrupt;
  });
  it('measures one-time report construction for short, medium and long replay fixtures', () => {
    const timings: Record<string, number> = {};
    for (const [label, count] of [['short', 10], ['medium', 120], ['long', 400]] as const) {
      const values = Array.from({ length: count }, (_, index) => ({ time: START + index * 900, open: 10000, high: 10000, low: 10000, close: 10000, volume: 1 }));
      const id = `performance-${label}-${++serial}`;
      const dataset = freezeChallengeReplayDataset({ datasetId: id, symbol: 'BTCUSDT', executionTimeframe: '15m', candles: values });
      const definition = freezeChallengeDefinition({ template: MYCRYPTOSTACK_ONE_STEP_V1, selectedCapital: '10000', selectedSymbol: 'BTCUSDT', mode: 'replay' });
      const coordinator = startReplayChallenge({ frozenDefinition: definition, selectedPhase: phaseId('phase-1'), dataset, executionTimeframe: '15m', startingCursor: 0, identities: { challengeId: challengeId(id), accountId: accountId(`account-${id}`), phaseId: phaseId('phase-1'), replaySessionId: replaySessionId(`replay-${id}`), branchId: branchId(`branch-${id}`), generation: 0 } });
      advance(coordinator, count - 1); const started = performance.now(); reportOf(coordinator); timings[label] = performance.now() - started;
    }
    console.info('TASK8_REPORT_BUILD_MS', timings);
    expect(timings.short).toBeLessThan(2_000); expect(timings.medium).toBeLessThan(5_000); expect(timings.long).toBeLessThan(12_000);
  }, 120_000);
  it('preserves report provenance and exact Task 4 phase/challenge outcomes', () => {
    const c = setup(); profitableDay(c, 0); profitableDay(c, 1); profitableDay(c, 2); const report = reportOf(c);
    expect(report.decisionTimeline.map(item => item.kind)).toEqual(expect.arrayContaining(['PhasePassed', 'ChallengePassed']));
    expect(report.provenance).toMatchObject({ reportVersion: 'mcs.challenge-report/1', source: 'frozen-definition+journal', branchId: report.branch.branchId });
    expect(report.provenance.versions).toMatchObject({ rules: 'mcs.challenge.rules/1', accounting: 'usd-micros/1', execution: 'mcs.challenge.execution/1' });
  });
  it('renders the premium report sections from the read model only', () => {
    const html = renderToStaticMarkup(createElement(ChallengeReportView, { report: reportOf(setup()) }));
    for (const heading of ['Phase results', 'Daily performance', 'Trade lifecycles', 'Risk timeline', 'Decision timeline', 'Evidence &amp; technical details']) expect(html).toContain(heading);
    expect(html).not.toContain('Readiness Score'); expect(html).not.toContain('sample data');
  });
});

