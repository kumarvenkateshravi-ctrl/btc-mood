import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { utcInstant } from '../domain/calendar';
import { accountId, branchId, challengeId, phaseId, replaySessionId } from '../domain/types';
import { freezeChallengeDefinition, MYCRYPTOSTACK_ONE_STEP_V1, MYCRYPTOSTACK_TWO_STEP_V1 } from '../domain/templates';
import { freezeChallengeReplayDataset, reconstructReplayChallenge, startReplayChallenge, type ChallengeReplayCoordinator, type ChallengeReplayTradingIntent } from '../replay';
import { IndexedDbChallengeReplayRepository } from '../persistence/repository';
import { DurableChallengeReplaySession, persistenceHash, restoreChallenge, stateWitnessHash } from '../persistence/session';
import { loadChallengeReportWithReadiness } from '../readiness/service';

const START = Number(utcInstant(2026, 1, 1)) / 1000;

function releaseCoordinator(count: number, suffix: string): ChallengeReplayCoordinator {
  const candles = Array.from({ length: count }, (_, index) => ({
    time: START + index * 300,
    open: 10_000 + (index % 7), high: 10_010 + (index % 7),
    low: 9_990 + (index % 7), close: 10_000 + (index % 7), volume: 1,
  }));
  const dataset = freezeChallengeReplayDataset({
    datasetId: `task10-dataset-${suffix}`, symbol: 'BTCUSDT', executionTimeframe: '5m', candles,
  });
  const definition = freezeChallengeDefinition({
    template: MYCRYPTOSTACK_ONE_STEP_V1, selectedCapital: '10000', selectedSymbol: 'BTCUSDT', mode: 'replay',
  });
  return startReplayChallenge({
    frozenDefinition: definition, selectedPhase: phaseId('phase-1'), dataset,
    executionTimeframe: '5m', startingCursor: 0,
    identities: {
      challengeId: challengeId(`challenge-task10-${suffix}`), accountId: accountId(`account-task10-${suffix}`),
      phaseId: phaseId('phase-1'), replaySessionId: replaySessionId(`replay-task10-${suffix}`),
      branchId: branchId(`branch-task10-${suffix}`), generation: 0,
    },
  });
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, (_key, field) => typeof field === 'bigint' ? field.toString() : field));
}

let acceptanceSerial = 0;
function acceptanceCoordinator(kind: 'one' | 'two', prices?: (index: number) => number): ChallengeReplayCoordinator {
  const suffix = `acceptance-${++acceptanceSerial}`;
  const candles = Array.from({ length: 12 }, (_, index) => {
    const price = prices?.(index) ?? 10_000;
    return { time: START + index * 86_400, open: price, high: price, low: price, close: price, volume: 1 };
  });
  const dataset = freezeChallengeReplayDataset({ datasetId: `dataset-${suffix}`, symbol: 'BTCUSDT', executionTimeframe: '1d', candles });
  const definition = freezeChallengeDefinition({
    template: kind === 'one' ? MYCRYPTOSTACK_ONE_STEP_V1 : MYCRYPTOSTACK_TWO_STEP_V1,
    selectedCapital: '10000', selectedSymbol: 'BTCUSDT', mode: 'replay',
  });
  return startReplayChallenge({
    frozenDefinition: definition, selectedPhase: phaseId('phase-1'), dataset, executionTimeframe: '1d', startingCursor: 0,
    identities: { challengeId: challengeId(`challenge-${suffix}`), accountId: accountId(`account-${suffix}`), phaseId: phaseId('phase-1'), replaySessionId: replaySessionId(`replay-${suffix}`), branchId: branchId(`branch-${suffix}`), generation: 0 },
  });
}
function market(side: 'buy' | 'sell', quantity = '1', observedPrice = '10000', protection?: { stopLoss?: string; takeProfit?: string }) {
  return { kind: 'market' as const, side, quantity, observedPrice, leverage: '10', ...(protection ? { protection } : {}) };
}
async function durableApply(session: DurableChallengeReplaySession, operation: { kind: 'trade'; intent: ChallengeReplayTradingIntent } | { kind: 'advance'; cursor: number }, id: string) {
  return session.apply(operation, id);
}
async function profitableDay(session: DurableChallengeReplaySession, cursor: number, prefix: string, exitPrice = '10400') {
  if (session.coordinator.getSnapshot().cursor < cursor) await durableApply(session, { kind: 'advance', cursor }, `${prefix}-advance`);
  await durableApply(session, { kind: 'trade', intent: market('buy') }, `${prefix}-entry`);
  await durableApply(session, { kind: 'trade', intent: { kind: 'closeFull', observedPrice: exitPrice } }, `${prefix}-exit`);
  await durableApply(session, { kind: 'advance', cursor: cursor + 1 }, `${prefix}-boundary`);
}

describe('Task 10 release gate', () => {
  it('reconciles a fee-complete One-Step PASS across persistence, full reconstruction, report and readiness', async () => {
    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task10-one-pass-${acceptanceSerial}`);
    const session = await DurableChallengeReplaySession.create(repository, acceptanceCoordinator('one'), 'owner-pass');
    await durableApply(session, { kind: 'trade', intent: market('buy', '1', '10000', { stopLoss: '9000', takeProfit: '12000' }) }, 'd0-entry');
    await durableApply(session, { kind: 'trade', intent: { kind: 'closePartial', quantity: '0.4', observedPrice: '10100' } }, 'd0-partial');
    expect(session.coordinator.getSnapshot().readModel.position?.quantity).toBe('0.6');
    await durableApply(session, { kind: 'trade', intent: { kind: 'closeFull', observedPrice: '10400' } }, 'd0-close');
    await durableApply(session, { kind: 'advance', cursor: 1 }, 'd0-boundary');
    await profitableDay(session, 1, 'd1');
    await profitableDay(session, 2, 'd2');

    const before = session.coordinator.getSnapshot();
    expect(before.readModel.identity.status).toBe('PASSED');
    expect(before.readModel.position).toBeNull();
    expect(before.readModel.workingOrders).toHaveLength(0);
    expect(before.readModel.progress).toMatchObject({ activeDaysCompleted: 3, profitableDaysCompleted: 3, targetReached: true });
    expect(before.account.cashBalance).toBe(before.account.phaseStartingCash + before.account.realizedGrossPnl - before.account.totalCommissions + before.account.cumulativeCapitalAdjustments);

    const restored = await restoreChallenge(repository, String(before.lifecycle.challengeId));
    const full = reconstructReplayChallenge(session.coordinator.exportJournal()).snapshot;
    expect(stateWitnessHash(restored.coordinator.getSnapshot())).toBe(stateWitnessHash(before));
    expect(stateWitnessHash(full)).toBe(stateWitnessHash(before));
    const first = await loadChallengeReportWithReadiness(repository, String(before.lifecycle.challengeId));
    const second = await loadChallengeReportWithReadiness(repository, String(before.lifecycle.challengeId));
    expect(first.report.summary.currentCash).toBe(before.account.cashBalance);
    expect(first.report.summary.fees).toBe(before.account.totalCommissions);
    expect(first.report.trades[0].fills.map(fill => fill.quantity)).toEqual(['1', '0.4', '0.6']);
    expect(persistenceHash(first.report)).toBe(persistenceHash(second.report));
    expect(persistenceHash(first.readiness)).toBe(persistenceHash(second.readiness));
  });

  it('keeps a One-Step hard failure terminal while replay navigation, report and readiness use the same evidence', async () => {
    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task10-one-fail-${acceptanceSerial}`);
    const session = await DurableChallengeReplaySession.create(repository, acceptanceCoordinator('one', index => index === 1 ? 9580 : index === 2 ? 9510 : index === 3 ? 9480 : 10000), 'owner-fail');
    await durableApply(session, { kind: 'trade', intent: market('buy') }, 'fail-entry');
    await durableApply(session, { kind: 'advance', cursor: 3 }, 'fail-breach');
    const failed = session.coordinator.getSnapshot();
    expect(failed.readModel.identity.status).toBe('FAILED');
    expect(failed.lifecycle.decisions.map(item => item.kind)).toEqual(expect.arrayContaining(['WarningRaised', 'DangerRaised', 'BreachRecorded', 'ChallengeFailed']));
    const blocked = await durableApply(session, { kind: 'trade', intent: market('buy', '0.1', '9480') }, 'blocked-after-fail');
    expect(blocked.status).toBe('rejected');
    await durableApply(session, { kind: 'advance', cursor: 4 }, 'navigate-after-fail');
    expect(session.coordinator.getSnapshot().cursor).toBe(4);
    expect(session.coordinator.getSnapshot().readModel.identity.status).toBe('FAILED');
    const restored = await restoreChallenge(repository, String(failed.lifecycle.challengeId));
    const loaded = await loadChallengeReportWithReadiness(repository, String(failed.lifecycle.challengeId));
    expect(restored.coordinator.getSnapshot().readModel.lifecycle.terminalBreachEvidence).toEqual(failed.readModel.lifecycle.terminalBreachEvidence);
    expect(loaded.report.failureAnalysis?.primaryBreach.evidenceId).toBe(failed.readModel.lifecycle.terminalBreachEvidence?.evidenceId);
    expect(loaded.readiness.provenance.reportHash).toBe(persistenceHash(loaded.report));
  });

  it('completes Two-Step with isolated phase economics and fails deterministically in Phase 2', async () => {
    const passingRepository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task10-two-pass-${acceptanceSerial}`);
    const passing = await DurableChallengeReplaySession.create(passingRepository, acceptanceCoordinator('two'), 'owner-two-pass');
    for (let day = 0; day < 6; day += 1) await profitableDay(passing, day, `two-pass-${day}`);
    const passed = passing.coordinator.getSnapshot();
    expect(passed.readModel.identity.status).toBe('PASSED');
    expect(passed.lifecycle.phases.map(item => item.status)).toEqual(['PASSED', 'PASSED']);
    const passedReport = (await loadChallengeReportWithReadiness(passingRepository, String(passed.lifecycle.challengeId))).report;
    expect(passedReport.phases).toHaveLength(2);
    expect(passedReport.phases[0].startingCash).toBe(passedReport.phases[1].startingCash);
    expect(passedReport.phases[0].activeDays[0]).toBe(3);
    expect(passedReport.phases[1].activeDays[0]).toBe(3);

    const failingRepository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task10-two-fail-${acceptanceSerial}`);
    const failing = await DurableChallengeReplaySession.create(failingRepository, acceptanceCoordinator('two', index => index === 4 ? 9700 : 10000), 'owner-two-fail');
    for (let day = 0; day < 3; day += 1) await profitableDay(failing, day, `two-phase1-${day}`);
    expect(failing.coordinator.getSnapshot().readModel.identity.currentPhaseId).toBe('phase-2');
    expect(failing.coordinator.getSnapshot().account).toMatchObject({ cashBalance: BigInt(10_000_000_000), totalCommissions: BigInt(0), realizedGrossPnl: BigInt(0) });
    expect(failing.coordinator.getSnapshot().readModel.progress).toMatchObject({ activeDaysCompleted: 0, profitableDaysCompleted: 0 });
    await durableApply(failing, { kind: 'trade', intent: { ...market('buy'), quantity: '5', leverage: '20' } }, 'phase2-entry');
    await durableApply(failing, { kind: 'advance', cursor: 4 }, 'phase2-breach');
    expect(failing.coordinator.getSnapshot().readModel.identity.status).toBe('FAILED');
    const restored = await restoreChallenge(failingRepository, String(failing.coordinator.getSnapshot().lifecycle.challengeId));
    expect(stateWitnessHash(restored.coordinator.getSnapshot())).toBe(stateWitnessHash(failing.coordinator.getSnapshot()));
  });

  it('persists dataset exhaustion without fabricating a boundary or terminal result', async () => {
    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task10-exhausted-${acceptanceSerial}`);
    const session = await DurableChallengeReplaySession.create(repository, acceptanceCoordinator('one'), 'owner-exhausted');
    await durableApply(session, { kind: 'advance', cursor: 99 }, 'exhaust');
    const before = session.coordinator.getSnapshot();
    expect(before.readModel.replay.availability).toBe('DATASET_EXHAUSTED');
    expect(before.readModel.identity.status).toBe('ACTIVE');
    expect(before.account.closedDays).toHaveLength(11);
    const restored = await restoreChallenge(repository, String(before.lifecycle.challengeId));
    const loaded = await loadChallengeReportWithReadiness(repository, String(before.lifecycle.challengeId));
    expect(stateWitnessHash(restored.coordinator.getSnapshot())).toBe(stateWitnessHash(before));
    expect(loaded.report.summary.status).toBe('ACTIVE');
    expect(loaded.report.days.at(-1)?.state).toBe('IN_PROGRESS');
  });

  it('keeps ordinary durable cursor command cycles within the interactive budget', async () => {
    const coordinator = releaseCoordinator(400, 'command-budget');
    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), 'task10-command-budget');
    const session = await DurableChallengeReplaySession.create(repository, coordinator, 'owner-budget');
    const durations: number[] = [];
    for (let cursor = 1; cursor <= 100; cursor += 1) {
      const started = performance.now();
      await session.apply({ kind: 'advance', cursor }, `advance-${cursor}`);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    console.info('TASK10_COMMAND_CYCLE_MS', JSON.stringify({ p50, p95, maximum: durations.at(-1) }));
    expect(p50).toBeLessThan(50);
    expect(p95).toBeLessThan(100);
  }, 30_000);

  it('keeps shipped Challenge copy free of encoding corruption', () => {
    const reportSource = readFileSync('components/challenges/ChallengeReport.tsx', 'utf8');
    expect(reportSource).not.toMatch(/[Ââ�]/u);
  });

  it.each([100, 1_000, 5_000, 20_000])('measures deterministic replay, persistence, report and rewind at %i bars', async (count) => {
    const heapBefore = process.memoryUsage().heapUsed;
    const coordinator = releaseCoordinator(count, String(count));
    const marks = [Math.floor(count * 0.25), Math.floor(count * 0.5), Math.floor(count * 0.75), count - 1];
    const forwardStarted = performance.now();
    for (const cursor of marks) {
      coordinator.advanceTo(coordinator.getContext(), cursor);
      coordinator.trade(coordinator.getContext(), { kind: 'market', side: 'buy', quantity: '0.01', observedPrice: '10000', leverage: '10' });
      coordinator.trade(coordinator.getContext(), { kind: 'closeFull', observedPrice: '10001' });
    }
    const forwardMs = performance.now() - forwardStarted;
    console.info('TASK10_STAGE', count, 'forward', Math.round(forwardMs));

    const repository = new IndexedDbChallengeReplayRepository(new IDBFactory(), `task10-performance-${count}`);
    const createStarted = performance.now();
    const session = await DurableChallengeReplaySession.create(repository, coordinator, 'task10-owner');
    const createMs = performance.now() - createStarted;
    console.info('TASK10_STAGE', count, 'create', Math.round(createMs));
    const beforeHash = stateWitnessHash(session.coordinator.getSnapshot());

    const restoreStarted = performance.now();
    const restored = await restoreChallenge(repository, `challenge-task10-${count}`);
    const restoreMs = performance.now() - restoreStarted;
    console.info('TASK10_STAGE', count, 'restore', Math.round(restoreMs));
    expect(stateWitnessHash(restored.coordinator.getSnapshot())).toBe(beforeHash);

    const reportStarted = performance.now();
    const loaded = await loadChallengeReportWithReadiness(repository, `challenge-task10-${count}`);
    const reportAndReadinessMs = performance.now() - reportStarted;
    console.info('TASK10_STAGE', count, 'report', Math.round(reportAndReadinessMs));
    expect(persistenceHash(loaded.readiness)).toBe(persistenceHash((await loadChallengeReportWithReadiness(repository, `challenge-task10-${count}`)).readiness));

    const persisted = await repository.loadAttempt(`challenge-task10-${count}`);
    const checkpointBytes = byteLength(persisted?.checkpoint);
    const datasetBytes = byteLength(persisted?.dataset);
    const journalBytes = byteLength(persisted?.actions);

    const rewindStarted = performance.now();
    const rewind = await session.apply({ kind: 'advance', cursor: Math.floor(count / 2) }, `rewind-${count}`);
    const rewindMs = performance.now() - rewindStarted;
    expect(rewind.status).toBe('applied');
    expect(session.coordinator.getSnapshot().readModel.replay.generation).toBe(1);

    const measurements = {
      count, forwardMs, createMs, restoreMs,
      reportBuildMs: loaded.reportBuildDurationMs,
      readinessBuildMs: loaded.readinessBuildDurationMs,
      reportAndReadinessMs, rewindMs,
      datasetBytes, journalBytes, checkpointBytes,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    };
    console.info('TASK10_LONG_REPLAY', JSON.stringify(measurements));
    expect(forwardMs).toBeLessThan(60_000);
    expect(createMs).toBeLessThan(60_000);
    expect(restoreMs).toBeLessThan(10_000);
    expect(loaded.readinessBuildDurationMs).toBeLessThan(100);
    expect(reportAndReadinessMs).toBeLessThan(60_000);
    expect(rewindMs).toBeLessThan(60_000);
  }, 180_000);
});
