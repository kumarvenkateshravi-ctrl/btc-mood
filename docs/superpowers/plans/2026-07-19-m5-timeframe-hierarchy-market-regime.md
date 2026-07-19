# M5 — Timeframe Hierarchy + Market Regime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two cross-timeframe engines — per-TF **Market Regime** and the **Timeframe Hierarchy** (authority, alignment, control transfer, `overallMarketState`) — consuming `TimeframeSnapshot[]` distilled from the frozen M0–M4 pipeline. Pure, deterministic, invisible.

**Architecture:** `buildTimeframeSnapshots(candlesByTf)` (helper, outside core) runs M0–M4 per TF + `classifyRegime`; `computeTimeframeHierarchy(snapshots)` reuses the frozen M3 vote primitive with TFs as weighted voters, then computes authority/controller/overallMarketState.

**Tech Stack:** TypeScript, Vitest. Reuses `lib/mtf/agreement/vote.ts` and `lib/mtf/indicators/shared.ts` (`clamp`).

## Global Constraints

- **Spec is law:** every formula, threshold, regime rule, authority/controller rule, and `overallMarketState` branch is frozen in `docs/superpowers/specs/2026-07-19-m5-timeframe-hierarchy-market-regime-design.md`.
- **M5 core never sees candles** — consumes `TimeframeSnapshot[]`. The `buildTimeframeSnapshots` helper is the only place that runs M0–M4.
- **Reuse M3 vote** (`tally/agreementFrom/dominanceFrom/conflictFrom`) — TFs as `Voter { id, verdict, confidence, weight }`. No new voting engine.
- **Config-driven:** `TIMEFRAME_HIERARCHY` + position-derived `tfWeight`/`tfRole`; thresholds in config. No hardcoded per-literal-TF logic.
- Pure, deterministic, replay-safe, `schemaVersion:1`, generic/data-driven explanation.
- **Releasable-per-task invariant:** every task ends with ✅ `tsc` clean (no new errors beyond pre-existing `components/ui/DataTable.tsx`) ✅ FULL suite green ✅ no observable behavior change ✅ one atomic commit ✅ graph updated.
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`. Nothing outside `lib/mtf/**` + docs.

---

## Task 1: Contract + config

**Files:** Create `lib/mtf/timeframe/timeframeTypes.ts`, `lib/mtf/timeframe/config.ts`, `config.test.ts`.
- `timeframeTypes.ts`: contract verbatim from spec (`RegimeType`, `OverallMarketState`, `TimeframeRole`, `TimeframeSnapshot`, `RegimeResult`, `TimeframeSignal`, `TimeframeEntry`, `HierarchyResult`), importing `Timeframe` from `../../types`, `Verdict` from `../types`, `CategoryResult` where needed.
- `config.ts`: `TIMEFRAME_HIERARCHY`, `tfWeight(tf)` = `len − indexOf` (unknown → 0), `tfRole(tf)` by tier thirds (top⅓ context, mid⅓ confirmation, bottom⅓ trigger), `REGIME_THRESHOLDS`, `AUTHORITY`, `HIERARCHY_THRESHOLDS`.

- [ ] **Step 1: Failing tests (`config.test.ts`):** `tfWeight('1d')===6`, `tfWeight('5m')===1`, unknown→0; `tfRole('1d')==='context'`, `tfRole('1h')==='confirmation'`, `tfRole('5m')==='trigger'`.
- [ ] **Step 2:** FAIL. **Step 3:** implement types + config. **Step 4:** PASS.
- [ ] **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M5 timeframe contract + config`

---

## Task 2: Market Regime engine

**Files:** Create `lib/mtf/timeframe/regime.ts`, `regime.test.ts`.
- Produces: `classifyRegime(trend: CategoryResult, volatility: CategoryResult): RegimeResult` per spec.

- [ ] **Step 1: Failing tests:** strong bullish trend → `trending_up`; strong bearish → `trending_down`; weak trend + volatility state `expanding` → `expansion`; weak + `compressed` → `compression`; weak + `normal` → `ranging`; `clarity` in range; diagnostics populated. (Synthetic `CategoryResult` fixtures.)
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M5 market regime engine`

---

## Task 3: Hierarchy engine — vote, authority, controller, per-TF

**Files:** Create `lib/mtf/timeframe/hierarchy.ts`, `hierarchy.test.ts`.
- Produces (partial in this task): `computeTimeframeHierarchy(snapshots): HierarchyResult` covering `htfBias`, `alignment`, `conflict` (via M3 vote), per-TF `authority`/`role`/`agreesWithHTF`, `controller` + `controllerAuthority` (top-down with transfer), `contributors`. `overallMarketState`/`transition`/`signals`/`warnings` land in Task 4 (temporary placeholders: `overallMarketState:'range_bound'`, `transition:false`, empty arrays — replaced in Task 4).

- [ ] **Step 1: Failing tests:** aligned bullish stack → `htfBias:'bullish'`, high `alignment`, controller = top TF; **control transfer** — top TF low authority (low confidence/clarity), a lower TF high → controller = the lower TF; per-TF `authority = round(0.6·confidence + 0.4·regimeClarity)`; `agreesWithHTF` correct; empty snapshots → neutral/safe result.
- [ ] **Step 2–4:** TDD (synthetic `TimeframeSnapshot[]`). **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M5 hierarchy vote + authority + controller`

---

## Task 4: overallMarketState + transition + explanation

**Files:** Modify `lib/mtf/timeframe/hierarchy.ts`; add cases to `hierarchy.test.ts` (or `hierarchyState.test.ts`).
- Complete `overallMarketState` (continuation/pullback/transition/reversal_risk/range_bound/compression/expansion), `transition` flag, and `signals`/`warnings` per the spec catalog (generic codes, ids interpolated).

- [ ] **Step 1: Failing tests:** bullish context + aligned trigger → `bullish_continuation` + `TF_STACK_ALIGNED`; bullish context + opposed trigger + strong context → `bullish_pullback`; opposed trigger + weak context → `reversal_risk` + `TF_REVERSAL_RISK`; neutral htfBias + controller compression → `compression`; control transfer present → `TF_CONTROL_TRANSFER` naming both TFs; high conflict → `transition:true` + `TF_STACK_CONFLICT`.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M5 overall market state + hierarchy explanation`

---

## Task 5: buildTimeframeSnapshots helper (real pipeline)

**Files:** Create `lib/mtf/timeframe/snapshots.ts`, `snapshots.test.ts`.
- Produces: `buildTimeframeSnapshots(candlesByTf: Partial<Record<Timeframe, Candle[]>>): TimeframeSnapshot[]` — per TF runs `createDefaultRegistry().evaluate → computeCategoryIntelligence → computeAgreement → computeConfidence`, `classifyRegime(cats.trend, cats.volatility)`, assembles snapshot; ordered by `TIMEFRAME_HIERARCHY`.

- [ ] **Step 1: Failing tests:** real candles for 2–3 TFs → snapshots with valid `bias`/`regime`/`confidence` in range, one per input TF, ordered; empty candles for a TF → snapshot still well-formed (neutral/none); end-to-end `buildTimeframeSnapshots → computeTimeframeHierarchy` produces a valid `HierarchyResult` (schemaVersion 1, valid `overallMarketState`); determinism.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M5 buildTimeframeSnapshots helper`

---

## Task 6: Verification + docs + memory

- [ ] `npx vitest run` all green; `npx tsc --noEmit` clean.
- [ ] `git diff --name-only <base>..HEAD | grep -v '^lib/mtf/' | grep -v '^docs/'` → empty.
- [ ] `graphify update .`; add an **M5 section** to `docs/architecture/market-intelligence-pipeline.md` (mark M5 shipped, M6 next) and update memory `mtf-engine.md`.
- [ ] **Commit:** `docs: M5 pipeline + memory; verification`

## Self-Review Notes

- **Spec coverage:** contract+config (T1), regime (T2), hierarchy vote/authority/controller (T3), overallMarketState/transition/explanation (T4), snapshot helper + real pipeline (T5), verification/docs (T6). All decisions: snapshot input model (T5 helper outside core), M3 vote reuse (T3), 5 stationary regimes (T2), overallMarketState cross-TF (T4), hybrid authority + transfer (T3), configurable hierarchy (T1). M6-facing surface frozen in the contract (T1).
- **Type consistency:** `computeTimeframeHierarchy(TimeframeSnapshot[]) → HierarchyResult`; `buildTimeframeSnapshots(candlesByTf) → TimeframeSnapshot[]`; Voters built inline for the M3 primitive; `tfWeight`/`tfRole` single-sourced in config.ts.
- **Import paths:** `lib/mtf/timeframe/` → `Candle`/`Timeframe` from `../../types`, `Verdict`/`CategoryResult` from `../categoryTypes`/`../types`, vote from `../agreement/vote`.
