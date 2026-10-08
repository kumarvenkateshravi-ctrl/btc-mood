# Prop Challenge Task 10 — BTC Replay MVP release gate

## Verdict

The BTC Replay Prop Challenge feature passes its Task 10 release gate. The deterministic Challenge boundary, browser recovery behavior, responsive UI, Challenge accessibility, and measured performance are release-ready.

The host repository still cannot produce a final production artifact because its existing Next route export and ElephantZone type errors fail repository-wide type checking. The legacy paper protection suite also retains its known invalid-long-stop failure. Task 10 does not change those systems.

## Scope and architecture

The verified product is BTC Bar Replay with One-Step and Two-Step Challenge definitions. Production Live Challenge, Gold, server persistence, provider presets, and AI coaching remain outside this release.

The release path is:

`Frozen definition + frozen BTC dataset → replay coordinator → execution facts → exact USD-micro accounting → stable checkpoint → rules/lifecycle → IndexedDB journal/cache → read model → report evidence → readiness score`

The journal, frozen definition, and frozen dataset are canonical. Checkpoints are recoverable caches. Dashboard, report, readiness, and chart presentation consume domain projections; they do not recalculate Challenge economics.

## End-to-end acceptance

### One-Step

- PASS path verified with entry commission, partial-close residual quantity, exit commission, protective state, three finalized active/profitable days, inclusive target, flat account, and no working orders.
- Exact cash, equity, gross realized P&L, commissions, net P&L, risk floors, day counts, report, and readiness reconcile before reload, after durable restore, and after full reconstruction.
- FAIL path verified through SAFE, WARNING, DANGER, and the hard maximum-loss breach. The terminal record retains the exact observed equity, floor, excess, checkpoint, rule, and preceding risk evidence.
- Trading commands are rejected after terminal failure while replay cursor navigation remains available. Reload preserves the failure.

### Two-Step

- Phase 1 PASS, pending transition, next-causal-observation Phase 2 creation, Phase 2 PASS, and final Challenge PASS are deterministic.
- Phase 2 starts with fresh configured capital, drawdown references, fee/P&L state, position/order state, and active/profitable-day counters.
- Phase 1 failure, Phase 2 failure, restore at the pending transition, restore after Phase 2 starts, and rewind to a prefix before the Phase 1 pass are covered by the lifecycle, coordinator, persistence, and release suites.

### Exhaustion and terminal state

Dataset exhaustion remains ACTIVE, preserves the incomplete final day, fabricates no midnight boundary, and produces neither PASS nor FAIL. The same evidence drives report and readiness after reload.

Terminal replay navigation advances only replay position and availability. It cannot mutate frozen terminal economics or evidence.

## Reconstruction, crash recovery, and concurrency

- State witness hashes match between the in-memory state, durable restore, full reconstruction, and prefix/branch reconstruction.
- Duplicate commands and duplicate checkpoints remain idempotent.
- Recovery covers journal-without-checkpoint, checkpoint-with-stale-head, corrupt checkpoint cache, stale leases, interrupted branch creation, missing or duplicate journal sequence, wrong definition/dataset hash, unavailable dataset, and pending Phase 2 transition.
- Invalid cache data is discarded and explicitly reported as recovered. Invalid canonical data and unsupported schema/version data produce an explicit error state; no account is silently reset.
- A second tab receives a read-only attempt when another tab owns the writer lease. Stale writers are rejected, and an expired lease can be reclaimed without last-write-wins mutation.

## Browser acceptance

Actual Chromium runs covered `/challenges`, `/challenges/new`, active/PASS/FAIL dashboards, PASS/FAIL reports and readiness, the `/app?challenge=…` chart widget, empty history, dataset exhaustion, read-only concurrency, route leave/return, browser-context restart, checkpoint recovery, unsupported schema, corrupt definition, and unavailable dataset.

The responsive matrix covered 1440, 1280, 768, and 390 CSS pixels. All tested Challenge pages kept `scrollWidth === viewport width`; wide report tables retain their intentional local scrolling. Desktop and mobile captures show stable financial hierarchy, tabular figures, calm terminal states, and usable report composition.

Keyboard activation works for Challenge type and capital selection. Focus rings, semantic buttons/tabs/radios, non-color status text, meaningful live regions, and terminal labels were verified. Axe reported no serious or critical violations on setup, active dashboard, failed dashboard, PASS/FAIL reports, or the isolated Challenge chart widget. Existing accessibility findings elsewhere on the legacy chart page are outside the Challenge widget and remain host-application debt.

## Performance budgets and measurements

These are release targets rather than accounting contracts:

| Path | Release target | Measured result |
| --- | ---: | ---: |
| Durable cursor command | Prefer `<50 ms` typical, `<100 ms` p95 | 10.2 ms p50, 15.3 ms p95, 16.2 ms max |
| Dashboard presentation | `<16–32 ms` presentation path | Selector returns stable identity for unchanged slices; no measured visible stutter |
| Typical restore | `<500 ms` | 24 ms at 1,000 bars; 83 ms at 5,000 bars |
| Typical report build | `<300 ms` | 88 ms at 1,000 bars; 186 ms at 5,000 bars |
| Readiness build | `<100 ms` | 0.9–3.4 ms across 100–20,000 bars |

Long replay measurements from the full concurrent Challenge suite:

| Bars | Forward | Persist create | Restore | Report build | Readiness | Rewind | Dataset | Journal | Checkpoint | Heap delta* |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 28 ms | 74 ms | 16 ms | 43 ms | 0.9 ms | 74 ms | 8,379 B | 6,553 B | 61,060 B | 1.2 MB |
| 1,000 | 60 ms | 133 ms | 24 ms | 88 ms | 1.8 ms | 131 ms | 82,180 B | 6,625 B | 68,181 B | 2.5 MB |
| 5,000 | 112 ms | 307 ms | 83 ms | 186 ms | 1.1 ms | 303 ms | 410,180 B | 6,641 B | 90,407 B | 7.0 MB |
| 20,000 | 320 ms | 1,151 ms | 304 ms | 723 ms | 3.4 ms | 817 ms | 1,640,181 B | 6,709 B | 173,026 B | 16.2 MB |

\* Heap delta is a practical in-process observation and includes test-runner allocation/GC noise; it is not a semantic budget.

The 20,000-bar report is an explicit long-history bound and exceeds the 300 ms typical target; it does not block normal replay use. Dataset storage grows linearly with the frozen candles. With a fixed eight-action workload, journal size remains essentially flat and the checkpoint grows from 61 KB to 173 KB across 100–20,000 five-minute bars because finalized-day evidence also grows. Action and day-evidence volume, rather than passive price observations alone, is the main checkpoint driver. Broad compaction is not required for this MVP.

The release audit originally exposed an O(history)-per-command durable path severe enough that 1,000 passive bars did not complete within 20 minutes. Durable commands now restore from the last stable checkpoint, using full reconstruction only for the cross-scope pending-phase transition. Flat bars without working orders skip price-sensitive execution/accounting work while preserving UTC boundaries and canonical observation sequence. The 20,000-bar measurements above verify the correction.

## Render and bundle impact

- `useChallengeChartSlice` publishes only when chart-relevant values change, so unrelated Challenge evidence cannot rerender the chart.
- Financial numbers use the shared tabular-number style. Progress widths animate for 200 ms and honor reduced-motion. Fixed composition and local table scrolling prevent page-level layout shifts.
- The optimized build completes compilation before the unrelated repository type error. Raw emitted client entries, excluding the 91 KB shared Next layout runtime, are approximately 516–529 KB for landing/setup/dashboard and 569 KB for report. The Challenge core chunk used by the chart route is 149,906 bytes raw, 40,526 bytes gzip, or 34,714 bytes Brotli.
- Report/readiness copy and service symbols are absent from the chart route entry chunks. The chart imports the coordinator/persistence boundary needed to restore and operate an attempt, while the report UI remains route-specific.

## Source determinism audit

No `parseFloat`, epsilon money comparison, provider-specific execution branch, fallback capital, or hash bypass exists in the shipped Challenge path.

Approved exceptions are:

- `Date.now` in the UI and persistence session supplies wall-clock lease/metadata timestamps, never replay economics.
- `Math.random` appears only in the non-cryptographic fallback tab/attempt identity when `crypto.randomUUID` is unavailable.
- `Number(...)` in calendar validation converts already-bounded instants; report/UI conversions format timestamps, prices, quantities, and read-only chart presentation. Canonical money and quantity calculations remain bigint/scaled decimal operations.
- `toFixed` in readiness formats a bounded presentation score, and chart partial-close presentation converts a UI fraction to the exact eight-decimal command string before strict domain validation.

## Release-blocking defects fixed in Task 10

1. Durable replay processed full history on each command. Stable-checkpoint restore and the flat-observation fast path remove the O(history)-per-bar release blocker.
2. Terminal cursor navigation could recalculate terminal economics. Terminal navigation now changes only replay metadata.
3. A lazy `ChartPanel` mount cleared the restored frozen Challenge dataset. Dataset release now occurs on real symbol changes and real unmounts, while remaining safe under React development Strict Mode effect replay.
4. Report text contained encoding corruption. The report now uses valid Unicode punctuation and has a regression check.
5. Dense Challenge labels and terminal content failed contrast checks. Challenge-scoped color, chart-widget labels, setup capital text, and the failed-state action were corrected without changing global legacy styling.
6. The dashboard lacked a page heading and a progress indicator label. It now has an accessible heading and explicit progress semantics.

## Verification results

- Challenge suite: 17 retained files, 377 tests passed after cleanup.
- Scoped ESLint: passed.
- Strict Challenge-only TypeScript project: passed.
- Browser acceptance: passed in Chromium, including keyboard and axe checks.
- Production build: optimized compilation passed; repository-wide typecheck then failed on the existing `app/api/klines/route.ts` extra `getCounters` export. Full `tsc` also reports the existing ElephantZone `lineStyle` mismatch.
- Legacy paper/replay focus: 19 files and 128 tests passed; the known `paperStore.protection.test.ts:45` invalid-long-stop test remains the sole failure. Challenge mode does not initialize, write IndexedDB, run rules, or show a widget when the Challenge query/context is absent.

## Release checklist

| Area | Verdict |
| --- | --- |
| Execution integrity | PASS |
| Accounting integrity | PASS |
| Checkpoint integrity | PASS |
| Rules/lifecycle integrity | PASS |
| Replay determinism | PASS |
| Persistence integrity | PASS |
| Branch integrity | PASS |
| UI integrity | PASS |
| Report integrity | PASS |
| Readiness integrity | PASS |
| Performance | PASS WITH KNOWN NON-BLOCKING 20,000-bar report bound |
| Accessibility | PASS WITH KNOWN NON-BLOCKING legacy chart-page findings outside the widget |
| Legacy compatibility | PASS WITH KNOWN PRE-EXISTING paper protection test failure |

## Post-MVP scope

After the MVP release, first clear the host repository build/type debt and add the browser acceptance harness to CI. Product work should then harden client storage operations and observability before any separately authorized Production Live Challenge design. Gold, provider presets, server runtime/database migration, AI coaching, and new readiness categories remain deferred.
