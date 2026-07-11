# Bar Replay Engine — Flagship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this project forbids subagents). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Elevate Bar Replay from a chart trick to a deterministic, leak-free replay *engine* — the single source of truth that chart, indicators, SMC, scanner, and paper trading all consume during replay.

**Reference:** `~/Downloads/barReplay.md` (advisor roadmap, phases mirrored below).
**Baseline (2026-07-11):** replay UI exists (selector, play/pause/step/scrub/speed/bookmarks, isolated paper session). Root-cause fix shipped: the chart now renders `replayCandles` (it previously rendered live data — replay was a no-op). Chart-level indicators now compute on the slice.

## Current state — honest inventory

| Piece | Status |
|---|---|
| Cut-point selector, ReplayBar (play/pause/step/scrub/speed 0.1–10x, bookmarks) | ✅ works |
| Chart + indicator stack sliced to replay index | ✅ fixed today |
| Isolated paper session (`replaySession`), TP/SL reconcile per revealed bar | ✅ works |
| `candlesByTf` during replay (divergence markers, SMC screener, scanner, confluence) | ❌ **leaks future data** — full arrays |
| Mood engine / RightDock / MoodStrip during replay | ❌ read live feed |
| Replay across TF switch | ❌ resets replay entirely |
| Keyboard shortcuts | ❌ none |
| Data validation before replay | ❌ none |
| Determinism tests | ❌ none |

## Architecture (Phase 1 target)

One store, everything subscribes. No module reads the live feed while replay is active.

```
lib/replay/replayEngine.ts        ← NEW single source of truth
  state: 'idle' | 'selecting' | 'ready' | 'playing' | 'paused' | 'finished'
  cutTime: number | null           // WALL-CLOCK time of the cut, not an index
  playIndex: number                // index within the eval TF
  speed: number
  api: start(tf, index) · play() · pause() · step(±n) · scrubTo(i) · exit()
  selectors:
    sliceCandles(tf): Candle[]     // candlesByTf[tf] truncated at cutTime
    sliceByTf(): Record<Timeframe, Candle[]>  // ALL TFs truncated at cutTime
```

Keying the cut on **time** (not index) is what makes multi-TF replay possible: slicing `1h` at the same wall-clock moment as the `15m` cut is a binary search, and TF switching preserves the moment.

`ChartPanel` keeps owning the UI (selector/ReplayBar) but delegates state + slicing to the engine. `useMarketData` consumers receive `sliceByTf()` when active.

## Phase 1 — True Replay Engine + leak elimination (highest priority)

### Task 1: `lib/replay/replayEngine.ts` (headless store + tests)
- Zustand-style external store (same pattern as `replaySession`/`paperStore`): state machine `idle → selecting → ready → playing ⇄ paused → finished → idle`, time-keyed cut, `sliceByTf` with binary search on candle time.
- Tests: state transitions; `sliceByTf` never returns a candle with `time > cutTimeAt(playIndex)` for ANY tf; determinism (two runs of scripted play/step/scrub end in identical state).

### Task 2: Wire `candlesByTf` consumers through the engine
- `app/app/page.tsx`: when engine is active, pass `sliceByTf()` in place of `candlesByTf` to ChartPanel/RightDock/MoodStrip/scanner hooks (single memoized swap at the top).
- Kills the future-data leak in: divergence markers, SMC overlay `candlesByTf` uses, SMC screener, scanner engine, confluence dock, mood engine.
- Test: with replay active at bar N, `buildDivergenceMarkers` and `evaluateSmcScreener` inputs contain no candle newer than bar N's time (assert in a unit test with a fake engine state).

### Task 3: Progressive object reveal (comes free once inputs are sliced)
- SMC engine/overlay already recompute from the slice ⇒ OBs/BOS/CHoCH/FVGs appear exactly when their bar closes. Verify with the golden fixture: `projectSmcSnapshot(computeSmc(candles.slice(0, k)))` events are a **prefix** of the full run's events for every k (add as an engine test — this IS the determinism/no-leak proof).

### Task 4: Replay data validation
- `lib/replay/validate.ts`: gaps (missing bars per TF interval), duplicate timestamps, broken OHLC (`high < low` etc.). On failure the selector shows "Replay cannot start — missing N candles" instead of replaying bad data.
- Tests: crafted broken fixtures.

## Phase 2 — Indicator & scanner synchronization
- Per replay step, the pipeline is already reactive (slice → indicators → SMC → scanner → render). Add a step-sync test: at k, indicator outputs equal computing on `candles.slice(0, k)` directly (guards accidental caching leaks — esp. module-scope caches keyed on closed-bar signatures: **cache keys must include the slice length**; audit `smcOverlay` cache + screener cache).
- Signal/alert replay: markers already derive from the slice. Alerts-lite: suppress LIVE alert side-effects while replay is active (guard in `useAlerts`); optionally log "would have fired" into the replay journal.

## Phase 3 — Chart behavior
- Preserve user state on replay start (zoom/drawings/hidden indicators/TF) — don't call `applyDefaultView` on activation; only scroll so the cut is visible.
- Smooth playback: `series.update()` per revealed bar instead of full `setData` (extend the additional-panes signature approach to `useChartData`'s main path; today each step re-slices → `setData`). Target: 10× speed with zero dropped frames on 5k candles.
- Crosshair stays live during playback (already true; add to the manual QA checklist).

## Phase 4 — Multi-TF replay (our differentiator; TV can't do this well)
- TF switch during replay **keeps the moment**: engine cut is time-keyed, so switching 15m → 1h re-derives `playIndex` by binary search instead of exiting replay (remove the `useEffect` that resets on `selected` change; keep reset on symbol change).
- The multi-TF dashboard (Mood, confluence, SMC screener) replays the same moment across all six TFs — "what did the whole stack look like right then?"

## Phase 5 — Performance
- Incremental reveal (`update()` not `setData`) from Phase 3.
- Precompute-once: indicators that support it can compute full-history once and mask output to the slice ONLY where mathematically identical (SMA/EMA are NOT — they're fine to recompute; renko bricks are the expensive case). Profile first; don't optimize blind.
- Budget: step latency < 16ms at 1× on 5k bars; measured in a perf test like the SMC one (best-of-3, generous hard bound).

## Phase 6 — Polish
- Keyboard: `Space` play/pause, `←/→` step, `Shift+→/←` jump 10, `Home` restart at cut, `Esc` exit. Registered in the existing ChartPanel keydown handler (respects the editable-field + popover guards).
- Status readout in ReplayBar: `Playing · 456/1000 · 45.6%` (bar count exists; add state + %).
- Loading progress when a long history must be fetched before the cut.

## Beyond the advisor doc — recommended trader-essential additions

1. **Replay training report (highest value).** On exit, a session summary from the isolated paper session: trades, win rate, avg RR, max drawdown, best/worst trade — replay becomes deliberate practice with a score, not just a movie. (Data already captured by `replaySession`.)
2. **Blind drill mode.** "Random symbol + random hidden date, date axis masked" — trade it, then reveal. Deliberate-practice mode no retail platform does well; pairs with the training report.
3. **Jump-to-date replay start.** Type a date instead of hunting with the scissors (the Date chip already jumps history — reuse it inside selection mode).
4. **Intrabar tick simulation (v2).** Optional O→H→L→C micro-stepping per bar so TP/SL fills inside a bar resolve realistically instead of on close (TV Premium feature; our `replayReconcileBar` already brackets — extend to 4 sub-steps).
5. **Future-blind axis.** While replaying, extend the time axis with whitespace so the right edge doesn't betray "how much history is left" (the countdown of remaining bars is a spoiler).
6. **Replay bookmarks with notes** (bookmarks exist): name the moment ("CHoCH here"), export with the session report.

## Suggested build order

1. Phase 1 Tasks 1–2 (engine + leak fix) — the credibility core
2. Phase 6 keyboard + status (cheap, daily-felt)
3. Phase 4 multi-TF replay (differentiator)
4. Phase 3 smooth playback + state preservation
5. Training report + jump-to-date
6. Phase 5 perf pass, then blind drill / intrabar as v2
