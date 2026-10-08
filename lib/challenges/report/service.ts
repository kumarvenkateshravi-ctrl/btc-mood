import { verifyFrozenChallengeDefinition } from '../domain/templates';
import { verifyChallengeReplayDataset } from '../replay/dataset';
import { ChallengeReplayCoordinator, reconstructReplayChallenge } from '../replay/coordinator';
import type { ChallengeReplayJournal } from '../replay/types';
import { CHALLENGE_PERSISTENCE_SCHEMA, ChallengePersistenceError, type ChallengeReplayRepository } from '../persistence/types';
import { persistenceHash, stateWitnessHash, versionSet } from '../persistence/session';
import { buildChallengeReport } from './builder';
import type { ChallengeReportReadModel } from './types';

export interface LoadedChallengeReport { report: ChallengeReportReadModel; buildDurationMs: number; }

export async function loadChallengeReport(repository: ChallengeReplayRepository, challengeId: string): Promise<LoadedChallengeReport> {
  const loaded = await repository.loadAttempt(challengeId);
  if (!loaded) throw new ChallengePersistenceError('NOT_FOUND', 'Challenge attempt was not found.');
  try {
    if (loaded.attempt.schemaVersion !== CHALLENGE_PERSISTENCE_SCHEMA) throw new ChallengePersistenceError('UNSUPPORTED_VERSION', 'Unsupported Challenge persistence version.');
    if (!loaded.definition) throw new ChallengePersistenceError('CORRUPT', 'Frozen Challenge definition is missing.');
    if (!loaded.dataset) throw new ChallengePersistenceError('DATASET_UNAVAILABLE', 'The frozen BTC replay dataset is unavailable.');
    if (!loaded.branch || !loaded.latestCommit) throw new ChallengePersistenceError('CORRUPT', 'Active branch or commit head is missing.');
    const definition = verifyFrozenChallengeDefinition(loaded.definition);
    const dataset = verifyChallengeReplayDataset(loaded.dataset);
    const { attempt, branch, latestCommit: commit } = loaded;
    if (definition.definitionHash !== attempt.definitionHash || dataset.datasetHash !== attempt.datasetHash || dataset.datasetId !== attempt.datasetId ||
        branch.challengeId !== challengeId || branch.branchId !== attempt.activeBranchId || branch.branchKey !== `${challengeId}|${branch.branchId}` ||
        commit.challengeId !== challengeId || commit.branchId !== branch.branchId || commit.revision !== attempt.revision || commit.cursor !== branch.cursor ||
        loaded.actions.length !== commit.actionCount || branch.actionCount !== commit.actionCount) {
      throw new ChallengePersistenceError('CORRUPT', 'Challenge report evidence identity or head is inconsistent.');
    }
    const actions = [...loaded.actions].sort((a, b) => a.sequence - b.sequence);
    let previousCursor = branch.startingCursor;
    for (const [index, row] of actions.entries()) {
      const { actionHash, ...basis } = row;
      if (row.sequence !== index + 1 || row.branchKey !== branch.branchKey || row.branchId !== branch.branchId || row.challengeId !== challengeId ||
          row.action.actionId !== row.actionId || row.action.cursor !== row.cursor || row.action.occurredAt !== row.occurredAt || row.cursor < previousCursor ||
          row.cursor > commit.cursor || actionHash !== persistenceHash(basis)) throw new ChallengePersistenceError('CORRUPT', 'Challenge journal is corrupt.');
      previousCursor = row.cursor;
    }
    const journal: ChallengeReplayJournal = { definition, dataset, executionTimeframe: dataset.executionTimeframe, startingCursor: branch.startingCursor,
      identities: branch.identities, actions: actions.map(row => row.action), cursor: commit.cursor };
    const started = performance.now();
    let authoritative;
    const cached = loaded.checkpoint;
    if (cached) {
      const { checkpointHash, ...checkpointBasis } = cached;
      if (checkpointHash !== persistenceHash(checkpointBasis) || cached.branchKey !== branch.branchKey || cached.branchId !== branch.branchId ||
          cached.cursor !== commit.cursor || cached.actionCount !== commit.actionCount || cached.coordinatorStateHash !== persistenceHash(cached.coordinatorState)) {
        throw new ChallengePersistenceError('CORRUPT', 'Persisted report checkpoint is corrupt.');
      }
      authoritative = ChallengeReplayCoordinator.restoreStable({ frozenDefinition: definition, selectedPhase: journal.identities.phaseId, dataset,
        executionTimeframe: dataset.executionTimeframe, startingCursor: branch.startingCursor, identities: journal.identities }, cached.coordinatorState).getSnapshot();
    } else authoritative = reconstructReplayChallenge(journal).snapshot;
    if (stateWitnessHash(authoritative) !== commit.stateWitnessHash) throw new ChallengePersistenceError('CORRUPT', 'Regenerated report evidence does not match the committed state witness.');
    if (persistenceHash(versionSet(authoritative)) !== persistenceHash(attempt.versions)) throw new ChallengePersistenceError('UNSUPPORTED_VERSION', 'This report requires an unsupported Challenge version set.');
    const evidence = reconstructReplayChallenge(journal, true).coordinator.getEvidenceCycles();
    const report = buildChallengeReport({ snapshot: authoritative, cycles: evidence, attempt, branch, commit, generatedAt: commit.committedAt });
    return { report, buildDurationMs: performance.now() - started };
  } catch (cause) {
    if (cause instanceof ChallengePersistenceError) throw cause;
    throw new ChallengePersistenceError(/version|Unsupported/i.test(cause instanceof Error ? cause.message : '') ? 'UNSUPPORTED_VERSION' : 'CORRUPT', cause instanceof Error ? cause.message : 'Challenge report evidence is malformed.');
  }
}
