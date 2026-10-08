import type { ChallengeReplayReadModel, ChallengeReplayJournal, ChallengeReplayStableState } from '../replay/types';
import type { FrozenChallengeDefinition } from '../domain/types';
import type { ChallengeReplayDataset } from '../replay/types';
import type { StableAccountCheckpoint } from '../accounting/types';

export const CHALLENGE_PERSISTENCE_SCHEMA = 1;
export const CHALLENGE_PERSISTENCE_VERSION = 'mcs.challenge.persistence/1';
export const CHALLENGE_REPLAY_COORDINATOR_VERSION = 'mcs.challenge.replay-coordinator/1';

export type ChallengeRecoveryCode =
  | 'CORRUPT'
  | 'UNSUPPORTED_VERSION'
  | 'DATASET_UNAVAILABLE'
  | 'LEASE_CONFLICT'
  | 'STALE_WRITER'
  | 'NOT_FOUND';

export class ChallengePersistenceError extends Error {
  constructor(readonly code: ChallengeRecoveryCode, message: string) {
    super(message);
    this.name = 'ChallengePersistenceError';
  }
}

export interface PersistedVersionSet {
  persistence: typeof CHALLENGE_PERSISTENCE_VERSION;
  coordinator: typeof CHALLENGE_REPLAY_COORDINATOR_VERSION;
  template: string;
  rules: string;
  execution: string;
  accounting: string;
  checkpoint: string;
  instrumentPolicy: string;
}

export interface PersistedAttempt {
  challengeId: string;
  schemaVersion: typeof CHALLENGE_PERSISTENCE_SCHEMA;
  mode: 'replay';
  challengeType: 'oneStep' | 'twoStep';
  selectedCapital: string;
  currentPhaseId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  activeBranchId: string;
  activeReplayCursor: number;
  datasetId: string;
  datasetHash: string;
  definitionHash: string;
  versions: PersistedVersionSet;
  revision: number;
  latestCommitKey: string;
}

export interface PersistedBranch {
  branchKey: string;
  challengeId: string;
  branchId: string;
  parentBranchId: string | null;
  forkCursor: number | null;
  generation: number;
  createdAt: number;
  creationReason: 'attempt-created' | 'rewind';
  active: boolean;
  cursor: number;
  startingCursor: number;
  actionCount: number;
  identities: ChallengeReplayJournal['identities'];
  terminalResult: PersistedTerminalResult | null;
  stateWitnessHash: string;
}

export interface PersistedAction {
  actionKey: string;
  branchKey: string;
  challengeId: string;
  branchId: string;
  sequence: number;
  actionId: string;
  commandId: string | null;
  phaseId: string;
  accountId: string;
  generation: number;
  cursor: number;
  occurredAt: number;
  payloadVersion: 1;
  action: ChallengeReplayJournal['actions'][number];
  actionHash: string;
}

export interface PersistedCheckpoint {
  checkpointKey: string;
  branchKey: string;
  challengeId: string;
  branchId: string;
  checkpointId: string;
  commandId: string | null;
  factRange: readonly [number | null, number | null];
  accountRevision: number;
  ledgerHash: string;
  definitionHash: string;
  scope: unknown;
  versions: PersistedVersionSet;
  occurredAt: number;
  checkpoint: StableAccountCheckpoint;
  coordinatorState: ChallengeReplayStableState;
  coordinatorStateHash: string;
  cursor: number;
  actionCount: number;
  checkpointHash: string;
}

export interface PersistedPhase {
  phaseKey: string;
  branchKey: string;
  challengeId: string;
  branchId: string;
  phaseId: string;
  accountId: string;
  sequence: number;
  status: string;
  startingCapital: bigint;
  journalBranchKey: string;
  checkpointKey: string;
  startCursor: number;
  terminalCursor: number | null;
  terminalResult: PersistedTerminalResult | null;
}

export interface PersistedTerminalResult {
  status: 'PASSED' | 'FAILED';
  phaseId: string;
  terminalCheckpointId: string;
  account: ChallengeReplayReadModel['account'];
  breachEvidence: ChallengeReplayReadModel['lifecycle']['terminalBreachEvidence'];
  progress: ChallengeReplayReadModel['progress'];
  versions: PersistedVersionSet;
  definitionHash: string;
  datasetHash: string;
  branchId: string;
  resultHash: string;
}

export interface PersistedCommit {
  commitKey: string;
  operationKey: string;
  challengeId: string;
  revision: number;
  operationId: string;
  branchId: string;
  cursor: number;
  actionCount: number;
  currentPhaseId: string;
  status: string;
  stateWitnessHash: string;
  committedAt: number;
}

export interface PersistedLease {
  challengeId: string;
  ownerId: string;
  revision: number;
  expiresAt: number;
}

export interface CreateAttemptBundle {
  attempt: PersistedAttempt;
  definition: Readonly<FrozenChallengeDefinition>;
  dataset: ChallengeReplayDataset;
  branch: PersistedBranch;
  actions: readonly PersistedAction[];
  checkpoint: PersistedCheckpoint;
  phases: readonly PersistedPhase[];
  commit: PersistedCommit;
}

export interface CommitBundle {
  expectedRevision: number;
  ownerId: string;
  now: number;
  attempt: PersistedAttempt;
  activeBranch: PersistedBranch;
  archivedBranch?: PersistedBranch;
  actions: readonly PersistedAction[];
  checkpoint: PersistedCheckpoint;
  phases: readonly PersistedPhase[];
  commit: PersistedCommit;
}

export interface LoadedAttempt {
  attempt: PersistedAttempt;
  definition: Readonly<FrozenChallengeDefinition> | null;
  dataset: ChallengeReplayDataset | null;
  branch: PersistedBranch | null;
  actions: readonly PersistedAction[];
  checkpoint: PersistedCheckpoint | null;
  phases: readonly PersistedPhase[];
  latestCommit: PersistedCommit | null;
}

export interface ChallengeAttemptSummary {
  challengeId: string;
  challengeType: PersistedAttempt['challengeType'];
  selectedCapital: string;
  currentPhaseId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  activeReplayCursor: number;
  readModel: ChallengeReplayReadModel | null;
}

export interface ChallengeReplayRepository {
  createAttempt(bundle: CreateAttemptBundle): Promise<void>;
  commit(bundle: CommitBundle): Promise<'committed' | 'duplicate'>;
  loadAttempt(challengeId: string): Promise<LoadedAttempt | null>;
  getChallengeAttempt(challengeId: string): Promise<PersistedAttempt | null>;
  listChallengeAttempts(): Promise<readonly PersistedAttempt[]>;
  getActiveAttempts(): Promise<readonly PersistedAttempt[]>;
  getTerminalAttempts(): Promise<readonly PersistedAttempt[]>;
  getActiveBranch(challengeId: string): Promise<PersistedBranch | null>;
  loadBranch(challengeId: string, branchId: string): Promise<PersistedBranch | null>;
  loadJournal(challengeId: string, branchId: string): Promise<readonly PersistedAction[]>;
  loadCheckpoint(challengeId: string, branchId: string): Promise<PersistedCheckpoint | null>;
  getCommitByOperation(challengeId: string, operationId: string): Promise<PersistedCommit | null>;
  claimLease(challengeId: string, ownerId: string, now: number, ttlMs: number): Promise<boolean>;
  renewLease(challengeId: string, ownerId: string, now: number, ttlMs: number): Promise<boolean>;
  releaseLease(challengeId: string, ownerId: string): Promise<void>;
  discardCheckpoint(checkpointKey: string): Promise<void>;
}



