# M7 — Probability Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `computeProbability(lifecycle, hierarchy) → ProbabilityResult` — three normalized probability layers (stage transitions, direction, trader-facing market outcomes) from conservative model priors + named multiplicative adjustments, honestly labeled `calibration: 'prior'`, fully reconstructable from contributors.

**Architecture:** `priors.ts` (the calibration swap point) → three layer engines (transitions, directional, outcomes) each producing a normalized distribution + audit contributors → minimal opportunity (score/grade — distribution actionability, NOT trade quality) → explanation → orchestrator.

**Tech Stack:** TypeScript, Vitest. Reuses `CYCLE_ORDER` from `lib/mtf/lifecycle/config.ts`, `clamp` from `lib/mtf/indicators/shared.ts`.

## Global Constraints

- **Spec is law:** every prior, factor, bucket mapping, threshold, and formula is frozen in `docs/superpowers/specs/2026-07-19-m7-probability-engine-design.md`.
- **Inputs are `TrendLifecycleResult` + `HierarchyResult` only** — no candles/indicators/categories; M7 never recomputes M1–M6. M8 will consume only `ProbabilityResult`.
- **Honesty:** v1 always `calibration:'prior'`, `modelVersion:'1.0'`, `sampleSize: 0`, `confidenceInterval` undefined; permanent `PROB_MODEL_PRIORS` signal. No `expectedRR`/`executionQuality` (M9 owns those — price-level concepts M7 cannot fund).
- **Multiplicative audit identity:** `final = prior × Π(factors) / Z`; contributors record `{layer, outcome, source, factor}` (factor ≠ 1 only); a reconstruction test reproduces each distribution from its contributors.
- Probabilities 0–1 floats (4 dp); per-layer Σ ∈ [0.99, 1.01] (tested).
- Pure, deterministic, replay-safe, no React/UI.
- **Releasable-per-task invariant:** every task ends with ✅ `tsc` clean (no new errors beyond pre-existing `components/ui/DataTable.tsx`) ✅ FULL suite green ✅ no observable behavior change ✅ one atomic commit ✅ graph updated.
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`. Nothing outside `lib/mtf/**` + docs.

---

## Task 1: Contract + config + priors

**Files:** Create `lib/mtf/probability/probabilityTypes.ts`, `config.ts`, `priors.ts`; test `priors.test.ts`.
- `probabilityTypes.ts`: contract verbatim from spec (`TransitionOutcome`, `OutcomeDirection`, `MarketOutcome`, `OpportunityGrade`, the four probability/contributor/signal interfaces, `ProbabilityResult`), importing `TrendStage` from `../lifecycle/lifecycleTypes`.
- `priors.ts`: `PROBABILITY_MODEL_VERSION`, `TRANSITION_PRIORS`, `TRANSITION_PRIOR_OVERRIDES` verbatim (JSDoc: "THE calibration swap point — replace with an empirical matrix later, zero contract change").
- `config.ts`: `PROB_FACTORS`, `PROB_THRESHOLDS`, `OPPORTUNITY_GRADES` verbatim.

- [ ] **Step 1: Failing tests (`priors.test.ts`):** base priors sum to 1; every override stage's effective prior set sums to 1 (merge override over base and check); model version is `'1.0'`; grade thresholds descending.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Releasable gate.** **Step 6: Commit:** `feat(mtf): M7 probability contract + priors + config`

---

## Task 2: Transition engine

**Files:** Create `lib/mtf/probability/transitions.ts`, `transitions.test.ts`.
- Produces: `transitionProbabilities(lifecycle: TrendLifecycleResult): { distribution: TransitionProbability[]; contributors: ProbabilityContributor[] }` per spec §Layer 1 (target-stage mapping incl. `regress → CYCLE_ORDER[i−1]` with off-cycle/index-0 → `'range'`; break → `'reversal'`), plus an exported `normalize(entries)` helper (0–1, 4 dp) reused by Tasks 3–4.

- [ ] **Step 1: Failing tests:** neutral lifecycle (conf 50, no invalidation, trajectory advancing, strength 50, freshness 50) → distribution equals bare priors; high `nextStageConfidence` sharpens advance (hand-computed factor); invalidated → advance shrinks, regress+break grow; trajectory regressing → regress boosted; exhaustion 85 → break boosted; stage override (e.g. `range`) uses `TRANSITION_PRIOR_OVERRIDES`; Σ ∈ [0.99,1.01]; **audit reconstruction** (prior × Πfactors / Z reproduces distribution); factor-1 contributors omitted.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M7 transition probability engine`

---

## Task 3: Directional engine

**Files:** Create `lib/mtf/probability/directional.ts`, `directional.test.ts`.
- Produces: `directionalProbabilities(lifecycle, hierarchy): { distribution: DirectionalProbability[]; contributors }` per spec §Layer 2.

- [ ] **Step 1: Failing tests:** aligned bullish stack (htfBias bullish, alignment 80, conflict 10, lifecycle bullish, strength 70) → P(bullish) dominant, hand-computed; high conflict → sideways boosted; range-family stage → sideways boosted; neutral everything → ~⅓ each; Σ tolerance; audit reconstruction.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M7 directional probability engine`

---

## Task 4: Market outcome engine

**Files:** Create `lib/mtf/probability/outcomes.ts`, `outcomes.test.ts`.
- Produces: `marketOutcomeProbabilities(transitions: TransitionProbability[], directional: DirectionalProbability[], lifecycle): { distribution: OutcomeProbability[]; contributors }` per spec §Layer 3 (bucket table + false-breakout override + the three `outDirection` modulations; empty buckets omitted).

- [ ] **Step 1: Failing tests:** trending continuation case → `continuation` dominant; expected `healthy_pullback` advance mass → `pullback` bucket; **false-breakout override** (stage `breakout`, regress/break mass → `false_breakout`, not reversal/range); directional modulation shifts mass toward reversal when opposite direction is probable (hand-computed); range-stage case → `range` dominant; buckets with zero mass absent; Σ tolerance; audit reconstruction.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M7 market outcome engine`

---

## Task 5: Opportunity + explanation

**Files:** Create `lib/mtf/probability/opportunity.ts`, `explanation.ts`, `opportunity.test.ts`, `explanation.test.ts`.
- `opportunityOf(mostLikelyOutcome, dominantDirection): { score; grade }` — `round(100·(0.6·P_outcome + 0.4·P_direction))`, grades per `OPPORTUNITY_GRADES`. JSDoc: distribution actionability, NOT trade quality; RR/execution belong to M9.
- `explainProbability(ctx): { signals; warnings }` — `PROB_MODEL_PRIORS` (always while prior), `PROB_HIGH_CONVICTION` (≥ .65), `PROB_UNCERTAIN` (< .40), `PROB_REVERSAL_ELEVATED` (reversal or false_breakout ≥ .25).

- [ ] **Step 1: Failing tests:** opportunity exact values + all four grade bands; each signal/warning fires on its controlled context; `PROB_MODEL_PRIORS` always present.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M7 opportunity + probability explanation`

---

## Task 6: Orchestrator

**Files:** Create `lib/mtf/probability/probabilityEngine.ts`, `probabilityEngine.test.ts`.
- `computeProbability(lifecycle, hierarchy): ProbabilityResult` — compose per spec §Orchestrator; dominants = argmax per layer; contributors concatenated; `calibration:'prior'`, `modelVersion: PROBABILITY_MODEL_VERSION`, `sampleSize: 0`, `confidenceInterval` omitted.

- [ ] **Step 1: Failing tests:** **real M0→M7 pipeline** (`buildTimeframeSnapshots → computeTimeframeHierarchy → computeTrendLifecycle → computeProbability` on real candles): schemaVersion 1, `calibration:'prior'`, all three Σ tolerances, dominants match argmax, `PROB_MODEL_PRIORS` present, contributors reconstruct all three layers; empty candles → safe result, no throw; determinism; controlled golden (fixed lifecycle/hierarchy fixtures → exact distributions).
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M7 probability orchestrator (computeProbability)`

---

## Task 7: Verification + docs + memory

- [ ] `npx vitest run` all green; `npx tsc --noEmit` clean.
- [ ] `git diff --name-only <base>..HEAD | grep -v '^lib/mtf/' | grep -v '^docs/'` → empty.
- [ ] `graphify update .`; add an **M7 section** to `docs/architecture/market-intelligence-pipeline.md` (mark M7 shipped, M8 next; record the M8-facing surface = the whole `ProbabilityResult`, and the calibration reservation) and update memory `mtf-engine.md`.
- [ ] **Commit:** `docs: M7 pipeline + memory; verification`

## Self-Review Notes

- **Spec coverage:** contract/config/priors (T1), Layer 1 (T2), Layer 2 (T3), Layer 3 + false-breakout override (T4), opportunity + explanation (T5), orchestrator + real pipeline + reconstruction (T6), verification/docs (T7).
- **Hybrid decisions:** three probability layers incl. trader-facing market outcomes (adopted from MTFPlanM7); `modelVersion` + `confidenceInterval` reservations (adopted); `expectedRR`/`executionQuality` EXCLUDED (price-level concepts M7 cannot fund — M9 owns them; opportunity kept as score/grade actionability only); additive explainability example replaced with the multiplicative audit identity (normalization-sound); Laws 1–3 (confidence≠probability, prior-labeled honesty, built-in calibration path) verbatim.
- **Type consistency:** `normalize()` exported from transitions.ts and reused; contributor `{layer, outcome, source, factor}` uniform across engines; priors single-sourced in priors.ts (the swap point).
