# Prop Challenge Task 8 — Deterministic reporting

Task 8 adds a read-only report projection and `/challenges/[challengeId]/report` for BTC Replay Challenge attempts. It does not add Readiness Score, coaching, Live Challenge, Gold, server persistence, or export behavior.

## Evidence architecture

`loadChallengeReport` loads the active branch atomically, validates the frozen definition and dataset, validates the journal sequence and hashes, validates the latest stable checkpoint and version set, and compares its state witness with the committed head. It never claims a writer lease and never repairs or mutates persistence.

The stable checkpoint is authoritative for the current outcome. A report-only reconstruction regenerates economically meaningful Task 2 facts and phase evidence. Identical price observations without working orders are compacted because they cannot change execution, accounting, or rule state; normal Replay uses the unchanged full path. Task 3 provides cash, equity, fees, realized P&L, day settlements, and floors. Task 4 provides pass/fail, day qualification, warnings, danger, rearm, breach evidence, and primary-breach ordering.

React receives one frozen `ChallengeReportReadModel`. It does not import the execution reducer, accounting ledger, or rule engine.

## Projection sections

- `summary`: status, health, capital, current account values, all-phase aggregates, current target/day progress, replay period.
- `phases`: isolated phase capital, cursors, times, economics, counters, lifecycle count, and breach.
- `trades`: canonical fill lifecycle, entry/exit commissions, partial fills, reversal links, protection history, duration, and actual close reason.
- `days`: finalized UTC ledgers plus one explicitly unqualified `IN_PROGRESS` current day per activated phase.
- `riskTimeline` and `decisionTimeline`: canonical Task 4 ordering and checkpoint linkage.
- `failureAnalysis` or `passAnalysis`: terminal evidence only; no advice or score.
- `branch` and `provenance`: active generation plus checkpoint, ledger, definition, dataset, commit, witness, and version identities.

Archived branch selection is deferred because Task 7 exposes branch-by-id reads but no atomic archived-branch commit-head query. The current active branch is fully isolated and reports abandoned outcomes only through its branch metadata, never by merging their economics.

## Performance

Report construction is done once in the route loader effect. Tables virtualize over 100 rows. A 10/120/400-bar flat replay fixture measured approximately 24/51/209 ms for report reconstruction and projection in the combined Challenge suite. Source attempt creation is outside report load time. The stable checkpoint prevents a second full accounting/rules replay during page load.

## Verification matrix

The Task 8 suite and the existing Task 2–7 suites cover: One-Step active/failed/passed; Two-Step Phase 1/final/fresh Phase 2; exact gross/net/fees; partial close; reversal; stop, target, trailing and gap exits; working-order entry; finalized/current days; active/profitable qualification; warning/danger/breach/rearm; daily, maximum, inactivity and simultaneous breaches; deterministic primary reason; phase/challenge pass; rewind isolation; abandoned failed and new passing branches; reload equivalence; provenance; corrupt/unsupported state; model determinism; presentation-only React; no sample data; premium rendering; and unchanged legacy boundaries.

## Visual review

Desktop and 390px captures were reviewed against the Task 6 design language. The report uses broad graphite surfaces, restrained semantic color, tabular financial values, compact shared DataTables with contained horizontal scrolling, single-column mobile composition, clear risk hierarchy, and collapsed technical evidence. No temporary preview fixture or screenshot remains in the repository.
