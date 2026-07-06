# Technical Scanner — FINAL Plan (rev. 3, ARCHITECTURE FROZEN)

> Status: GO (ScannerRules.md). Renamed from "Strategy Lab" → **Technical Scanner**.
> From here: no redesigns, no scope changes, no new core modules — ship sprints.

**Goal:** a strategy engineering platform for single-symbol multi-TF Bitcoin trading:
build → validate → backtest → live signals → tracked trades → analytics. Registry-driven
(indicator #80 = zero UI changes), explainable, versioned, non-repainting.

## Engineering rules (FROZEN — apply to every sprint)

1. **Everything is deterministic.** Closed candle → update series cache → evaluate →
   signal. Never evaluate an open candle; backtest ≡ live by construction.
2. **One source of truth.** Every indicator exists once; chart, builder, backtest,
   alerts and trade engine all consume the same cached series. Intelligence scores
   reuse the SAME weights/config as the Market Context Engine (no formula forks).
3. **Everything is an Event.** Append-only `ScannerEvent` log: StrategyMatched →
   SignalCreated → TradeOpened → TP1Hit/TP2Hit/TP3Hit/Stopped → TradeClosed. Events
   are derived deterministically from closed bars (reconstructable), stored for the
   timeline UX. Never mutated.
4. **Immutable history.** Strategies version (never overwrite); signals/events append
   (never edit/delete). Deletion = `archived` flag.

## Reuse map (unchanged, rev. 2) — ~70% exists
`CUSTOM_INDICATORS` inputs/plots · `candlesByTf` · closed-bar cache pattern ·
`walkVdTrades` lifecycle · VD chart rendering · `vdStats` · explainability grammar ·
localStorage persistence. Deferred post-launch: external alerts, marketplace
(JSON is marketplace-ready now), AI assistant.

## Architecture (`lib/scanner/` pure · `components/scanner/` UI)

- **`registry.ts`** — `ScannerSource` plugins: id, name, group
  (standard/structure/intelligence), params (`IndicatorInputDef`), outputs, allowed
  operators, TFs, `series()` producer, optional `liveOnly` flag.
  - *Standard:* price(close/high/low), EMA, SMA, RSI, MACD(macd/signal/hist), VWAP,
    Supertrend, ATR, ADX(+DI/−DI), Bollinger(upper/basis/lower), Stochastic(k/d),
    Volume, VolumeSMA20, OBV. (Verified plot ids: vwap ✓ basis/upper/lower ✓ k/d ✓.)
  - *Structure:* market structure score (per-bar HH/HL), VD-zone proximity (ATRs to
    nearest healthy zone), inside-zone flag, zone confidence.
  - *Intelligence (USP):* per-bar **Trend/Momentum/Volume/Context Score series**
    (vectorized from the same Context-Engine formulas + weights — Rule 2);
    **Stack Score & Alignment** wrapped from `lib/stackScore.ts`/`lib/alignment.ts`
    as `liveOnly` sources v1 (they aggregate the cross-TF matrix; per-bar series =
    the deferred context-snapshot work). Validator warns that liveOnly conditions
    have no backtest coverage.
- **`operators.ts`** — **Operator Registry** (metadata + per-operand validation +
  evaluate): v1 `>, <, >=, <=, between, crossAbove, crossBelow, increasing,
  decreasing`; the registry shape already accommodates the future set (touches,
  slope>, %change>, highestOf, withinNBars, consecutive…).
- **`seriesCache.ts`** — `(source, params, output, tf, closedBarSig) → series`;
  everything reads from here, nothing recalculates (Rule 2).
- **`types.ts` + `evaluate.ts`** — versioned Strategy JSON (unlimited nesting,
  per-condition TF, marketplace-ready fields) and the single funnel
  `evaluate(strategy, candlesByTf) → per-bar matches + per-condition snapshots`.
- **`validate.ts`** — Validation Engine: unknown source/output/op, operand-type
  mismatch, out-of-range values (RSI > 300), unsupported TF, empty groups, depth cap,
  malformed ranges, liveOnly-in-backtest warning. Runs before save AND evaluate.
- **`signals.ts` + `events.ts` + `scannerStore.ts`** — explainable immutable signals
  (per-condition "Why?" snapshots + confidence), append-only event log (Rule 3),
  versioned strategy store with notes + frozen per-version performance.
- **Chart:** `scanner_signals` registered indicator (arrows, entry/SL/TP1-3, R:R
  boxes, outcome chips — all reused; chart-host-only publishing).
- **Docs:** `docs/TECHNICAL_SCANNER_REGISTRY.md` — the required template every future
  source follows (Name · Inputs · Outputs · Operators · Evaluation · Example · TFs).

## Sprints (TDD; commit each; user verifies visually)

| # | Sprint | Deliverables |
|---|---|---|
| S1 | **Registry foundation** | Indicator Registry (all 3 groups) · Operator Registry (metadata+validate+evaluate) · Series Cache · `evaluate()` interface stub (condition-level) · Registry documentation template. Success = all five exist with tests. |
| S2 | Expression engine | Unlimited-nesting tree evaluator, per-condition TF, prefix-invariance determinism test. |
| S3 | Validation Engine | Full rule list, inline error objects, wired pre-save + pre-evaluate. |
| S4 | Signals + events + trades + persistence | Explainable signals, append-only events, `walkTrades` generalization, versioned store. |
| S5 | Chart overlay | `scanner_signals` indicator. |
| S6 | Technical Scanner UI (right dock) | Replaces the broken `StrategyBuilderPanel` stub. List → builder (registry-driven selects, recursive groups, inline validation), exits, save-as-version + note, enable toggle, **Strategy Inspector** (valid ✓, condition/group counts, TFs used, sources used, estimated evaluation cost, version). Tabs: Conditions · History · Analytics · Versions. |
| S7 | Analytics + backtest + Why? + alerts-lite | Per-version stats & comparison, TP1/2/3 distribution, streaks, event timeline, "Why?" checklist, browser-toast alerts. |
