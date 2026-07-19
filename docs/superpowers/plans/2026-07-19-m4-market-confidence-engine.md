# M4 — Market Confidence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `computeConfidence(indicatorResults, categoryResults, agreementResult, previousConfidence?) → ConfidenceResult` — measures how much the current market state can be *trusted*, consuming M1/M2/M3 outputs only, fully explainable via a signed-contribution audit identity.

**Architecture:** three pillars (indicator/category/agreement confidence) → weighted base → orthogonal evidence + penalties (incl. the weak-pillar limiter) → clamp → state → explanation. Pure functions under `lib/mtf/confidence/`.

**Tech Stack:** TypeScript, Vitest. `clamp` reused from `lib/mtf/indicators/shared.ts`.

## Global Constraints

- **Spec is law:** every pillar formula, config value, penalty/evidence formula, threshold, and code is frozen in `docs/superpowers/specs/2026-07-19-m4-market-confidence-engine-design.md`.
- **Consumes M1/M2/M3 only** — no candles, no recomputation. Pure, deterministic, replay-safe, closed-bar, no React/UI.
- **Audit identity:** `Σ contributors.contribution === raw` and `clamp(raw) === confidence`. No hidden scoring.
- **Config, not magic:** `CONFIDENCE_WEIGHTS`, `CATEGORY_CONFIDENCE_FACTORS`, `CONFIDENCE_THRESHOLDS`, `CONFIDENCE_EVIDENCE`, `CONFIDENCE_PENALTIES` — all exported, JSDoc'd tunable.
- **Semantic-but-declarative:** named category knowledge lives ONLY in `CATEGORY_CONFIDENCE_FACTORS` (aggregation) and the penalty formulas (quality/volatility); no other `if id === …` in logic. Warnings that name a category interpolate the id from data (generic code).
- **Evidence orthogonal to base** (data completeness); quality/volatility are penalties, never base contributors; neutral consensus → low agreement confidence.
- **Releasable-per-task invariant (user-mandated):** every task ends with ✅ `tsc` clean (no new errors beyond pre-existing `components/ui/DataTable.tsx`) ✅ FULL suite green ✅ no observable behavior change ✅ one atomic commit ✅ graph updated.
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`. Nothing outside `lib/mtf/**` + docs.

---

## Task 1: Confidence contract

**Files:** Create `lib/mtf/confidence/confidenceTypes.ts`. (No test — pure types; the audit identity is tested in Task 6.)

- Produces the contract verbatim from the spec (`ConfidenceState`, `ContributionKind`, `ConfidenceLayer`, `ConfidenceSignal`, `ConfidenceContributor`, `ConfidenceResult`).

- [ ] **Step 1:** Write `confidenceTypes.ts` per spec.
- [ ] **Step 2: Releasable gate:** `npx tsc --noEmit` + `npx vitest run` (full suite; unchanged count, proves no breakage).
- [ ] **Step 3: Commit:** `feat(mtf): M4 confidence contract`

---

## Task 2: Indicator confidence aggregator

**Files:** Create `lib/mtf/confidence/indicatorConfidence.ts`, `indicatorConfidence.test.ts`.
- Produces: `indicatorConfidence(indicators: IndicatorResult[]): number` = `Σ(weight·confidence)/Σ(weight)`, rounded; empty → 0.

- [ ] **Step 1: Failing tests:** high (all conf 90 → 90); mixed weighted (conf 80×w2 + conf 20×w1 → round((160+20)/3)=60); empty → 0; single.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Releasable gate.** **Step 6: Commit:** `feat(mtf): M4 indicator confidence aggregator`

---

## Task 3: Category confidence aggregator

**Files:** Create `lib/mtf/confidence/categoryConfidence.ts`, `categoryConfidence.test.ts`.
- Produces: `categoryConfidence(categories: CategoryResult[]): number` using `CATEGORY_CONFIDENCE_FACTORS` (exported here), weighted mean over *present* factor categories, normalized by their summed weight; none present → 0. Quality/volatility ignored here.

- [ ] **Step 1: Failing tests:** all four factor categories conf 80 → 80; quality/volatility present are ignored (don't change the result); subset present renormalizes; empty → 0; exact weighted value on known inputs.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M4 category confidence aggregator`

---

## Task 4: Agreement confidence

**Files:** Create `lib/mtf/confidence/agreementConfidence.ts`, `agreementConfidence.test.ts`.
- Produces: `agreementConfidence(agreement: AgreementResult): number = round(agreement.agreement × (dominantShare + minorityShare))`.

- [ ] **Step 1: Failing tests:** strong directional (agreement 90, shares 0.8+0.1 → round(90×0.9)=81); **neutral consensus (agreement 96, shares 0.05+0.04 → round(96×0.09)=9) — the decisive low-confidence case**; `state:'none'` (shares 0) → 0.
- [ ] **Step 2–4:** TDD (build minimal `AgreementResult` fixtures). **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M4 agreement confidence (neutral consensus → low)`

---

## Task 5: Evidence + penalty engine

**Files:** Create `lib/mtf/confidence/evidence.ts`, `penalties.ts`, `evidence.test.ts`, `penalties.test.ts`.

- `evidence.ts`: `computeEvidence(indicators, categories): { contributors: ConfidenceContributor[]; completeness: number }` — data-completeness bonus per spec (silent detectors).
- `penalties.ts`: `computePenalties(ctx: { agreement; categories; base; indConf; catConf; agrConf }): ConfidenceContributor[]` — conflict, layer_mismatch, low_quality, high_volatility, weak_pillar per the spec table (negative contributions; omit zeros; weak_pillar id = weakest pillar layer). Both import config from `confidenceEngine.ts` (or a shared `config.ts` to avoid a cycle — create `lib/mtf/confidence/config.ts` exporting all five config consts; `categoryConfidence.ts` re-exports `CATEGORY_CONFIDENCE_FACTORS` from there).

- [ ] **Step 1: Failing tests:**
  - evidence: full data → +8; half silent → +4; all silent → 0.
  - penalties: conflict 60 → −9 (round(15×0.6)); layer mismatch present → −10; quality strength 40 → −round(12×0.6)=−7; volatility strength 80 → −round(10×0.8)=−8; weak pillar (base 76, min pillar 42) → −round(0.4×34)=−14 with id = the weak layer; all-strong → no penalties.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M4 evidence + penalty engine`

*(Note: introduce `lib/mtf/confidence/config.ts` in this task; Tasks 2–4 that referenced `CATEGORY_CONFIDENCE_FACTORS` import it from there. If Task 3 already created it locally, move it to config.ts here and re-export — keep a single source.)*

---

## Task 6: Confidence orchestrator

**Files:** Create `lib/mtf/confidence/confidenceEngine.ts`, `confidenceEngine.test.ts`.
- Produces: `computeConfidence(indicatorResults, categoryResults, agreementResult, previousConfidence?): ConfidenceResult` per the spec orchestrator (base contributors + evidence + penalties → raw → clamp → state → diagnostics → optional delta). Signals/warnings wired in Task 7 (Task 6 may leave them `[]` then Task 7 fills, OR call `explainConfidence` which Task 7 creates — implement Task 6 with empty arrays, Task 7 adds explanation + its own tests).

- [ ] **Step 1: Failing tests:**
  - **Audit identity:** `Σ contributors.contribution === raw`, `clamp(raw) === confidence` (compute raw independently in the test).
  - Controlled golden: fixed `IndicatorResult[]`/`CategoryResult[]`/`AgreementResult` → exact `confidence`, `state`, `diagnostics` (hand-computed).
  - Neutral market (all-neutral inputs, agreement neutral) → `state` low/very_low.
  - Weak-pillar: strong agreement + strong indicators + weak categories → confidence materially below the naive blend (limiter applied).
  - `previousConfidence` → `confidenceDelta` = confidence − previous.
  - Determinism.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M4 confidence orchestrator (computeConfidence)`

---

## Task 7: Explanation + verification

**Files:** Create `lib/mtf/confidence/explanation.ts`, `explanation.test.ts`; wire `computeConfidence` to call it.
- Produces: `explainConfidence(ctx): { signals; warnings }` per the spec catalog (generic codes, ids interpolated). `confidenceEngine` populates `signals`/`warnings` from it.

- [ ] **Step 1: Failing tests:** strong case → `CONF_STRONG` + high-pillar signals; conflict → `CONF_HIGH_CONFLICT`; weak pillar → `CONF_WEAK_PILLAR` naming the layer; low quality / high volatility warnings; clamp cases → `CONF_CLAMPED_HIGH/LOW`; `CONF_WEAK_CATEGORY` names the sub-threshold category id.
- [ ] **Step 2: Traceability test (real pipeline):** `registry.evaluate(series) → computeCategoryIntelligence → computeAgreement → computeConfidence`; assert `Σ contributors === raw`; every id a warning names (weak category / weak pillar) exists among inputs or the pillar layers; no dangling ids.
- [ ] **Step 3:** Run → FAIL → implement → PASS.
- [ ] **Step 4: Full verification:** `npx vitest run` all green; `npx tsc --noEmit` clean; `git diff --name-only <base>..HEAD | grep -v '^lib/mtf/' | grep -v '^docs/'` empty.
- [ ] **Step 5: `graphify update .`** + update memory `mtf-engine.md` (M4 complete, frozen; next M5). Update `docs/architecture/market-intelligence-pipeline.md` with an M4 section.
- [ ] **Step 6: Commit:** `feat(mtf): M4 confidence explanation + verification`

## Self-Review Notes

- **Spec coverage:** contract (T1), three pillars (T2–T4), evidence+penalties incl. weak-pillar limiter (T5), orchestrator + audit identity (T6), explanation + traceability + docs (T7). Decisions: relaxed-Rule-6 via config maps (T3/T5), orthogonal evidence/penalty (T5), neutral→low (T4), signed contributions/kind (T1/T6), thresholds config (T1 consumes config from T5's config.ts), quality/volatility as penalties (T5).
- **Type consistency:** `ConfidenceContributor {id,layer,kind,contribution}`; `computeConfidence(IndicatorResult[], CategoryResult[], AgreementResult, previousConfidence?)`; config single-sourced in `config.ts`.
- **Ordering note:** config.ts lands in Task 5 but Task 3 needs `CATEGORY_CONFIDENCE_FACTORS` — create `config.ts` in Task 3 (first consumer) and have Task 5 import it; adjust the Task 5 note accordingly during execution.
