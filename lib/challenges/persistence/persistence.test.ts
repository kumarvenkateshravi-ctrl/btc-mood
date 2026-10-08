import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { utcInstant } from '../domain/calendar';
import { accountId, branchId, challengeId, phaseId, replaySessionId } from '../domain/types';
import { freezeChallengeDefinition, MYCRYPTOSTACK_ONE_STEP_V1, MYCRYPTOSTACK_TWO_STEP_V1 } from '../domain/templates';
import { freezeChallengeReplayDataset } from '../replay/dataset';
import { startReplayChallenge } from '../replay/coordinator';
import type { ChallengeReplayCoordinator, ChallengeReplayTradingIntent } from '../replay';
import { IndexedDbChallengeReplayRepository } from './repository';
import { DurableChallengeReplaySession, createAttemptBundle, persistenceHash, restoreChallenge, stateWitnessHash } from './session';

const START = Number(utcInstant(2026, 1, 1)) / 1000;
function candles(count = 14, price: number | ((index: number) => number) = 10_000, intervalSeconds = 86_400) {
  return Array.from({ length: count }, (_, index) => {
    const value = typeof price === 'function' ? price(index) : price;
    return { time: START + index * intervalSeconds, open: value, high: value, low: value, close: value, volume: 1 };
  });
}
function coordinator(
  kind: 'one' | 'two' = 'one', id = 'persisted', prices = candles(), executionTimeframe: '1d' | '15m' = '1d',
): ChallengeReplayCoordinator {
  const dataset = freezeChallengeReplayDataset({
    datasetId: 'dataset-' + id, symbol: 'BTCUSDT', executionTimeframe, candles: prices,
  });
  const definition = freezeChallengeDefinition({
    template: kind === 'one' ? MYCRYPTOSTACK_ONE_STEP_V1 : MYCRYPTOSTACK_TWO_STEP_V1,
    selectedCapital: '10000', selectedSymbol: 'BTCUSDT', mode: 'replay',
  });
  return startReplayChallenge({
    frozenDefinition: definition, selectedPhase: phaseId('phase-1'), dataset,
    executionTimeframe, startingCursor: 0,
    identities: {
      challengeId: challengeId('challenge-' + id), accountId: accountId('account-' + id),
      phaseId: phaseId('phase-1'), replaySessionId: replaySessionId('replay-' + id),
      branchId: branchId('branch-' + id), generation: 0,
    },
  });
}
function market(side: 'buy' | 'sell', observedPrice = '10000'): Extract<ChallengeReplayTradingIntent, { kind: 'market' }> {
  return { kind: 'market', side, quantity: '1', observedPrice, leverage: '10' };
}
let serial = 0;
function harness(fault?: (transaction: IDBTransaction) => void) {
  const factory = new IDBFactory();
  const repository = new IndexedDbChallengeReplayRepository(factory, 'challenge-task7-' + ++serial, fault);
  return { factory, repository };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Corruption tests intentionally mutate untyped IndexedDB records.
async function rawUpdate(factory: IDBFactory, name: string, store: string, key: IDBValidKey, update: (value: any) => any) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open(name); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = () => transaction.objectStore(store).put(update(request.result));
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function rawDelete(factory: IDBFactory, name: string, store: string, key: IDBValidKey) {
  const database = await new Promise<IDBDatabase>((resolve) => {
    const opening = factory.open(name); opening.onsuccess = () => resolve(opening.result);
  });
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).delete(key); transaction.oncomplete = () => resolve();
  });
  database.close();
}
async function create(kind: 'one' | 'two' = 'one', id = 'base', h = harness()) {
  const session = await DurableChallengeReplaySession.create(h.repository, coordinator(kind, id), 'owner-a');
  return { ...h, session, id: 'challenge-' + id };
}
async function apply(session: DurableChallengeReplaySession, operation: Parameters<DurableChallengeReplaySession['apply']>[0], id: string) {
  return session.apply(operation, id);
}
async function profitableDay(
  session: DurableChallengeReplaySession,
  cursor: number,
  prefix: string,
  exitPrice = '10400',
) {
  if (session.coordinator.getSnapshot().cursor < cursor) await apply(session, { kind: 'advance', cursor }, prefix + '-advance');
  await apply(session, { kind: 'trade', intent: market('buy', '10000') }, prefix + '-entry');
  await apply(session, { kind: 'trade', intent: { kind: 'closeFull', observedPrice: exitPrice } }, prefix + '-exit');
}

describe('Task 7 IndexedDB Challenge durability', () => {
  beforeEach(() => { serial += 1; });

  it('creates, lists, queries and loads a source-of-truth attempt bundle', async () => {
    const { repository, session, id } = await create();
    expect((await repository.listChallengeAttempts()).map((value) => value.challengeId)).toEqual([id]);
    expect((await repository.getActiveAttempts()).map((value) => value.challengeId)).toEqual([id]);
    expect((await repository.getChallengeAttempt(id))?.definitionHash).toBe(session.coordinator.getSnapshot().definition.definitionHash);
    expect((await repository.getActiveBranch(id))?.active).toBe(true);
    expect((await repository.loadCheckpoint(id, String(session.coordinator.getContext().branchId)))?.ledgerHash).toBeTruthy();
  });

  it('reconstructs One-Step cash, rules, active/profitable days and warnings exactly', async () => {
    const { repository, session, id } = await create('one', 'rules');
    await profitableDay(session, 0, 'd0');
    await apply(session, { kind: 'advance', cursor: 1 }, 'boundary');
    const before = session.coordinator.getSnapshot();
    const restored = await restoreChallenge(repository, id);
    expect(persistenceHash(restored.coordinator.getSnapshot().readModel)).toBe(persistenceHash(before.readModel));
    expect(restored.coordinator.getSnapshot().readModel.progress.activeDaysCompleted).toBe(1);
    expect(restored.coordinator.getSnapshot().readModel.progress.profitableDaysCompleted).toBe(1);
    expect(restored.coordinator.getSnapshot().account.totalCommissions).toBe(before.account.totalCommissions);
  });

  it('persists an accepted command incrementally and retries its operation id idempotently', async () => {
    const { repository, session, id } = await create('one', 'idempotent');
    const first = await apply(session, { kind: 'trade', intent: market('buy') }, 'same-command');
    const fees = session.coordinator.getSnapshot().account.totalCommissions;
    const second = await apply(session, { kind: 'trade', intent: market('buy') }, 'same-command');
    expect(first.status).toBe('applied'); expect(second.status).toBe('applied');
    expect(session.coordinator.getSnapshot().account.totalCommissions).toBe(fees);
    expect((await repository.loadJournal(id, String(session.coordinator.getContext().branchId))).length).toBe(1);
  });

  it('atomically loses neither half of a command when a crash aborts after journal staging', async () => {
    let abort = false;
    const h = harness((transaction) => { if (abort) transaction.abort(); });
    const { session, repository, id } = await create('one', 'crash', h);
    abort = true;
    await expect(apply(session, { kind: 'trade', intent: market('buy') }, 'crash-command')).rejects.toBeTruthy();
    const restored = await restoreChallenge(repository, id);
    expect(restored.coordinator.getSnapshot().actions).toHaveLength(0);
    expect(restored.coordinator.getSnapshot().account.totalCommissions).toBe(BigInt(0));
  });

  it('discards a corrupt checkpoint cache and rebuilds from the canonical journal', async () => {
    const { factory, repository, session, id } = await create('one', 'checkpoint');
    const branchId = String(session.coordinator.getContext().branchId);
    const key = id + '|' + branchId + '|latest';
    await rawUpdate(factory, repository.databaseName, 'checkpoints', key, (value) => ({ ...value, checkpointHash: 'bad' }));
    const restored = await restoreChallenge(repository, id);
    expect(restored.recovered).toBe(true);
    expect(restored.warnings[0]).toMatch(/checkpoint/i);
    expect(await repository.loadCheckpoint(id, branchId)).toBeNull();
  });

  it.each([
    ['definition', 'definitionHash', 'bad-definition', 'CORRUPT'],
    ['version', 'versions', null, 'UNSUPPORTED_VERSION'],
    ['malformed', 'status', 'UNKNOWN', 'CORRUPT'],
  ])('rejects %s corruption explicitly', async (_name, field, value, code) => {
    const { factory, repository, id } = await create('one', String(_name));
    await rawUpdate(factory, repository.databaseName, 'attempts', id, (attempt) => ({
      ...attempt, [field]: field === 'versions' ? { ...attempt.versions, persistence: 'future/9' } : value,
    }));
    await expect(restoreChallenge(repository, id)).rejects.toMatchObject({ code });
  });

  it('returns DATASET_UNAVAILABLE instead of substituting replay data', async () => {
    const { factory, repository, id } = await create('one', 'missing-data');
    const attempt = await repository.getChallengeAttempt(id);
    await rawDelete(factory, repository.databaseName, 'datasets', attempt!.datasetHash);
    await expect(restoreChallenge(repository, id)).rejects.toMatchObject({ code: 'DATASET_UNAVAILABLE' });
  });

  it('detects changed dataset content, missing sequence, duplicate sequence and branch mismatch', async () => {
    const a = await create('one', 'changed-data');
    const attempt = await a.repository.getChallengeAttempt(a.id);
    await rawUpdate(a.factory, a.repository.databaseName, 'datasets', attempt!.datasetHash, (dataset) => ({
      ...dataset, candles: dataset.candles.map((
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- This fixture deliberately corrupts persisted dataset bytes.
        candle: any, index: number,
      ) => index ? candle : { ...candle, close: candle.close + 1 }),
    }));
    await expect(restoreChallenge(a.repository, a.id)).rejects.toMatchObject({ code: 'CORRUPT' });

    const b = await create('one', 'sequence');
    await apply(b.session, { kind: 'trade', intent: market('buy') }, 'entry');
    await apply(b.session, { kind: 'trade', intent: { kind: 'closeFull', observedPrice: '10100' } }, 'close');
    const branchId = String(b.session.coordinator.getContext().branchId);
    const rows = await b.repository.loadJournal(b.id, branchId);
    await rawUpdate(b.factory, b.repository.databaseName, 'actions', rows[1].actionKey, (row) => ({ ...row, sequence: 1 }));
    await expect(restoreChallenge(b.repository, b.id)).rejects.toMatchObject({ code: 'CORRUPT' });
    await rawDelete(b.factory, b.repository.databaseName, 'actions', rows[0].actionKey);
    await expect(restoreChallenge(b.repository, b.id)).rejects.toMatchObject({ code: 'CORRUPT' });

    const c = await create('one', 'branch-mismatch');
    const branch = await c.repository.getActiveBranch(c.id);
    await rawUpdate(c.factory, c.repository.databaseName, 'branches', branch!.branchKey, (value) => ({ ...value, branchId: 'other' }));
    await expect(restoreChallenge(c.repository, c.id)).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('recovers a stale attempt head from the latest atomic commit', async () => {
    const { factory, repository, session, id } = await create('one', 'stale-head');
    await apply(session, { kind: 'trade', intent: market('buy') }, 'entry');
    await rawUpdate(factory, repository.databaseName, 'attempts', id, (attempt) => ({
      ...attempt, revision: 0, activeReplayCursor: 0, latestCommitKey: id + '|0',
    }));
    const restored = await restoreChallenge(repository, id);
    expect(restored.recovered).toBe(true);
    expect(restored.attempt.revision).toBe(1);
    expect(restored.coordinator.getSnapshot().actions).toHaveLength(1);
  });

  it('prevents concurrent tabs, expired owners and stale revisions from silently writing', async () => {
    const { factory, repository, session, id } = await create('one', 'tabs');
    expect(await repository.claimLease(id, 'owner-b', Date.now(), 8_000)).toBe(false);
    await repository.releaseLease(id, 'owner-a');
    const reader = await DurableChallengeReplaySession.restore(repository, id, 'owner-b');
    expect(reader.readOnly).toBe(false);
    await expect(apply(session, { kind: 'trade', intent: market('buy') }, 'stale-owner')).rejects.toMatchObject({ code: 'LEASE_CONFLICT' });
    await rawUpdate(factory, repository.databaseName, 'attempts', id, (attempt) => ({ ...attempt, revision: attempt.revision + 1 }));
    await expect(apply(reader, { kind: 'trade', intent: market('buy') }, 'stale-revision')).rejects.toMatchObject({ code: 'STALE_WRITER' });
  });

  it('persists failed terminal evidence and reproduces it immutably', async () => {
    const prices = candles(10, (index) => index === 1 ? 9700 : 10000);
    const h = harness(); const initial = coordinator('one', 'failed', prices);
    const session = await DurableChallengeReplaySession.create(h.repository, initial, 'owner-a');
    await apply(session, { kind: 'trade', intent: { ...market('buy'), quantity: '5', leverage: '20' } }, 'entry');
    await apply(session, { kind: 'advance', cursor: 1 }, 'breach');
    expect(session.coordinator.getSnapshot().readModel.identity.status).toBe('FAILED');
    const restored = await restoreChallenge(h.repository, 'challenge-failed');
    expect(restored.coordinator.getSnapshot().readModel.lifecycle.terminalBreachEvidence)
      .toEqual(session.coordinator.getSnapshot().readModel.lifecycle.terminalBreachEvidence);
    expect(restored.branch.terminalResult?.status).toBe('FAILED');
    expect(restored.coordinator.getSnapshot().lifecycle.decisions.filter((item) => item.kind === 'PhaseFailed')).toHaveLength(1);
    expect(restored.coordinator.getSnapshot().lifecycle.decisions.filter((item) => item.kind === 'ChallengeFailed')).toHaveLength(1);
  });

  it('persists ChallengePassed without duplicate days, fees or decisions after reload', async () => {
    const { repository, session, id } = await create('one', 'passed');
    for (let day = 0; day < 3; day += 1) {
      await profitableDay(session, day, 'pass-' + day);
      await apply(session, { kind: 'advance', cursor: day + 1 }, 'close-day-' + day);
    }
    const before = session.coordinator.getSnapshot();
    expect(before.readModel.identity.status).toBe('PASSED');
    const restored = await restoreChallenge(repository, id);
    const after = restored.coordinator.getSnapshot();
    expect(after.readModel.identity.status).toBe('PASSED');
    expect(after.account.totalCommissions).toBe(before.account.totalCommissions);
    expect(after.readModel.progress.activeDaysCompleted).toBe(before.readModel.progress.activeDaysCompleted);
    expect(after.lifecycle.decisions.filter((item) => item.kind === 'PhasePassed')).toHaveLength(1);
    expect(after.lifecycle.decisions.filter((item) => item.kind === 'ChallengePassed')).toHaveLength(1);
    expect(restored.branch.terminalResult?.resultHash).toBeTruthy();
  });

  it('restores the Phase 1 pass boundary and later Phase 2 with fresh economics', async () => {
    const { repository, session, id } = await create('two', 'two-step');
    for (let day = 0; day < 3; day += 1) {
      await profitableDay(session, day, 'two-' + day, '10031');
      await apply(session, { kind: 'advance', cursor: day + 1 }, 'two-boundary-' + day);
    }
    await profitableDay(session, 3, 'two-target', '11000');
    expect(session.coordinator.getSnapshot().pendingPhaseTransition).toBe(true);
    const boundary = await restoreChallenge(repository, id);
    expect(boundary.coordinator.getSnapshot().pendingPhaseTransition).toBe(true);
    await apply(session, { kind: 'advance', cursor: 4 }, 'phase-two');
    const restored = await restoreChallenge(repository, id);
    expect(restored.coordinator.getSnapshot().readModel.identity.currentPhaseId).toBe('phase-2');
    expect(restored.coordinator.getSnapshot().account.cashBalance).toBe(BigInt(10_000_000_000));
    expect(restored.phases.find((phase) => phase.phaseId === 'phase-1')?.terminalResult?.status).toBe('PASSED');
  });

  it('persists rewind branches, restores only the active prefix, and retains failed history', async () => {
    const prices = candles(10, (index) => index === 1 ? 9700 : 10000);
    const h = harness(); const session = await DurableChallengeReplaySession.create(h.repository, coordinator('one', 'rewind', prices), 'owner-a');
    await apply(session, { kind: 'trade', intent: { ...market('buy'), quantity: '5', leverage: '20' } }, 'entry');
    await apply(session, { kind: 'advance', cursor: 1 }, 'failed');
    const failedBranch = String(session.coordinator.getContext().branchId);
    await apply(session, { kind: 'advance', cursor: 0 }, 'rewind');
    const activeBranch = String(session.coordinator.getContext().branchId);
    expect(activeBranch).not.toBe(failedBranch);
    expect((await h.repository.loadBranch('challenge-rewind', failedBranch))?.terminalResult?.status).toBe('FAILED');
    expect((await h.repository.getActiveBranch('challenge-rewind'))?.branchId).toBe(activeBranch);
    const restored = await restoreChallenge(h.repository, 'challenge-rewind');
    expect(restored.coordinator.getSnapshot().cursor).toBe(0);
    expect(restored.coordinator.getSnapshot().readModel.identity.status).toBe('ACTIVE');
    expect(restored.coordinator.getSnapshot().actions.every((action) => action.cursor <= 0)).toBe(true);
  });

  it('create bundle retains exact version, dataset, checkpoint and immutable source identities', () => {
    const value = coordinator('one', 'bundle');
    const bundle = createAttemptBundle(value, 123);
    expect(bundle.attempt.schemaVersion).toBe(1);
    expect(bundle.attempt.versions.persistence).toBe('mcs.challenge.persistence/1');
    expect(bundle.dataset.datasetHash).toBe(bundle.attempt.datasetHash);
    expect(bundle.checkpoint.definitionHash).toBe(bundle.attempt.definitionHash);
    expect(bundle.branch.identities.challengeId).toBe(bundle.attempt.challengeId);
  });
  it('persists the complete Task 5 command surface and reconstructs the same state', async () => {
    const { repository, session, id } = await create('one', 'command-surface');
    await apply(session, { kind: 'trade', intent: market('buy') }, 'open');
    await apply(session, { kind: 'trade', intent: {
      kind: 'updateProtection', update: { stopLoss: '9900', takeProfit: '10200' },
    } }, 'protect');
    await apply(session, { kind: 'trade', intent: {
      kind: 'updateProtection', update: { trailingEnabled: true },
    } }, 'trail');
    await apply(session, { kind: 'trade', intent: {
      kind: 'closePartial', quantity: '0.4', observedPrice: '10000',
    } }, 'partial');
    expect(session.coordinator.getSnapshot().readModel.position?.quantity).toBe('0.6');
    await apply(session, { kind: 'trade', intent: { kind: 'closeFull', observedPrice: '10000' } }, 'flat');
    await apply(session, { kind: 'trade', intent: {
      kind: 'placeWorkingEntry', side: 'buy', orderType: 'limit', quantity: '0.1',
      triggerPrice: '9900', leverage: '10',
    } }, 'working');
    const orderId = session.coordinator.getSnapshot().execution.workingOrders[0].orderId;
    await apply(session, { kind: 'trade', intent: { kind: 'cancelWorkingOrder', orderId } }, 'cancel');
    const before = session.coordinator.getSnapshot();
    const restored = await restoreChallenge(repository, id);
    expect(await repository.loadJournal(id, String(before.readModel.replay.branchId))).toHaveLength(7);
    expect(stateWitnessHash(restored.coordinator.getSnapshot())).toBe(stateWitnessHash(before));
    expect(restored.coordinator.getSnapshot().readModel.position).toBeNull();
    expect(restored.coordinator.getSnapshot().execution.workingOrders).toHaveLength(0);
  });

  it('restores an exact warning state and its causal decisions', async () => {
    const prices = candles(10, (index) => index === 1 ? 9930.1 : 10000, 900);
    const h = harness();
    const session = await DurableChallengeReplaySession.create(h.repository, coordinator('one', 'warning', prices, '15m'), 'owner-a');
    await apply(session, { kind: 'trade', intent: { ...market('buy'), quantity: '5', leverage: '20' } }, 'entry');
    await apply(session, { kind: 'advance', cursor: 1 }, 'warning-mark');
    const before = session.coordinator.getSnapshot();
    expect(before.readModel.risk.dailyLoss.status).toBe('WARNING');
    const restored = await restoreChallenge(h.repository, 'challenge-warning');
    expect(restored.coordinator.getSnapshot().readModel.risk.dailyLoss.status).toBe('WARNING');
    expect(restored.coordinator.getSnapshot().lifecycle.decisions).toEqual(before.lifecycle.decisions);
  });

  it('rebuilds from a durable journal when the checkpoint cache is absent', async () => {
    const { factory, repository, session, id } = await create('one', 'missing-checkpoint');
    await apply(session, { kind: 'trade', intent: market('buy') }, 'entry');
    const branch = String(session.coordinator.getContext().branchId);
    await rawDelete(factory, repository.databaseName, 'checkpoints', id + '|' + branch + '|latest');
    const restored = await restoreChallenge(repository, id);
    expect(restored.recovered).toBe(true);
    expect(restored.warnings[0]).toMatch(/checkpoint cache unavailable/i);
    expect(restored.coordinator.getSnapshot().actions).toHaveLength(1);
  });

  it('hydrates a valid older checkpoint and deterministically rebuilds its journal suffix', async () => {
    const { factory, repository, session, id } = await create('one', 'checkpoint-suffix');
    await apply(session, { kind: 'trade', intent: market('buy') }, 'entry');
    const branch = String(session.coordinator.getContext().branchId);
    const older = await repository.loadCheckpoint(id, branch);
    await apply(session, { kind: 'trade', intent: { kind: 'closeFull', observedPrice: '10100' } }, 'close');
    await rawUpdate(factory, repository.databaseName, 'checkpoints', id + '|' + branch + '|latest', () => older);
    const restored = await restoreChallenge(repository, id);
    expect(restored.recovered).toBe(false);
    expect(restored.coordinator.getSnapshot().actions).toHaveLength(2);
    expect(restored.coordinator.getSnapshot().readModel.position).toBeNull();
    expect(restored.coordinator.getSnapshot().account.totalCommissions)
      .toBe(session.coordinator.getSnapshot().account.totalCommissions);
  });
  it('does not fabricate commands when the committed head points beyond the journal', async () => {
    const { factory, repository, session, id } = await create('one', 'head-beyond');
    await apply(session, { kind: 'trade', intent: market('buy') }, 'entry');
    const attempt = await repository.getChallengeAttempt(id);
    await rawUpdate(factory, repository.databaseName, 'commits', attempt!.latestCommitKey, (commit) => ({
      ...commit, actionCount: commit.actionCount + 1,
    }));
    await expect(restoreChallenge(repository, id)).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('queries empty, multiple, active and terminal attempt history without fabricated rows', async () => {
    const h = harness();
    expect(await h.repository.listChallengeAttempts()).toEqual([]);
    await create('one', 'history-active', h);
    const prices = candles(10, (index) => index === 1 ? 9700 : 10000);
    const failed = await DurableChallengeReplaySession.create(h.repository, coordinator('one', 'history-failed', prices), 'owner-b');
    await apply(failed, { kind: 'trade', intent: { ...market('buy'), quantity: '5', leverage: '20' } }, 'entry');
    await apply(failed, { kind: 'advance', cursor: 1 }, 'breach');
    expect(await h.repository.listChallengeAttempts()).toHaveLength(2);
    expect((await h.repository.getActiveAttempts()).map((attempt) => attempt.challengeId)).toEqual(['challenge-history-active']);
    expect((await h.repository.getTerminalAttempts()).map((attempt) => attempt.challengeId)).toEqual(['challenge-history-failed']);
  });

  it('persists dataset exhaustion exactly across reload', async () => {
    const { repository, session, id } = await create('one', 'exhausted');
    await apply(session, { kind: 'advance', cursor: 99 }, 'exhaust');
    expect(session.coordinator.getSnapshot().readModel.replay.availability).toBe('DATASET_EXHAUSTED');
    const restored = await restoreChallenge(repository, id);
    expect(restored.coordinator.getSnapshot().readModel.replay.availability).toBe('DATASET_EXHAUSTED');
    expect(restored.coordinator.getSnapshot().cursor).toBe(session.coordinator.getSnapshot().cursor);
  });

  it('keeps large-attempt restore bounded and records incremental journal/cache sizes', async () => {
    const large = candles(100);
    const h = harness();
    const source = coordinator('one', 'large', large);
    for (let index = 0; index < 20; index += 1) {
      source.trade(source.getContext(), { ...market('buy'), quantity: '0.01' });
      source.trade(source.getContext(), { kind: 'closeFull', observedPrice: '10000' });
    }
    const session = await DurableChallengeReplaySession.create(h.repository, source, 'owner-a');
    await apply(session, { kind: 'advance', cursor: 99 }, 'large-cursor');
    const branch = String(session.coordinator.getContext().branchId);
    const journal = await h.repository.loadJournal('challenge-large', branch);
    const cache = await h.repository.loadCheckpoint('challenge-large', branch);
    const journalBytes = JSON.stringify(journal, (_key, value) => typeof value === 'bigint' ? value.toString() : value).length;
    const checkpointBytes = JSON.stringify(cache, (_key, value) => typeof value === 'bigint' ? value.toString() : value).length;
    const started = performance.now();
    const restored = await restoreChallenge(h.repository, 'challenge-large');
    const restoreMs = performance.now() - started;
    console.info('Task 7 persistence performance', { restoreMs: Math.round(restoreMs), journalBytes, checkpointBytes, candles: large.length, actions: journal.length });
    expect(journal).toHaveLength(40);
    expect(journalBytes).toBeLessThan(250_000);
    expect(checkpointBytes).toBeLessThan(2_000_000);
    expect(restoreMs).toBeLessThan(10_000);
    expect(stateWitnessHash(restored.coordinator.getSnapshot())).toBe(stateWitnessHash(session.coordinator.getSnapshot()));
  }, 20_000);
});











