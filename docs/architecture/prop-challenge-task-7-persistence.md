# Prop Challenge Task 7 — Replay persistence contract

Status: implemented for BTC Bar Replay Challenge v1. This document does not define Live Challenge, server storage, Gold, readiness scoring, or coaching behavior.

## Authority and reconstruction

IndexedDB stores canonical inputs and identity: the frozen Challenge definition, one immutable dataset record keyed by its content hash, accepted Task 5 action rows, branch graph metadata, commit heads, phase lifecycle records, stable Task 3A checkpoints, immutable terminal evidence, and a writer lease. React state is a projection and is rebuilt after restore.

A restore loads one atomic repository snapshot, verifies the storage schema and the complete Challenge version set, verifies the frozen definition and dataset hashes, and validates the active branch, contiguous action range, and every deterministic action identity. A valid checkpoint cache hydrates the stable coordinator state and only later candles/actions are replayed. The resulting state witness must equal the committed state witness before the read model is published. A missing or invalid cache is discarded and reported as recovered, then the coordinator is rebuilt from the complete canonical journal.

Schema v1 keeps the Task 3A accounting checkpoint together with a dataset-free stable coordinator cache, its content hash, cursor, and action count. The cache is acceleration data: the frozen definition, frozen dataset, journal, branch, and commit remain the source of truth, and full reconstruction remains available whenever validation fails.

## IndexedDB schema v1

Database: `mycryptostack-replay-challenges`

| Store | Key | Purpose |
| --- | --- | --- |
| `attempts` | `challengeId` | Active head, cursor, phase, status, hashes, versions, revision |
| `definitions` | `definitionHash` | Shared immutable frozen Challenge definitions |
| `datasets` | `datasetHash` | Shared immutable BTC replay datasets and manifests |
| `branches` | `challengeId|branchId` | Retained branch graph and immutable terminal result |
| `actions` | `challengeId|branchId|sequence` | Ordered accepted Task 5 action journal |
| `commits` | `challengeId|revision` | Idempotent operation receipt and canonical committed head |
| `checkpoints` | `challengeId|branchId|latest` | Stable accounting checkpoint plus replaceable coordinator cache |
| `phases` | `challengeId|branchId|phaseId` | Isolated phase identity, economics, and terminal evidence |
| `leases` | `challengeId` | Single-writer owner, revision, and expiry |

Definitions and datasets are inserted only when their hash key is absent, so attempts reference shared immutable content rather than duplicating it.

## Atomic commit protocol

Task 7 uses a private candidate plus one strict-durability IndexedDB transaction:

1. Validate the command against the current Task 5 coordinator and create a private deterministic candidate.
2. Derive new action rows and the stable accounting/rule state without publishing the candidate.
3. In one `readwrite` transaction, verify the operation ID, writer lease, and expected attempt revision.
4. Append only new action rows.
5. Store archived/new branch state, the latest checkpoint cache, phase records, operation commit, attempt head, cursor, and lease revision.
6. Wait for transaction completion.
7. Publish the candidate read model to the UI.

An aborted transaction publishes nothing and retains the prior coordinator. A repeated operation ID returns its existing commit only when branch, cursor, and state witness agree; it never reapplies fills, fees, P&L, days, warnings, or terminal decisions. A stale head can be repaired from the newest complete commit. A head beyond its contiguous journal is corruption and cannot fabricate commands.

## Branches, phases, and terminal results

Rewind archives the old branch and creates a new active branch with parent, fork cursor, generation, and retained causal-prefix actions in the same transaction. Exactly one branch ID is stored in the attempt head. Restore loads only that branch, while older failed or passed branches remain queryable.

Each phase record has its own account ID, starting capital, start cursor, status, and terminal cursor/result. Phase 1 pass evidence is written before Phase 2 activation. Restoring at that boundary preserves `NextPhaseEligible`; restoring after activation uses the fresh Phase 2 account and cannot import Phase 1 cash, fees, day counts, positions, or orders.

Terminal branch and phase results include the terminal checkpoint, account projection, breach or target/day evidence, version set, definition and dataset hashes, branch ID, and a result hash. Restore compares that immutable record with the version-bound canonical reconstruction.

## Recovery and concurrency

The UI publishes `RESTORING` before loading and does not display a provisional SAFE/ACTIVE account. Errors are explicit: `CORRUPT`, `UNSUPPORTED_VERSION`, `DATASET_UNAVAILABLE`, `NOT_FOUND`, `LEASE_CONFLICT`, and `STALE_WRITER`. There is no fallback account reset.

A lease permits one writer for an attempt. Every mutation renews the lease and commits against an expected revision. A second tab restores read-only while the lease is live. Expired ownership may be claimed; the former owner then receives a lease or stale-revision rejection and is switched to read-only. This prevents silent last-write-wins behavior.

## Persistence boundaries

Cursor/head updates and accepted commands use incremental writes; the journal is never rewritten during ordinary forward replay. Rewind writes the retained prefix once into a new branch. One latest stable checkpoint is updated at each durable domain boundary. Visual chart marks and arbitrary component state are reconstructed and are not persisted.

The `/challenges` page queries real persisted attempts. Active rows link to Continue and terminal rows link to View. If history is empty, no rows are fabricated.

## Validation coverage

The Task 7 persistence suite covers all 54 requested concerns through grouped end-to-end cases: create/load and typed history queries; One-Step and Two-Step state equality; cash, rules, days, warnings, fees, terminal decisions and dataset exhaustion; complete Task 5 command journaling; operation idempotency; real transaction aborts; missing, corrupt, and stale checkpoints/heads; definition, dataset, journal, branch, payload and version corruption; phase-boundary restore and fresh Phase 2 economics; rewind graph retention; multi-writer leases/revisions; UI restore/error/history integration; dashboard projection; route links; and the unchanged legacy replay regression suite.

The bounded performance case uses 100 daily candles and 40 accepted actions. After adding the validated stable-state cache, repeated validation runs restored in 145–389 ms with a 31,312-byte canonical journal and a 1,282,713-byte checkpoint/cache record. The test enforces journal/checkpoint size ceilings and a restore ceiling of 10 seconds in the test environment. The larger cache is one replaceable record per active branch, contains no dataset copy, and is never authoritative; a later persistence optimization should compress or compact it for very long replay ranges.




