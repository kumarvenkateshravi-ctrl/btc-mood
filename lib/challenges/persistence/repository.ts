import type {
  ChallengeReplayRepository, CommitBundle, CreateAttemptBundle, LoadedAttempt,
  PersistedAttempt, PersistedBranch, PersistedLease, PersistedCommit,
} from './types';
import { ChallengePersistenceError, CHALLENGE_PERSISTENCE_SCHEMA } from './types';

export const CHALLENGE_DATABASE_NAME = 'mycryptostack-replay-challenges';
export const CHALLENGE_STORES = [
  'attempts', 'definitions', 'datasets', 'branches', 'actions', 'commits',
  'checkpoints', 'phases', 'leases',
] as const;
export type ChallengeStore = typeof CHALLENGE_STORES[number];

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed.'));
  });
}
function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

export class IndexedDbChallengeReplayRepository implements ChallengeReplayRepository {
  private database: Promise<IDBDatabase> | null = null;
  /** Fault injection aborts an actual transaction, never changes production ordering. */
  constructor(
    private readonly factory: IDBFactory = indexedDB,
    readonly databaseName = CHALLENGE_DATABASE_NAME,
    private readonly beforeHeadWrite?: (transaction: IDBTransaction) => void,
  ) {}

  open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const opening = this.factory.open(this.databaseName, CHALLENGE_PERSISTENCE_SCHEMA);
      opening.onupgradeneeded = () => {
        const database = opening.result;
        const definitions = [
          ['attempts', 'challengeId'], ['definitions', 'definitionHash'],
          ['datasets', 'datasetHash'], ['branches', 'branchKey'],
          ['actions', 'actionKey'], ['commits', 'commitKey'],
          ['checkpoints', 'checkpointKey'], ['phases', 'phaseKey'], ['leases', 'challengeId'],
        ];
        for (const [name, keyPath] of definitions) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath });
        }
        for (const name of ['branches', 'commits']) {
          opening.transaction!.objectStore(name).createIndex('challengeId', 'challengeId');
        }
        for (const name of ['actions', 'checkpoints', 'phases']) {
          opening.transaction!.objectStore(name).createIndex('branchKey', 'branchKey');
        }
        opening.transaction!.objectStore('commits').createIndex('operationKey', 'operationKey', { unique: true });
      };
      opening.onsuccess = () => {
        const database = opening.result;
        database.onversionchange = () => { database.close(); this.database = null; };
        resolve(database);
      };
      opening.onerror = () => {
        this.database = null;
        reject(opening.error?.name === 'VersionError'
          ? new ChallengePersistenceError('UNSUPPORTED_VERSION', 'This browser has a newer Challenge storage schema.')
          : opening.error ?? new Error('Challenge storage could not be opened.'));
      };
      opening.onblocked = () => reject(new Error('Challenge storage upgrade is blocked by another tab.'));
    });
    return this.database;
  }

  private async read<T>(store: ChallengeStore, key: IDBValidKey): Promise<T | null> {
    const database = await this.open();
    const transaction = database.transaction(store, 'readonly');
    return (await request(transaction.objectStore(store).get(key))) as T | undefined ?? null;
  }

  async createAttempt(bundle: CreateAttemptBundle): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([...CHALLENGE_STORES], 'readwrite', { durability: 'strict' });
    const done = finished(transaction);
    try {
      if (await request(transaction.objectStore('attempts').get(bundle.attempt.challengeId))) {
        throw new ChallengePersistenceError('CORRUPT', 'Challenge identity already exists.');
      }
      const existingDefinition = await request(transaction.objectStore('definitions').get(bundle.definition.definitionHash));
      if (!existingDefinition) transaction.objectStore('definitions').add(bundle.definition);
      const existingDataset = await request(transaction.objectStore('datasets').get(bundle.dataset.datasetHash));
      if (!existingDataset) transaction.objectStore('datasets').add(bundle.dataset);
      transaction.objectStore('attempts').add(bundle.attempt);
      transaction.objectStore('branches').add(bundle.branch);
      transaction.objectStore('commits').add(bundle.commit);
      transaction.objectStore('checkpoints').put(bundle.checkpoint);
      for (const action of bundle.actions) transaction.objectStore('actions').add(action);
      for (const phase of bundle.phases) transaction.objectStore('phases').put(phase);
      await done;
    } catch (cause) {
      try { transaction.abort(); } catch { /* Already completed/aborted. */ }
      await done.catch(() => undefined);
      throw cause;
    }
  }

  async commit(bundle: CommitBundle): Promise<'committed' | 'duplicate'> {
    const database = await this.open();
    const transaction = database.transaction([...CHALLENGE_STORES], 'readwrite', { durability: 'strict' });
    const done = finished(transaction);
    try {
      const duplicate = await request(transaction.objectStore('commits').index('operationKey').get(bundle.commit.operationKey));
      if (duplicate) {
        const existing = duplicate as PersistedCommit;
        if (existing.stateWitnessHash !== bundle.commit.stateWitnessHash ||
            existing.branchId !== bundle.commit.branchId || existing.cursor !== bundle.commit.cursor) {
          throw new ChallengePersistenceError('CORRUPT', 'An operation identity was reused with different content.');
        }
        await done;
        return 'duplicate';
      }
      const attempt = await request(transaction.objectStore('attempts').get(bundle.attempt.challengeId)) as PersistedAttempt | undefined;
      const lease = await request(transaction.objectStore('leases').get(bundle.attempt.challengeId)) as PersistedLease | undefined;
      if (!lease || lease.ownerId !== bundle.ownerId || lease.expiresAt <= bundle.now) {
        throw new ChallengePersistenceError('LEASE_CONFLICT', 'Another tab owns this Challenge. This tab is read-only.');
      }
      if (!attempt || attempt.revision !== bundle.expectedRevision ||
          bundle.attempt.revision !== bundle.expectedRevision + 1) {
        throw new ChallengePersistenceError('STALE_WRITER', 'Challenge revision changed. Restore before writing again.');
      }
      for (const action of bundle.actions) transaction.objectStore('actions').add(action);
      this.beforeHeadWrite?.(transaction);
      if (bundle.archivedBranch) transaction.objectStore('branches').put(bundle.archivedBranch);
      transaction.objectStore('branches').put(bundle.activeBranch);
      transaction.objectStore('checkpoints').put(bundle.checkpoint);
      for (const phase of bundle.phases) transaction.objectStore('phases').put(phase);
      transaction.objectStore('commits').add(bundle.commit);
      transaction.objectStore('attempts').put(bundle.attempt);
      transaction.objectStore('leases').put({ ...lease, revision: bundle.attempt.revision });
      await done;
      return 'committed';
    } catch (cause) {
      try { transaction.abort(); } catch { /* Already completed/aborted. */ }
      await done.catch(() => undefined);
      throw cause;
    }
  }

  async getChallengeAttempt(challengeId: string): Promise<PersistedAttempt | null> {
    return this.read('attempts', challengeId);
  }
  async listChallengeAttempts(): Promise<readonly PersistedAttempt[]> {
    const database = await this.open();
    const values = await request(database.transaction('attempts', 'readonly').objectStore('attempts').getAll());
    return (values as PersistedAttempt[]).sort((left, right) => right.updatedAt - left.updatedAt);
  }
  async getActiveAttempts(): Promise<readonly PersistedAttempt[]> {
    return (await this.listChallengeAttempts()).filter((attempt) => attempt.status === 'ACTIVE');
  }
  async getTerminalAttempts(): Promise<readonly PersistedAttempt[]> {
    return (await this.listChallengeAttempts()).filter((attempt) => attempt.status === 'PASSED' || attempt.status === 'FAILED');
  }
  async getCommitByOperation(challengeId: string, operationId: string): Promise<PersistedCommit | null> {
    const database = await this.open();
    const value = await request(database.transaction('commits', 'readonly').objectStore('commits').index('operationKey').get(challengeId + '|' + operationId));
    return value as PersistedCommit | undefined ?? null;
  }
  async loadBranch(challengeId: string, branchId: string): Promise<PersistedBranch | null> {
    return this.read('branches', challengeId + '|' + branchId);
  }
  async loadJournal(challengeId: string, branchId: string) {
    const database = await this.open();
    const key = challengeId + '|' + branchId;
    const values = await request(database.transaction('actions', 'readonly').objectStore('actions').index('branchKey').getAll(key));
    return (values as import('./types').PersistedAction[]).sort((left, right) => left.sequence - right.sequence);
  }
  async loadCheckpoint(challengeId: string, branchId: string) {
    return this.read<import('./types').PersistedCheckpoint>('checkpoints', challengeId + '|' + branchId + '|latest');
  }
  async getActiveBranch(challengeId: string): Promise<PersistedBranch | null> {
    const attempt = await this.getChallengeAttempt(challengeId);
    return attempt ? this.read('branches', challengeId + '|' + attempt.activeBranchId) : null;
  }

  async loadAttempt(challengeId: string): Promise<LoadedAttempt | null> {
    const database = await this.open();
    const transaction = database.transaction([...CHALLENGE_STORES], 'readonly');
    const attempt = await request(transaction.objectStore('attempts').get(challengeId)) as PersistedAttempt | undefined;
    if (!attempt) return null;
    const commits = await request(transaction.objectStore('commits').index('challengeId').getAll(challengeId)) as PersistedCommit[];
    const latestCommit = commits.sort((left, right) => right.revision - left.revision)[0] ?? null;
    const branchId = latestCommit && latestCommit.revision > attempt.revision ? latestCommit.branchId : attempt.activeBranchId;
    const branchKey = challengeId + '|' + branchId;
    // Requests are issued within one readonly transaction for an atomic load.
    const values = await Promise.all([
      request(transaction.objectStore('definitions').get(attempt.definitionHash)),
      request(transaction.objectStore('datasets').get(attempt.datasetHash)),
      request(transaction.objectStore('branches').get(branchKey)),
      request(transaction.objectStore('actions').index('branchKey').getAll(branchKey)),
      request(transaction.objectStore('checkpoints').get(branchKey + '|latest')),
      request(transaction.objectStore('phases').index('branchKey').getAll(branchKey)),
    ]);
    return {
      attempt,
      definition: values[0] ?? null, dataset: values[1] ?? null, branch: values[2] ?? null,
      actions: values[3], checkpoint: values[4] ?? null, phases: values[5], latestCommit,
    } as LoadedAttempt;
  }

  async claimLease(challengeId: string, ownerId: string, now: number, ttlMs: number): Promise<boolean> {
    const database = await this.open();
    const transaction = database.transaction(['leases', 'attempts'], 'readwrite');
    const done = finished(transaction);
    const prior = await request(transaction.objectStore('leases').get(challengeId)) as PersistedLease | undefined;
    const attempt = await request(transaction.objectStore('attempts').get(challengeId)) as PersistedAttempt | undefined;
    if (!attempt || (prior && prior.ownerId !== ownerId && prior.expiresAt > now)) { await done; return false; }
    transaction.objectStore('leases').put({ challengeId, ownerId, revision: attempt.revision, expiresAt: now + ttlMs });
    await done;
    return true;
  }
  async renewLease(challengeId: string, ownerId: string, now: number, ttlMs: number): Promise<boolean> {
    const lease = await this.read<PersistedLease>('leases', challengeId);
    if (!lease || lease.ownerId !== ownerId) return false;
    return this.claimLease(challengeId, ownerId, now, ttlMs);
  }
  async releaseLease(challengeId: string, ownerId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction('leases', 'readwrite');
    const done = finished(transaction);
    const lease = await request(transaction.objectStore('leases').get(challengeId)) as PersistedLease | undefined;
    if (lease?.ownerId === ownerId) transaction.objectStore('leases').delete(challengeId);
    await done;
  }
  async discardCheckpoint(checkpointKey: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction('checkpoints', 'readwrite');
    const done = finished(transaction);
    transaction.objectStore('checkpoints').delete(checkpointKey);
    await done;
  }
}

