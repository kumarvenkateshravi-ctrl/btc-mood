import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbChallengeReplayRepository } from '../persistence';
import type { ReplayDataset } from '@/lib/replay/replayDataset';
import { createChallengeChartCommands } from './chartCommands';
import { configureChallengeRepository, getChallengeUiSnapshot, restoreChallengeAttempt, startChallengeAttempt, syncChallengeReplayCursor, waitForChallengePersistence } from './store';

const replayDataset: ReplayDataset = Object.freeze({
  active: true,
  symbol: 'BTCUSDT',
  sessionId: 'task6-ui-fixture',
  executionTf: '15m',
  candlesByTf: Object.freeze({
    '15m': Object.freeze(Array.from({ length: 12 }, (_, index) => Object.freeze({
      time: 1_700_000_100 + index * 900,
      open: 60_000 + index * 10,
      high: 60_100 + index * 10,
      low: 59_900 + index * 10,
      close: 60_000 + index * 10,
      volume: 10 + index,
    }))),
  }),
});

const uiFactory = new IDBFactory();
const uiDatabase = 'task7-ui';

describe('Task 6 Challenge UI boundary', () => {
  beforeAll(() => configureChallengeRepository(new IndexedDbChallengeReplayRepository(uiFactory, uiDatabase)));
  it('starts from the frozen BTC replay dataset and exposes only Task 5 read-model state', async () => {
    const started = await startChallengeAttempt({ type: 'twoStep', capital: '10000', replayDataset, startingCursor: 0 });
    expect(started.readModel?.identity.challengeType).toBe('twoStep');
    expect(started.readModel?.identity.health).toBe('SAFE');
    expect(started.readModel?.replay.datasetId).toBe(replayDataset.sessionId);
    expect(started.attempt?.sourceReplaySessionId).toBe(replayDataset.sessionId);
    expect(started.readModel?.progress.phaseNetPnl).toBe(BigInt(0));
    expect(started.readModel?.progress.currentDay).toMatchObject({
      active: false,
      thresholdMet: false,
      finalized: false,
      settledNetPnl: BigInt(0),
    });
  });

  it('routes chart entry and close through the Challenge coordinator', async () => {
    const commands = createChallengeChartCommands();
    const opened = commands.openReplayRisk({
      symbol: 'BTCUSDT',
      side: 'buy',
      mark: 60_000,
      ts: 1_700_000_100,
      replayContext: { barIndex: 0, cutTime: 1_700_000_100 },
    });
    expect(opened.status).toBe('pending');
    await waitForChallengePersistence();
    expect(getChallengeUiSnapshot().readModel?.position?.quantity).toBe('0.01');
    expect(getChallengeUiSnapshot().readModel?.progress.currentDay.active).toBe(true);
    expect(getChallengeUiSnapshot().readModel?.progress.currentDay.finalized).toBe(false);

    const closed = commands.close({
      symbol: 'BTCUSDT',
      mark: 60_000,
      ts: 1_700_000_100,
      replayContext: { barIndex: 0, cutTime: 1_700_000_100 },
    });
    expect(closed.status).toBe('pending');
    await waitForChallengePersistence();
    expect(getChallengeUiSnapshot().readModel?.position).toBeNull();
  });

  it('rebuilds immediately on rewind and marks the active attempt as branched', async () => {
    expect(syncChallengeReplayCursor(replayDataset.sessionId, 2)?.status).toBe('pending');
    await waitForChallengePersistence();
    expect(syncChallengeReplayCursor(replayDataset.sessionId, 1)?.status).toBe('pending');
    await waitForChallengePersistence();
    expect(getChallengeUiSnapshot().attempt?.branched).toBe(true);
    expect(getChallengeUiSnapshot().readModel?.replay.cursor).toBe(1);
  });

  it('publishes RESTORING before atomically attaching the reloaded dashboard read model', async () => {
    const challengeId = String(getChallengeUiSnapshot().readModel?.identity.challengeId);
    configureChallengeRepository(new IndexedDbChallengeReplayRepository(uiFactory, uiDatabase));
    const restoring = restoreChallengeAttempt(challengeId);
    expect(getChallengeUiSnapshot()).toMatchObject({ recovery: 'RESTORING', readModel: null });
    expect(await restoring).toBe(true);
    expect(getChallengeUiSnapshot().recovery).toBe('READY');
    expect(getChallengeUiSnapshot().readModel?.identity.challengeId).toBe(challengeId);
    expect(getChallengeUiSnapshot().readModel?.replay.cursor).toBe(1);
  });
  it('preserves the premium risk-first presentation contract without fake history', () => {
    const dashboard = readFileSync('app/challenges/[challengeId]/page.tsx', 'utf8');
    const landing = readFileSync('app/challenges/page.tsx', 'utf8');
    const widget = readFileSync('components/challenges/ChallengeChartWidget.tsx', 'utf8');
    const shell = readFileSync('components/challenges/ChallengeShell.tsx', 'utf8');
    expect(dashboard).toContain('Risk control');
    expect(dashboard).toContain('text-4xl');
    expect(dashboard).toContain('Challenge requirements');
    expect(dashboard).toContain('Current day');
    expect(dashboard).toContain('Used margin');
    expect(dashboard).toContain('Current profit');
    expect(dashboard).toContain('Replay time');
    expect(dashboard).toContain('Target achieved');
    expect(dashboard).not.toContain('phaseStartingCash');
    expect(dashboard).toContain('Challenge failed');
    expect(dashboard).toContain('Challenge passed');
    expect(dashboard).toContain('New replay branch');
    expect(dashboard).toContain('Replay data ended');
    expect(landing).not.toMatch(/sample history|recent challenges|challenge history/i);
    expect(widget).toContain('w-[248px]');
    expect(widget).toContain('absolute left-3 top-3');
    expect(landing).toContain('history.map');
    expect(landing).toContain('/report');
    expect(landing).toContain('>Report</Button>');
    expect(landing).toContain('active && <Link');
    expect(landing).toContain('Created {formatReplayMoment(attempt.createdAt)}');
    expect(landing).toContain('cursor {attempt.activeReplayCursor}');
    expect(landing).toContain('formatReplayMoment(model.replay.logicalTime)');
    expect(shell).toContain("challenge.recovery === 'RESTORING'");
    expect(shell).toContain("DATASET_UNAVAILABLE: 'Dataset unavailable'");
    expect(shell).toContain("UNSUPPORTED_VERSION: 'Unsupported version'");
    expect(shell).toContain("CORRUPT: 'Corrupt attempt'");
  });

  it('keeps responsive composition and explicit non-color status labels', () => {
    const dashboard = readFileSync('app/challenges/[challengeId]/page.tsx', 'utf8');
    expect(dashboard).toContain('lg:grid-cols-2');
    expect(dashboard).toContain("SAFE:");
    expect(dashboard).toContain("WARNING:");
    expect(dashboard).toContain("DANGER:");
    expect(dashboard).toContain("BREACHED:");
    expect(dashboard).toContain('aria-live="polite"');
  });
});




