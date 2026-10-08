import { z } from 'zod';
import { verifyFrozenChallengeDefinition } from '../domain/templates';
import { canonicalHash } from '../domain/versions';
import { moneyFromDecimal } from '../domain/money';
import { EXECUTION_CHECKPOINT_VERSION } from '../accounting/checkpoint';
import { verifyChallengeReplayDataset } from '../replay/dataset';
import { ChallengeReplayCoordinator, reconstructReplayChallenge, reconstructReplayChallengeFromCheckpoint, startReplayChallenge } from '../replay/coordinator';
import type { ChallengeReplayJournal, ChallengeReplaySnapshot, ChallengeReplayStableState, ChallengeReplayTradingIntent, ChallengeReplayOperationResult } from '../replay/types';
import {
  CHALLENGE_PERSISTENCE_SCHEMA, CHALLENGE_PERSISTENCE_VERSION, CHALLENGE_REPLAY_COORDINATOR_VERSION,
  ChallengePersistenceError,
  type ChallengeReplayRepository, type CreateAttemptBundle, type CommitBundle, type LoadedAttempt,
  type PersistedAction, type PersistedAttempt, type PersistedBranch, type PersistedCheckpoint,
  type PersistedCommit, type PersistedPhase, type PersistedTerminalResult, type PersistedVersionSet,
} from './types';

export const CHALLENGE_WRITER_LEASE_MS = 8_000;

export function persistentClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, field) =>
    typeof field === 'bigint' ? { $bigint: field.toString() } : field),
  (_key, field) => {
    if (field && typeof field === 'object' && Object.keys(field).length === 1 &&
        typeof field.$bigint === 'string' && /^-?\d+$/.test(field.$bigint)) return BigInt(field.$bigint);
    return field;
  }) as T;
}
export function persistenceHash(value: unknown): string { return canonicalHash(persistentClone(value)); }

export function versionSet(snapshot: ChallengeReplaySnapshot): PersistedVersionSet {
  return {
    persistence: CHALLENGE_PERSISTENCE_VERSION,
    coordinator: CHALLENGE_REPLAY_COORDINATOR_VERSION,
    template: snapshot.definition.template.templateVersion,
    rules: snapshot.definition.versions.rules,
    execution: snapshot.definition.versions.execution,
    accounting: snapshot.definition.versions.accounting,
    checkpoint: EXECUTION_CHECKPOINT_VERSION,
    instrumentPolicy: snapshot.definition.instrumentPolicy.policyVersion,
  };
}
export function stateWitnessHash(snapshot: ChallengeReplaySnapshot): string {
  return persistenceHash({
    readModel: snapshot.readModel, ledgerHash: snapshot.account.ledgerHash,
    commandSequence: snapshot.commandSequence, pendingPhaseTransition: snapshot.pendingPhaseTransition,
    actionIds: snapshot.actions.map((action) => action.actionId),
    lifecycleDecisions: snapshot.lifecycle.decisions,
    executionPosition: snapshot.execution.position,
    workingOrders: snapshot.execution.workingOrders,
  });
}
function terminal(snapshot: ChallengeReplaySnapshot): PersistedTerminalResult | null {
  const model = snapshot.readModel;
  const status = model.lifecycle.challengeStatus === 'FAILED' ? 'FAILED'
    : model.lifecycle.phaseStatus === 'PASSED' ? 'PASSED' : null;
  if (!status) return null;
  const basis = {
    status, phaseId: String(model.identity.currentPhaseId),
    terminalCheckpointId: model.consistency.stableCheckpointId,
    account: model.account, breachEvidence: model.lifecycle.terminalBreachEvidence,
    progress: model.progress, versions: versionSet(snapshot),
    definitionHash: snapshot.definition.definitionHash, datasetHash: snapshot.dataset.datasetHash,
    branchId: String(model.replay.branchId),
  };
  return persistentClone({ ...basis, resultHash: persistenceHash(basis) }) as PersistedTerminalResult;
}
function phaseRecords(snapshot: ChallengeReplaySnapshot, prior: readonly PersistedPhase[] = []): PersistedPhase[] {
  const model = snapshot.readModel;
  const branchKey = String(model.identity.challengeId) + '|' + model.replay.branchId;
  return snapshot.lifecycle.phases.filter((phase) => phase.accountId != null).map((phase) => {
    const existing = prior.find((item) => item.phaseId === phase.phaseId);
    const isCurrent = phase.phaseId === model.identity.currentPhaseId;
    const result = isCurrent ? terminal(snapshot) : existing?.terminalResult ?? null;
    return {
      phaseKey: branchKey + '|' + phase.phaseId, branchKey,
      challengeId: String(model.identity.challengeId), branchId: String(model.replay.branchId),
      phaseId: String(phase.phaseId), accountId: String(phase.accountId), sequence: phase.sequence,
      status: phase.status, startingCapital: moneyFromDecimal(snapshot.definition.selectedCapital),
      journalBranchKey: branchKey, checkpointKey: branchKey + '|latest',
      startCursor: existing?.startCursor ?? snapshot.cursor,
      terminalCursor: existing?.terminalCursor ?? (result ? snapshot.cursor : null),
      terminalResult: existing?.terminalResult ?? result,
    };
  });
}
function coordinatorState(snapshot: ChallengeReplaySnapshot): ChallengeReplayStableState {
  return persistentClone({
    execution: snapshot.execution,
    account: snapshot.account,
    lifecycle: snapshot.lifecycle,
    cursor: snapshot.cursor,
    logicalTime: snapshot.logicalTime,
    commandSequence: snapshot.commandSequence,
    availability: snapshot.availability,
    pendingPhaseTransition: snapshot.pendingPhaseTransition,
    actions: snapshot.actions,
  });
}
function checkpoint(snapshot: ChallengeReplaySnapshot): PersistedCheckpoint {
  const stable = snapshot.account.lastStableCheckpoint;
  if (!stable) throw new ChallengePersistenceError('CORRUPT', 'A stable Challenge checkpoint is required.');
  const branchKey = String(snapshot.account.challengeId) + '|' + snapshot.readModel.replay.branchId;
  const cachedState = coordinatorState(snapshot);
  const basis = {
    checkpointKey: branchKey + '|latest', branchKey, challengeId: String(snapshot.account.challengeId),
    branchId: String(snapshot.readModel.replay.branchId), checkpointId: String(stable.checkpointId),
    commandId: stable.commandId == null ? null : String(stable.commandId),
    factRange: [stable.firstFactSequence, stable.lastFactSequence] as const,
    accountRevision: stable.stableAccountRevision, ledgerHash: stable.stableLedgerHash,
    definitionHash: snapshot.definition.definitionHash, scope: snapshot.account.scope,
    versions: versionSet(snapshot), occurredAt: stable.occurredAt, checkpoint: stable,
    coordinatorState: cachedState,
    coordinatorStateHash: persistenceHash(cachedState),
    cursor: snapshot.cursor,
    actionCount: snapshot.actions.length,
  };
  return persistentClone({ ...basis, checkpointHash: persistenceHash(basis) });
}
function actionRow(snapshot: ChallengeReplaySnapshot, sequence: number): PersistedAction {
  const action = snapshot.actions[sequence - 1];
  const branchKey = String(snapshot.account.challengeId) + '|' + snapshot.readModel.replay.branchId;
  const basis = {
    actionKey: branchKey + '|' + String(sequence).padStart(12, '0'),
    branchKey, challengeId: String(snapshot.account.challengeId), branchId: String(snapshot.readModel.replay.branchId),
    sequence, actionId: action.actionId,
    commandId: snapshot.account.lastStableCheckpoint?.commandId == null ? null : String(snapshot.account.lastStableCheckpoint.commandId),
    phaseId: String(snapshot.account.phaseId), accountId: String(snapshot.account.accountId),
    generation: snapshot.account.generation, cursor: action.cursor, occurredAt: action.occurredAt,
    payloadVersion: 1 as const, action,
  };
  return persistentClone({ ...basis, actionHash: persistenceHash(basis) });
}

/** Replays only public Task 5 inputs; gathers phase-terminal evidence before Phase 2 resets. */
function replayEvidence(journal: ChallengeReplayJournal) {
  const coordinator = startReplayChallenge({
    frozenDefinition: journal.definition, selectedPhase: journal.identities.phaseId,
    dataset: journal.dataset, executionTimeframe: journal.executionTimeframe,
    startingCursor: journal.startingCursor, identities: journal.identities,
  });
  let phases = phaseRecords(coordinator.getSnapshot());
  const rows: PersistedAction[] = [];
  let actionIndex = 0;
  for (let cursor = journal.startingCursor; cursor <= journal.cursor; cursor += 1) {
    if (cursor > journal.startingCursor) coordinator.advanceTo(coordinator.getContext(), cursor);
    phases = phaseRecords(coordinator.getSnapshot(), phases);
    while (actionIndex < journal.actions.length && journal.actions[actionIndex].cursor === cursor) {
      const expected = journal.actions[actionIndex];
      coordinator.trade(coordinator.getContext(), expected.intent);
      const snapshot = coordinator.getSnapshot();
      if (snapshot.actions[actionIndex]?.actionId !== expected.actionId ||
          snapshot.actions[actionIndex]?.occurredAt !== expected.occurredAt) {
        throw new ChallengePersistenceError('CORRUPT', 'Journal action identity cannot be regenerated.');
      }
      rows.push(actionRow(snapshot, actionIndex + 1));
      phases = phaseRecords(snapshot, phases);
      actionIndex += 1;
    }
  }
  if (actionIndex !== journal.actions.length) throw new ChallengePersistenceError('CORRUPT', 'Journal action lies outside the retained replay range.');
  return { coordinator, phases, rows };
}

export function createAttemptBundle(coordinator: ChallengeReplayCoordinator, now: number): CreateAttemptBundle {
  const journal = coordinator.exportJournal();
  const evidence = replayEvidence(journal);
  const snapshot = coordinator.getSnapshot();
  const id = String(snapshot.account.challengeId);
  const branchId = String(snapshot.readModel.replay.branchId);
  const stateHash = stateWitnessHash(snapshot);
  const commit: PersistedCommit = {
    commitKey: id + '|0', operationKey: id + '|create', challengeId: id,
    revision: 0, operationId: 'create', branchId, cursor: snapshot.cursor,
    actionCount: snapshot.actions.length, currentPhaseId: String(snapshot.account.phaseId),
    status: snapshot.readModel.identity.status, stateWitnessHash: stateHash, committedAt: now,
  };
  const attempt: PersistedAttempt = {
    challengeId: id, schemaVersion: CHALLENGE_PERSISTENCE_SCHEMA, mode: 'replay',
    challengeType: snapshot.readModel.identity.challengeType, selectedCapital: snapshot.definition.selectedCapital,
    currentPhaseId: String(snapshot.account.phaseId), status: snapshot.readModel.identity.status,
    createdAt: now, updatedAt: now, activeBranchId: branchId, activeReplayCursor: snapshot.cursor,
    datasetId: snapshot.dataset.datasetId, datasetHash: snapshot.dataset.datasetHash, definitionHash: snapshot.definition.definitionHash,
    versions: versionSet(snapshot), revision: 0, latestCommitKey: commit.commitKey,
  };
  const branch: PersistedBranch = {
    branchKey: id + '|' + branchId, challengeId: id, branchId,
    parentBranchId: null, forkCursor: null, generation: snapshot.account.generation,
    createdAt: now, creationReason: 'attempt-created', active: true,
    cursor: snapshot.cursor, startingCursor: journal.startingCursor, actionCount: snapshot.actions.length,
    identities: journal.identities,
    terminalResult: snapshot.readModel.identity.status === 'ACTIVE' ? null : terminal(snapshot),
    stateWitnessHash: stateHash,
  };
  return persistentClone({
    attempt, definition: snapshot.definition, dataset: snapshot.dataset, branch,
    actions: evidence.rows, phases: evidence.phases, checkpoint: checkpoint(snapshot), commit,
  });
}

const attemptSchema = z.object({
  challengeId: z.string().min(1), schemaVersion: z.literal(1), mode: z.literal('replay'),
  challengeType: z.enum(['oneStep', 'twoStep']), selectedCapital: z.string(),
  currentPhaseId: z.string(), status: z.enum(['ACTIVE', 'PASSED', 'FAILED']),
  createdAt: z.number().finite(), updatedAt: z.number().finite(),
  activeBranchId: z.string(), activeReplayCursor: z.number().int().nonnegative(),
  datasetId: z.string(), datasetHash: z.string(), definitionHash: z.string(), versions: z.object({
    persistence: z.string(), coordinator: z.string(), template: z.string(), rules: z.string(),
    execution: z.string(), accounting: z.string(), checkpoint: z.string(), instrumentPolicy: z.string(),
  }).strict(), revision: z.number().int().nonnegative(), latestCommitKey: z.string(),
}).strict();

export interface RestoredChallenge {
  coordinator: ChallengeReplayCoordinator;
  attempt: PersistedAttempt;
  branch: PersistedBranch;
  phases: readonly PersistedPhase[];
  recovered: boolean;
  warnings: readonly string[];
}

export async function restoreChallenge(repository: ChallengeReplayRepository, id: string): Promise<RestoredChallenge> {
  const loaded = await repository.loadAttempt(id);
  if (!loaded) throw new ChallengePersistenceError('NOT_FOUND', 'Challenge attempt was not found.');
  try { return await restoreLoaded(repository, loaded); }
  catch (cause) {
    if (cause instanceof ChallengePersistenceError) throw cause;
    const message = cause instanceof Error ? cause.message : 'Malformed persisted Challenge payload.';
    throw new ChallengePersistenceError(/Unsupported|version/i.test(message) ? 'UNSUPPORTED_VERSION' : 'CORRUPT', message);
  }
}
async function restoreLoaded(repository: ChallengeReplayRepository, loaded: LoadedAttempt): Promise<RestoredChallenge> {
  if (loaded.attempt.schemaVersion !== 1) throw new ChallengePersistenceError('UNSUPPORTED_VERSION', 'Unsupported Challenge storage schema.');
  const parsed = attemptSchema.safeParse(loaded.attempt);
  if (!parsed.success) throw new ChallengePersistenceError('CORRUPT', 'Malformed persisted Challenge metadata.');
  if (!loaded.definition) throw new ChallengePersistenceError('CORRUPT', 'Frozen Challenge definition is missing.');
  const definition = verifyFrozenChallengeDefinition(loaded.definition);
  if (definition.definitionHash !== loaded.attempt.definitionHash) throw new ChallengePersistenceError('CORRUPT', 'Frozen definition identity/hash mismatch.');
  if (!loaded.dataset) throw new ChallengePersistenceError('DATASET_UNAVAILABLE', 'The exact frozen BTC replay dataset is unavailable.');
  const dataset = verifyChallengeReplayDataset(loaded.dataset);
  if (dataset.datasetHash !== loaded.attempt.datasetHash || dataset.datasetId !== loaded.attempt.datasetId) throw new ChallengePersistenceError('CORRUPT', 'Frozen dataset identity/hash mismatch.');
  const branch = loaded.branch;
  const commit = loaded.latestCommit;
  if (!branch || !commit || commit.challengeId !== loaded.attempt.challengeId ||
      commit.branchId !== branch.branchId || branch.challengeId !== loaded.attempt.challengeId ||
      branch.identities.challengeId !== loaded.attempt.challengeId || branch.identities.branchId !== branch.branchId ||
      branch.generation !== branch.identities.generation ||
      !Number.isSafeInteger(commit.cursor) || commit.cursor < branch.startingCursor ||
      commit.cursor >= dataset.candles.length || !Number.isSafeInteger(commit.actionCount) ||
      loaded.attempt.revision > commit.revision) {
    throw new ChallengePersistenceError('CORRUPT', 'Branch/head scope or canonical commit range is invalid.');
  }
  const rows = [...loaded.actions].sort((left, right) => left.sequence - right.sequence);
  if (rows.length !== commit.actionCount) throw new ChallengePersistenceError('CORRUPT', 'Journal sequence is missing or head points beyond its journal.');
  const ids = new Set<string>();
  let previousCursor = branch.startingCursor;
  for (const [index, row] of rows.entries()) {
    const { actionHash, ...basis } = row;
    if (row.sequence !== index + 1 || row.payloadVersion !== 1 ||
        row.branchKey !== branch.branchKey || row.branchId !== branch.branchId ||
        row.challengeId !== loaded.attempt.challengeId || row.generation !== branch.generation ||
        row.actionId !== `action:${canonicalHash({
          branchId: row.branchId, generation: row.generation, cursor: row.cursor,
          ordinal: index + 1, intent: row.action.intent,
        })}` ||
        row.actionId !== row.action.actionId || row.cursor !== row.action.cursor ||
        row.occurredAt !== row.action.occurredAt || row.cursor < previousCursor ||
        row.cursor > commit.cursor || ids.has(row.actionId) || actionHash !== persistenceHash(basis)) {
      throw new ChallengePersistenceError('CORRUPT', 'Journal sequence, payload hash, or branch scope is corrupt.');
    }
    ids.add(row.actionId);
    previousCursor = row.cursor;
  }
  const journal: ChallengeReplayJournal = {
    definition, dataset, executionTimeframe: dataset.executionTimeframe,
    startingCursor: branch.startingCursor, identities: branch.identities,
    actions: rows.map((row) => row.action), cursor: commit.cursor,
  };
  const warnings: string[] = [];
  let coordinator: ChallengeReplayCoordinator | null = null;
  let phases: readonly PersistedPhase[] = loaded.phases;
  if (loaded.checkpoint) {
    const cached = loaded.checkpoint;
    const { checkpointHash, ...basis } = cached;
    try {
      if (checkpointHash !== persistenceHash(basis) ||
          cached.branchKey !== branch.branchKey || cached.branchId !== branch.branchId ||
          cached.challengeId !== loaded.attempt.challengeId ||
          cached.definitionHash !== loaded.attempt.definitionHash ||
          persistenceHash(cached.versions) !== persistenceHash(loaded.attempt.versions) ||
          cached.cursor !== cached.coordinatorState.cursor ||
          cached.actionCount !== cached.coordinatorState.actions.length ||
          cached.cursor > commit.cursor || cached.actionCount > commit.actionCount ||
          cached.coordinatorStateHash !== persistenceHash(cached.coordinatorState) ||
          persistenceHash(cached.checkpoint) !== persistenceHash(cached.coordinatorState.account.lastStableCheckpoint)) {
        throw new RangeError('Checkpoint cache identity or hash is invalid.');
      }
      const rebuilt = reconstructReplayChallengeFromCheckpoint(journal, cached.coordinatorState);
      if (stateWitnessHash(rebuilt.snapshot) !== commit.stateWitnessHash) {
        throw new RangeError('Checkpoint suffix does not match the committed state witness.');
      }
      coordinator = rebuilt.coordinator;
      phases = phaseRecords(rebuilt.snapshot, loaded.phases);
    } catch {
      warnings.push('Invalid checkpoint cache discarded; rebuilt from the canonical journal.');
      await repository.discardCheckpoint(cached.checkpointKey);
    }
  } else warnings.push('Checkpoint cache unavailable; rebuilt from the canonical journal.');
  let canonicalEvidence: ReturnType<typeof replayEvidence> | null = null;
  if (!coordinator) {
    canonicalEvidence = replayEvidence(journal);
    coordinator = canonicalEvidence.coordinator;
    phases = canonicalEvidence.phases;
    if (canonicalEvidence.rows.some((row, index) => row.actionHash !== rows[index].actionHash)) {
      throw new ChallengePersistenceError('CORRUPT', 'Canonical reconstruction does not match the persisted journal.');
    }
  }
  const snapshot = coordinator.getSnapshot();
  const expectedVersions = versionSet(snapshot);
  if (definition.template.templateVersion !== '1' ||
      persistenceHash(expectedVersions) !== persistenceHash(loaded.attempt.versions)) {
    throw new ChallengePersistenceError('UNSUPPORTED_VERSION', 'This attempt requires an unsupported Challenge version set.');
  }
  if (stateWitnessHash(snapshot) !== commit.stateWitnessHash) {
    throw new ChallengePersistenceError('CORRUPT', 'Canonical reconstruction does not match the persisted commit.');
  }
  for (const phase of loaded.phases) {
    if (!phase.terminalResult) continue;
    const { resultHash, ...resultBasis } = phase.terminalResult;
    const canonical = canonicalEvidence?.phases.find((item) => item.phaseId === phase.phaseId)?.terminalResult;
    if (resultHash !== persistenceHash(resultBasis) ||
        phase.branchKey !== branch.branchKey || phase.branchId !== branch.branchId ||
        phase.challengeId !== loaded.attempt.challengeId ||
        phase.terminalResult.branchId !== branch.branchId ||
        phase.terminalResult.definitionHash !== loaded.attempt.definitionHash ||
        phase.terminalResult.datasetHash !== loaded.attempt.datasetHash ||
        (canonical && persistenceHash(canonical) !== persistenceHash(phase.terminalResult))) {
      throw new ChallengePersistenceError('CORRUPT', 'Immutable phase terminal evidence does not match canonical reconstruction.');
    }
  }
  const finalResult = snapshot.readModel.identity.status === 'ACTIVE' ? null : terminal(snapshot);
  if (branch.terminalResult && persistenceHash(branch.terminalResult) !== persistenceHash(finalResult)) {
    throw new ChallengePersistenceError('CORRUPT', 'Immutable branch terminal evidence is corrupt.');
  }
  const stale = loaded.attempt.revision < commit.revision ||
    loaded.attempt.activeReplayCursor !== commit.cursor || loaded.attempt.activeBranchId !== commit.branchId;
  if (stale) warnings.push('Stale head recovered from its canonical committed revision.');
  const attempt: PersistedAttempt = {
    ...loaded.attempt, revision: commit.revision, latestCommitKey: commit.commitKey,
    activeBranchId: commit.branchId, activeReplayCursor: commit.cursor,
    currentPhaseId: commit.currentPhaseId, status: commit.status,
  };
  return {
    coordinator, attempt,
    branch: { ...branch, cursor: commit.cursor, actionCount: commit.actionCount, stateWitnessHash: commit.stateWitnessHash },
    phases, recovered: warnings.length > 0, warnings,
  };
}

export class DurableChallengeReplaySession {
  private constructor(
    readonly repository: ChallengeReplayRepository,
    readonly ownerId: string,
    private restored: RestoredChallenge,
    private readonly clock: () => number,
    readonly readOnly: boolean,
  ) {}
  static async create(repository: ChallengeReplayRepository, coordinator: ChallengeReplayCoordinator, ownerId: string, clock = Date.now) {
    const bundle = createAttemptBundle(coordinator, clock());
    await repository.createAttempt(bundle);
    const owns = await repository.claimLease(bundle.attempt.challengeId, ownerId, clock(), CHALLENGE_WRITER_LEASE_MS);
    return new DurableChallengeReplaySession(repository, ownerId, {
      coordinator, attempt: bundle.attempt, branch: bundle.branch, phases: bundle.phases, recovered: false, warnings: [],
    }, clock, !owns);
  }
  static async restore(repository: ChallengeReplayRepository, id: string, ownerId: string, clock = Date.now) {
    const restored = await restoreChallenge(repository, id);
    const owns = await repository.claimLease(id, ownerId, clock(), CHALLENGE_WRITER_LEASE_MS);
    return new DurableChallengeReplaySession(repository, ownerId, restored, clock, !owns);
  }
  get coordinator(): ChallengeReplayCoordinator { return this.restored.coordinator; }
  get metadata(): RestoredChallenge { return this.restored; }
  async renewOwnership(): Promise<boolean> {
    return this.repository.renewLease(this.restored.attempt.challengeId, this.ownerId, this.clock(), CHALLENGE_WRITER_LEASE_MS);
  }
  async release(): Promise<void> { await this.repository.releaseLease(this.restored.attempt.challengeId, this.ownerId); }

  async apply(
    operation: { kind: 'trade'; intent: ChallengeReplayTradingIntent } | { kind: 'advance'; cursor: number },
    operationId: string,
  ): Promise<ChallengeReplayOperationResult> {
    if (this.readOnly) throw new ChallengePersistenceError('LEASE_CONFLICT', 'This tab is read-only because another tab owns the Challenge.');
    const existing = await this.repository.getCommitByOperation(this.restored.attempt.challengeId, operationId);
    if (existing) {
      return { status: 'applied', snapshot: this.restored.coordinator.getSnapshot(), decisions: [] };
    }
    if (!await this.renewOwnership()) throw new ChallengePersistenceError('LEASE_CONFLICT', 'Challenge writer ownership expired.');
    const before = this.restored;
    const sourceJournal = before.coordinator.exportJournal();
    // Durable commands remain speculative until the IndexedDB transaction commits, but
    // they do not need to replay every prior candle. The current coordinator snapshot is
    // already a stable, hash-backed cache of the canonical journal.
    const sourceSnapshot = before.coordinator.getSnapshot();
    // A pending phase transition deliberately straddles the old account scope and
    // next lifecycle phase. It is the one valid state that cannot use restoreStable.
    const candidate = sourceSnapshot.pendingPhaseTransition
      ? reconstructReplayChallenge(sourceJournal).coordinator
      : ChallengeReplayCoordinator.restoreStable({
          frozenDefinition: sourceJournal.definition,
          selectedPhase: sourceJournal.identities.phaseId,
          dataset: sourceJournal.dataset,
          executionTimeframe: sourceJournal.executionTimeframe,
          startingCursor: sourceJournal.startingCursor,
          identities: sourceJournal.identities,
        }, coordinatorState(sourceSnapshot));
    let phases = [...before.phases];
    let result: ChallengeReplayOperationResult;
    if (operation.kind === 'trade') {
      result = candidate.trade(candidate.getContext(), operation.intent);
      phases = phaseRecords(candidate.getSnapshot(), phases);
    } else if (operation.cursor < candidate.getSnapshot().cursor) {
      result = candidate.rewind(candidate.getContext(), operation.cursor);
    } else {
      result = { status: 'applied', snapshot: candidate.getSnapshot(), decisions: [] };
      for (let cursor = candidate.getSnapshot().cursor + 1; cursor <= Math.min(operation.cursor, candidate.getSnapshot().dataset.candles.length - 1); cursor += 1) {
        result = candidate.advanceTo(candidate.getContext(), cursor);
        phases = phaseRecords(candidate.getSnapshot(), phases);
      }
      if (operation.cursor >= candidate.getSnapshot().dataset.candles.length) result = candidate.advanceTo(candidate.getContext(), operation.cursor);
    }
    const snapshot = candidate.getSnapshot();
    const changed = stateWitnessHash(snapshot) !== before.branch.stateWitnessHash;
    if (!changed) return result;
    const journal = candidate.exportJournal();
    const forked = String(snapshot.readModel.replay.branchId) !== before.branch.branchId;
    let rows: PersistedAction[];
    if (forked) {
      const evidence = replayEvidence(journal);
      rows = evidence.rows;
      phases = evidence.phases;
    } else {
      rows = snapshot.actions.length > before.branch.actionCount
        ? [actionRow(snapshot, snapshot.actions.length)] : [];
    }
    const stateHash = stateWitnessHash(snapshot);
    const now = this.clock();
    const id = before.attempt.challengeId;
    const branchId = String(snapshot.readModel.replay.branchId);
    const revision = before.attempt.revision + 1;
    const commit: PersistedCommit = {
      commitKey: id + '|' + revision, operationKey: id + '|' + operationId,
      challengeId: id, revision, operationId, branchId, cursor: snapshot.cursor,
      actionCount: snapshot.actions.length, currentPhaseId: String(snapshot.account.phaseId),
      status: snapshot.readModel.identity.status, stateWitnessHash: stateHash, committedAt: now,
    };
    const activeBranch: PersistedBranch = {
      ...before.branch, branchKey: id + '|' + branchId, branchId,
      parentBranchId: forked ? before.branch.branchId : before.branch.parentBranchId,
      forkCursor: forked ? snapshot.cursor : before.branch.forkCursor,
      generation: snapshot.account.generation, creationReason: forked ? 'rewind' : before.branch.creationReason,
      createdAt: forked ? now : before.branch.createdAt, active: true,
      cursor: snapshot.cursor, actionCount: snapshot.actions.length, identities: journal.identities,
      terminalResult: forked ? null : before.branch.terminalResult,
      stateWitnessHash: stateHash,
    };
    if (!activeBranch.terminalResult && snapshot.readModel.identity.status !== 'ACTIVE') activeBranch.terminalResult = terminal(snapshot);
    const attempt: PersistedAttempt = {
      ...before.attempt, revision, updatedAt: now, latestCommitKey: commit.commitKey,
      activeBranchId: branchId, activeReplayCursor: snapshot.cursor,
      currentPhaseId: String(snapshot.account.phaseId), status: snapshot.readModel.identity.status,
    };
    const bundle: CommitBundle = persistentClone({
      expectedRevision: before.attempt.revision, ownerId: this.ownerId, now,
      attempt, activeBranch, ...(forked ? { archivedBranch: { ...before.branch, active: false } } : {}),
      actions: rows, checkpoint: checkpoint(snapshot), phases, commit,
    });
    await this.repository.commit(bundle);
    this.restored = { coordinator: candidate, attempt, branch: activeBranch, phases, recovered: false, warnings: [] };
    return result;
  }
}






