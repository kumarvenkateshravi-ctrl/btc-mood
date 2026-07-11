# Bar Replay Engine — Flagship Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this project forbids subagents). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Elevate Bar Replay from a chart trick to a deterministic, leak-free replay *engine* — the single source of truth that chart, indicators, SMC, scanner, and paper trading all consume during replay.

**References:** `~/Downloads/barReplay.md` (advisor roadmap) + `~/Downloads/replayUpdaate.md` (advisor review of rev 1 — its revised priorities are folded in below).
**Baseline (2026-07-11):** replay UI exists (selector, play/pause/step/scrub/speed 0.1–10x, bookmarks, isolated paper session). Root-cause fix shipped: the chart renders `replayCandles` (it previously rendered live data — replay was a no-op), which also slices the chart-level indicator stack.

## The Prime Invariant (applies to every phase)

> **No subsystem in replay mode may access candles beyond the current replay timestamp.**

Universally: indicators, SMC engine, Technical Scanner, Mood Engine, divergence detection, and any future analytics module. Every phase below either enforces this invariant somewhere new or proves it holds. Trust in this rule is the foundation for every advanced replay feature.

## Staging decision (advisor-directed)

The replay engine is built in two stages, **correctness before architecture**:
- **Stage 1 (Phases 1–2):** index-based replay on the eval timeframe — the current `playIndex` model, made correct and stable everywhere. No time-keyed store yet.
- **Stage 2 (Phase 3):** move the cut to a wall-clock timestamp for cross-timeframe synchronization, only after every subsystem is replay-aware and verified.

## Current state — honest inventory

| Piece | Status |
|---|---|
| Cut-point selector, ReplayBar (play/pause/step/scrub/speed, bookmarks) | ✅ works |
| Chart + eval-TF indicator stack sliced to replay index | ✅ fixed 2026-07-11 |
| Isolated paper session (`replaySession`), TP/SL reconcile per revealed bar | ✅ works |
| `candlesByTf` during replay (SMC, scanner, mood engine, divergence, MTF indicators) | ❌ **leaks future data** — a Daily EMA that already "knows" three days ahead makes replay untrustworthy |
| Replay across TF switch | ❌ resets replay entirely (fixed in Phase 3) |
| Keyboard shortcuts | ❌ none |
| Data validation before replay | ❌ none |
| Determinism / verification tests | ❌ none |

---

## Phase 1 — Replay Correctness (highest priority)

### Task 1.A: Replay-aware `candlesByTf` (Phase 1B in the advisor's words — do this first)
- `lib/replay/replaySlice.ts`: pure helper `sliceCandlesByTf(candlesByTf, cutTime)` — binary search per TF, returns every array truncated at the replay bar's **close time** (a 15m cut at 10:15 keeps the 1h bar that OPENED at 10:00 — it is the forming bar — but recomputes nothing from 11:00 onward).
- `app/app/page.tsx`: while replay is active, swap the `candlesByTf` fed to ChartPanel / RightDock / MoodStrip / scanner hooks / SMC screener with the sliced version (one memoized swap at the top; cut time derives from `replayCandles[playIndex].time`).
- Kills the leak in: divergence markers, SMC overlay MTF uses, SMC screener, scanner engine, confluence dock, mood engine.
- Tests: for a fixed cut, no returned candle in ANY tf has `time > cutTime`; forming-bar edge cases at TF boundaries.

### Task 1.B: Progressive rendering proof (no sudden objects)
- With inputs sliced, SMC objects/BOS/CHoCH/FVGs appear exactly when their bar closes. Prove it: for the SMC golden fixture, `computeSmc(candles.slice(0, k))` events must be a **prefix** of the full run's events for every k (single test loop). This is the mechanical form of the Prime Invariant for SMC.

### Task 1.C: Cache-key audit
- Module-scope caches keyed on closed-bar signatures must include the slice length/last-time so replay steps don't reuse live-data results: audit `smcOverlay` snapshot cache, SMC screener panel cache, any indicator memo keyed on `candles.length` alone. Add the replay index to keys where needed.

### Task 1.D: Replay data validation
- `lib/replay/validate.ts`: gaps per TF interval, duplicate timestamps, broken OHLC. Selector shows "Replay cannot start — missing N candles" instead of replaying bad data. Tests on crafted broken fixtures.

## Phase 2 — Replay Stability

### Task 2.A: Explicit state machine
- Formalize `idle → selecting → ready → playing ⇄ paused → finished → exit` in a small store (`lib/replay/replayState.ts`) that ChartPanel consumes (today it's ad-hoc `'off' | 'selecting' | 'active'` + booleans). Index-based (Stage 1). Alerts/live side-effects check this store instead of scattered flags.

### Task 2.B: Determinism tests
- Two scripted runs (same cut, same play/step/scrub sequence) produce identical indicator outputs, SMC snapshots, screener reports, and paper-session trades. Randomness ban enforced by test.

### Task 2.C: Keyboard shortcuts
- `Space` play/pause, `←/→` step, `Shift+←/→` jump 10, `Home` restart at cut, `Esc` exit — in the existing ChartPanel keydown handler (respects editable-field/popover guards). Status readout in ReplayBar: `Playing · 456/1000 · 45.6%`.

### Task 2.D: Replay Verification (developer mode — promoted to v1 per advisor)
- On replay finish (or on demand), compare replay-produced end state against direct historical computation at the same index: indicators ✓, scanner ✓, SMC ✓, signals ✓ → "Replay Integrity 100%" panel. Any mismatch lists the failing engine. Behind a debug toggle once green; invaluable while stabilizing — it is the Prime Invariant, continuously enforced.

## Phase 3 — Multi-Timeframe Replay (Stage 2: time-keyed engine)

- Move the cut from index to wall-clock timestamp inside the replay store; `playIndex` becomes a derived value per TF (binary search).
- TF switch during replay keeps the moment (remove the reset-on-`selected` effect; keep reset on symbol change).
- Accurate synchronized replay across 5m/15m/30m/1h/4h/1d — the whole MTF dashboard (Mood, confluence, SMC screener) answers "what did the stack look like at that exact moment?" TradingView can't do this; it is our differentiator.
- Verification suite from 2.D re-run across all TFs.

## Phase 4 — Trader Experience

- **Training report** ⭐⭐⭐⭐⭐ — on exit: trades, win rate, avg RR, max drawdown, duration, grade. Data already captured by `replaySession`. A signature feature: replay becomes deliberate practice with a score.
- **Blind drill mode** ⭐⭐⭐⭐⭐ — random BTC day, masked date axis → trade → reveal → score. Pairs with the training report; a defining feature no retail platform offers.
- **Jump to date AND time** ⭐⭐⭐⭐⭐ — set the replay start by datetime picker (reuse the Date chip flow inside selection mode); no scissors-hunting through months.
- **Future-blind axis** ⭐⭐⭐⭐⭐ — whitespace past the replay edge so the axis never hints "700 candles remain"; genuine uncertainty makes practice realistic.

## Phase 5 — Advanced Simulation (v2 — only after replay is rock solid)

- Intrabar execution: O→H→L→C micro-stepping per bar so TP/SL fills resolve realistically (extend `replayReconcileBar` to 4 sub-steps).
- Tick simulation and enhanced order-fill realism (slippage models) after that.

## Also in scope during Phase 2–3 (chart behavior polish)

- Preserve user state on replay start (zoom/drawings/hidden indicators) — scroll to the cut, don't reset the view.
- Smooth playback: `series.update()` per revealed bar instead of full `setData` per step (extend the additional-panes signature technique to `useChartData`); budget: step latency < 16ms at 1× on 5k bars, measured best-of-3.

## Build order (advisor-approved)

1. **Phase 1** — correctness: 1.A `candlesByTf` slice → 1.B progressive proof → 1.C cache audit → 1.D validation
2. **Phase 2** — stability: state machine → determinism tests → keyboard → verification panel
3. **Phase 3** — time-keyed multi-TF replay
4. **Phase 4** — training report, blind drill, jump-to-datetime, future-blind axis
5. **Phase 5** — intrabar/tick simulation
