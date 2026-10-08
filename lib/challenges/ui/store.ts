import { useEffect, useState } from 'react';
import type { PaperPosition } from '@/lib/paper';
import { canonicalHash } from '../domain/versions';
import { accountId, branchId, challengeId, phaseId, replaySessionId, type ChallengeType } from '../domain/types';
import { freezeChallengeDefinition, MYCRYPTOSTACK_ONE_STEP_V1, MYCRYPTOSTACK_TWO_STEP_V1 } from '../domain/templates';
import { freezeChallengeReplayDataset } from '../replay/dataset';
import { startReplayChallenge, type ChallengeReplayCoordinator } from '../replay/coordinator';
import type { ChallengeReplayReadModel, ChallengeReplayTradingIntent } from '../replay/types';
import { captureReplayDataset, type ReplayDataset } from '@/lib/replay/replayDataset';
import { getReplayState, replayActions } from '@/lib/replay/replayState';
import {
  ChallengePersistenceError, DurableChallengeReplaySession, IndexedDbChallengeReplayRepository,
  restoreChallenge, stateWitnessHash, type ChallengeAttemptSummary, type ChallengeReplayRepository,
} from '../persistence';

export type ChallengeRecoveryState = 'IDLE' | 'RESTORING' | 'READY' | 'RECOVERED' | 'ERROR';
export interface ChallengeUiAttempt {
  readonly coordinator: ChallengeReplayCoordinator;
  readonly sourceReplaySessionId: string;
  readonly createdAt: number;
  readonly branched: boolean;
  readonly lastRejection: string | null;
  readonly readOnly: boolean;
}
export interface ChallengeUiSnapshot {
  readonly attempt: ChallengeUiAttempt | null;
  readonly readModel: ChallengeReplayReadModel | null;
  readonly recovery: ChallengeRecoveryState;
  readonly recoveryCode: string | null;
  readonly recoveryMessage: string | null;
  readonly saving: boolean;
  readonly history: readonly ChallengeAttemptSummary[];
}
export type DurableChallengeDispatch =
  | { status: 'pending' }
  | { status: 'rejected'; message: string };

const EMPTY: ChallengeUiSnapshot = Object.freeze({
  attempt: null, readModel: null, recovery: 'IDLE', recoveryCode: null,
  recoveryMessage: null, saving: false, history: [],
});
interface ChallengeUiContainer {
  activeAttempt: ChallengeUiAttempt | null;
  session: DurableChallengeReplaySession | null;
  repository: ChallengeReplayRepository | null;
  snapshot: ChallengeUiSnapshot;
  detachCoordinator: (() => void) | null;
  listeners: Set<() => void>;
  boot: Promise<void> | null;
  ownerId: string;
  recovery: ChallengeRecoveryState;
  recoveryCode: string | null;
  recoveryMessage: string | null;
  history: readonly ChallengeAttemptSummary[];
  saving: boolean;
  operationSequence: number;
  pendingCursor: { sessionId: string; cursor: number } | null;
}
const root = globalThis as typeof globalThis & { __mcsChallengeUiV2?: ChallengeUiContainer };
const container = root.__mcsChallengeUiV2 ??= {
  activeAttempt: null, session: null, repository: null, snapshot: EMPTY,
  detachCoordinator: null, listeners: new Set<() => void>(), boot: null,
  ownerId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'tab:' + canonicalHash({ at: Date.now(), seed: Math.random() }),
  recovery: 'IDLE', recoveryCode: null, recoveryMessage: null, history: [],
  saving: false, operationSequence: 0, pendingCursor: null,
};

function repository(): ChallengeReplayRepository {
  if (!container.repository) container.repository = new IndexedDbChallengeReplayRepository();
  return container.repository;
}
function publish() {
  container.snapshot = Object.freeze({
    attempt: container.activeAttempt,
    readModel: container.activeAttempt?.coordinator.getSnapshot().readModel ?? null,
    recovery: container.recovery, recoveryCode: container.recoveryCode,
    recoveryMessage: container.recoveryMessage, saving: container.saving,
    history: container.history,
  });
  for (const listener of container.listeners) listener();
}
function attach(session: DurableChallengeReplaySession, options?: { createdAt?: number; branched?: boolean; rejection?: string | null }) {
  container.detachCoordinator?.();
  container.session = session;
  container.activeAttempt = Object.freeze({
    coordinator: session.coordinator,
    sourceReplaySessionId: session.coordinator.getSnapshot().dataset.datasetId,
    createdAt: options?.createdAt ?? session.metadata.attempt.createdAt,
    branched: options?.branched ?? session.metadata.branch.parentBranchId != null,
    lastRejection: options?.rejection ?? null,
    readOnly: session.readOnly,
  });
  container.detachCoordinator = session.coordinator.subscribe(publish);
  publish();
}
function errorState(cause: unknown) {
  const error = cause instanceof ChallengePersistenceError ? cause : null;
  container.recovery = 'ERROR';
  container.recoveryCode = error?.code ?? 'CORRUPT';
  container.recoveryMessage = cause instanceof Error ? cause.message : 'Challenge recovery failed.';
  container.activeAttempt = null;
  container.session = null;
  publish();
}
async function refreshHistory(): Promise<void> {
  const attempts = await repository().listChallengeAttempts();
  const summaries = await Promise.all(attempts.map(async (attempt) => {
    try {
      const restored = await restoreChallenge(repository(), attempt.challengeId);
      return {
        challengeId: attempt.challengeId, challengeType: attempt.challengeType,
        selectedCapital: attempt.selectedCapital, currentPhaseId: restored.attempt.currentPhaseId,
        status: restored.attempt.status, createdAt: attempt.createdAt, updatedAt: attempt.updatedAt,
        activeReplayCursor: restored.attempt.activeReplayCursor,
        readModel: restored.coordinator.getSnapshot().readModel,
      } satisfies ChallengeAttemptSummary;
    } catch {
      return {
        challengeId: attempt.challengeId, challengeType: attempt.challengeType,
        selectedCapital: attempt.selectedCapital, currentPhaseId: attempt.currentPhaseId,
        status: attempt.status, createdAt: attempt.createdAt, updatedAt: attempt.updatedAt,
        activeReplayCursor: attempt.activeReplayCursor, readModel: null,
      } satisfies ChallengeAttemptSummary;
    }
  }));
  container.history = summaries;
  publish();
}
export function configureChallengeRepository(next: ChallengeReplayRepository | null): void {
  container.repository = next;
  container.boot = null; container.session = null; container.activeAttempt = null;
  container.detachCoordinator?.(); container.detachCoordinator = null;
  container.recovery = 'IDLE'; container.recoveryCode = null; container.recoveryMessage = null;
  container.history = []; container.saving = false; container.pendingCursor = null;
  publish();
}
export function retryChallengeRecovery(): void {
  container.boot = null;
  container.recovery = 'IDLE';
  container.recoveryCode = null;
  container.recoveryMessage = null;
  void initializePersistentChallenges();
}
export async function initializePersistentChallenges(): Promise<void> {
  if (container.boot) return container.boot;
  container.recovery = 'RESTORING'; container.recoveryCode = null;
  container.recoveryMessage = 'Restoring Challenge'; publish();
  container.boot = (async () => {
    try {
      const attempts = await repository().getActiveAttempts();
      if (attempts[0]) {
        const session = await DurableChallengeReplaySession.restore(repository(), attempts[0].challengeId, container.ownerId);
        container.recovery = session.metadata.recovered ? 'RECOVERED' : 'READY';
        container.recoveryMessage = session.metadata.warnings.join(' ') || null;
        attach(session);
      } else {
        container.recovery = 'READY'; container.recoveryMessage = null; publish();
      }
      await refreshHistory();
    } catch (cause) { errorState(cause); }
  })();
  return container.boot;
}
export async function restoreChallengeAttempt(id: string): Promise<boolean> {
  if (container.activeAttempt?.coordinator.getSnapshot().readModel.identity.challengeId === id) return true;
  container.recovery = 'RESTORING'; container.recoveryMessage = 'Restoring Challenge'; publish();
  try {
    const session = await DurableChallengeReplaySession.restore(repository(), id, container.ownerId);
    container.recovery = session.metadata.recovered ? 'RECOVERED' : 'READY';
    container.recoveryCode = session.readOnly ? 'LEASE_CONFLICT' : null;
    container.recoveryMessage = session.readOnly
      ? 'Another tab owns this Challenge. This tab is read-only.'
      : session.metadata.warnings.join(' ') || null;
    attach(session);
    return true;
  } catch (cause) { errorState(cause); return false; }
}
export function waitForChallengePersistence(): Promise<void> {
  if (!container.saving) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribeChallengeUi(() => {
      if (!container.saving) { unsubscribe(); resolve(); }
    });
  });
}
export function subscribeChallengeUi(listener: () => void): () => void {
  container.listeners.add(listener);
  return () => container.listeners.delete(listener);
}
export function getChallengeUiSnapshot(): ChallengeUiSnapshot { return container.snapshot; }
export function getActiveChallengeAttempt(): ChallengeUiAttempt | null { return container.activeAttempt; }
export function useChallengeUi(): ChallengeUiSnapshot {
  const [, render] = useState(0);
  useEffect(() => subscribeChallengeUi(() => render((revision) => revision + 1)), []);
  return typeof window === 'undefined' ? EMPTY : getChallengeUiSnapshot();
}

export async function startChallengeAttempt(input: {
  type: ChallengeType; capital: string; replayDataset: ReplayDataset; startingCursor: number;
}): Promise<ChallengeUiSnapshot> {
  const executionCandles = input.replayDataset.candlesByTf[input.replayDataset.executionTf] ?? [];
  if (!input.replayDataset.active || input.replayDataset.symbol !== 'BTCUSDT' || executionCandles.length < 2) {
    throw new RangeError('Start BTC Bar Replay with a valid frozen dataset before creating a Challenge.');
  }
  const template = input.type === 'oneStep' ? MYCRYPTOSTACK_ONE_STEP_V1 : MYCRYPTOSTACK_TWO_STEP_V1;
  const definition = freezeChallengeDefinition({ template, selectedCapital: input.capital, selectedSymbol: 'BTCUSDT', mode: 'replay' });
  const dataset = freezeChallengeReplayDataset({
    datasetId: input.replayDataset.sessionId, symbol: 'BTCUSDT',
    executionTimeframe: input.replayDataset.executionTf, candles: executionCandles.slice(),
  });
  const now = Date.now();
  const seed = canonicalHash({ datasetHash: dataset.datasetHash, type: input.type, capital: input.capital, started: now });
  const firstPhase = [...definition.template.phases].sort((a, b) => a.sequence - b.sequence)[0];
  const cursor = Math.max(0, Math.min(executionCandles.length - 1, input.startingCursor));
  const coordinator = startReplayChallenge({
    frozenDefinition: definition, selectedPhase: phaseId(firstPhase.id), dataset,
    executionTimeframe: dataset.executionTimeframe, startingCursor: cursor,
    identities: {
      challengeId: challengeId('challenge:' + seed), accountId: accountId('account:' + seed + ':1'),
      phaseId: phaseId(firstPhase.id), replaySessionId: replaySessionId('replay:' + seed),
      branchId: branchId('branch:' + seed + ':0'), generation: 0,
    },
  });
  const session = await DurableChallengeReplaySession.create(repository(), coordinator, container.ownerId);
  container.recovery = 'READY'; container.recoveryCode = null; container.recoveryMessage = null;
  attach(session);
  await refreshHistory();
  return container.snapshot;
}

function dispatch(
  action: (session: DurableChallengeReplaySession, operationId: string) => Promise<unknown>,
): DurableChallengeDispatch {
  const session = container.session;
  if (!session || !container.activeAttempt) return { status: 'rejected', message: 'No active Challenge Replay attempt.' };
  if (container.activeAttempt.readOnly) return { status: 'rejected', message: 'Another tab owns this Challenge. This tab is read-only.' };
  if (container.saving) return { status: 'rejected', message: 'Challenge state is being durably committed.' };
  container.saving = true; publish();
  const operationId = 'operation:' + String(++container.operationSequence) + ':' + stateWitnessHash(session.coordinator.getSnapshot());
  void action(session, operationId).then((result) => {
    const domain = result as { status?: string; rejection?: { message: string } };
    container.saving = false;
    container.recovery = 'READY';
    attach(session, {
      branched: session.metadata.branch.parentBranchId != null,
      rejection: domain.status === 'rejected' ? domain.rejection?.message ?? 'Challenge command rejected.' : null,
    });
    void refreshHistory();
    const pending = container.pendingCursor;
    container.pendingCursor = null;
    if (pending) syncChallengeReplayCursor(pending.sessionId, pending.cursor);
  }).catch((cause) => {
    container.saving = false;
    if (cause instanceof ChallengePersistenceError &&
        (cause.code === 'LEASE_CONFLICT' || cause.code === 'STALE_WRITER')) {
      container.recoveryCode = cause.code; container.recoveryMessage = cause.message;
      if (container.activeAttempt) container.activeAttempt = Object.freeze({ ...container.activeAttempt, readOnly: true });
      publish();
    } else errorState(cause);
  });
  return { status: 'pending' };
}
export function challengeTrade(intent: ChallengeReplayTradingIntent): DurableChallengeDispatch {
  return dispatch((session, operationId) => session.apply({ kind: 'trade', intent }, operationId));
}
export function syncChallengeReplayCursor(sourceSessionId: string, cursor: number): DurableChallengeDispatch | null {
  if (!container.session || !container.activeAttempt ||
      container.activeAttempt.sourceReplaySessionId !== sourceSessionId) return null;
  const current = container.session.coordinator.getSnapshot().cursor;
  if (cursor === current) return null;
  if (container.saving) {
    container.pendingCursor = { sessionId: sourceSessionId, cursor };
    return { status: 'pending' };
  }
  return dispatch((session, operationId) => session.apply({ kind: 'advance', cursor }, operationId));
}
export function clearChallengeRejection(): void {
  if (!container.activeAttempt?.lastRejection) return;
  container.activeAttempt = Object.freeze({ ...container.activeAttempt, lastRejection: null }); publish();
}
function decimalToNumber(value: string | null): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function challengePositionPresentation(model: ChallengeReplayReadModel): PaperPosition | null {
  const position = model.position;
  if (!position) return null;
  return {
    id: position.positionId, symbol: position.symbol, side: position.side,
    units: Number(position.quantity), entryPrice: Number(position.entryPrice),
    realizedPnl: 0, feesPaid: 0, openedAt: model.replay.logicalTime,
    tp: decimalToNumber(position.protection.takeProfit), sl: decimalToNumber(position.protection.stopLoss),
    liquidated: false, leverage: Number(position.leverage), trailingSl: position.protection.trailingEnabled,
    trailingBest: decimalToNumber(position.protection.trailingBestPrice),
  };
}

export async function resumeChallengeOnChart(requestedChallengeId: string): Promise<boolean> {
  if (!container.activeAttempt ||
      String(container.activeAttempt.coordinator.getSnapshot().readModel.identity.challengeId) !== requestedChallengeId) {
    if (!await restoreChallengeAttempt(requestedChallengeId)) return false;
  }
  const attempt = container.activeAttempt;
  if (!attempt) return false;
  const model = attempt.coordinator.getSnapshot().readModel;
  const frozen = attempt.coordinator.getSnapshot().dataset;
  if (getReplayState().phase !== 'idle') replayActions.exit();
  captureReplayDataset({
    symbol: frozen.symbol, executionTf: frozen.executionTimeframe,
    sessionId: attempt.sourceReplaySessionId,
    candlesByTf: { [frozen.executionTimeframe]: frozen.candles.map((candle) => ({ ...candle })) },
  });
  const candle = frozen.candles[model.replay.cursor];
  replayActions.enterSelecting(); replayActions.startAt(model.replay.cursor, candle.time);
  return true;
}
export interface ChallengeChartSlice {
  sourceReplaySessionId: string | null; challengeId: string | null;
  position: PaperPosition | null; cash: number; startingCash: number;
}
const EMPTY_CHART_SLICE: ChallengeChartSlice = Object.freeze({
  sourceReplaySessionId: null, challengeId: null, position: null, cash: 0, startingCash: 0,
});
function selectChallengeChartSlice(): ChallengeChartSlice {
  const attempt = container.activeAttempt; const model = container.snapshot.readModel;
  if (!attempt || !model) return EMPTY_CHART_SLICE;
  return {
    sourceReplaySessionId: attempt.sourceReplaySessionId, challengeId: String(model.identity.challengeId),
    position: challengePositionPresentation(model),
    cash: Number(model.account.cash) / 1_000_000, startingCash: Number(model.account.startingCash) / 1_000_000,
  };
}
function sameChartSlice(left: ChallengeChartSlice, right: ChallengeChartSlice): boolean {
  return left.sourceReplaySessionId === right.sourceReplaySessionId &&
    left.challengeId === right.challengeId && left.cash === right.cash &&
    left.startingCash === right.startingCash && JSON.stringify(left.position) === JSON.stringify(right.position);
}
export function useChallengeChartSlice(): ChallengeChartSlice {
  const [slice, setSlice] = useState<ChallengeChartSlice>(
    typeof window === 'undefined' ? EMPTY_CHART_SLICE : selectChallengeChartSlice,
  );
  useEffect(() => subscribeChallengeUi(() => {
    const next = selectChallengeChartSlice();
    setSlice((current) => sameChartSlice(current, next) ? current : next);
  }), []);
  return slice;
}
