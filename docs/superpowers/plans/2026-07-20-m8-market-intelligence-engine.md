# M8 — Market Intelligence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `computeMarketIntelligence(agreement, confidence, hierarchy, lifecycle, probability) → MarketIntelligenceResult` + the single public entry point `computeFullMarketIntelligence(candlesByTf)` — the institutional synthesis (headline, quality, opportunity, risk, readiness, evidence, outlook, narrative, unified signals, diagnostics) of the frozen v1.0 platform.

**Architecture:** pure synthesis — five frozen result objects in, one structured picture out. Four scored blocks (quality/opportunity/risk/readiness ladder), rule-based evidence, deterministic narrative templates, merged signal feed, and pure projections (headline/outlook/diagnostics) assembled in the orchestrator.

**Tech Stack:** TypeScript, Vitest. Reuses `clamp` from `lib/mtf/indicators/shared.ts` and the frozen v1.0 compute functions for the full-stack entry point.

## Global Constraints

- **Spec is law:** every weight, band, ladder rule, evidence rule, and template is frozen in `docs/superpowers/specs/2026-07-20-m8-market-intelligence-engine-design.md`.
- **Platform v1.0 is permanently frozen** — M8 consumes the five result contracts, never modifies or recomputes them. Nothing outside `lib/mtf/**` + docs.
- **Determinism:** no timestamps, no execution-time fields anywhere. Same inputs ⇒ identical output.
- **Readiness = environment gate** (no direction/entry/size/RR — M9). **No composite conviction score** — quality/opportunity/risk/readiness are the decomposed alternative.
- Narrative passes the banned-vocabulary test (`likely|expected|will|probable|should|forecast|anticipat*|predict*`); probability phrased as "currently favors".
- **Releasable-per-task invariant:** every task ends with ✅ `tsc` clean (no new errors beyond pre-existing `components/ui/DataTable.tsx`) ✅ FULL suite green ✅ no observable behavior change ✅ one atomic commit ✅ graph updated.
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.

---

## Task 1: Contract + config

**Files:** Create `lib/mtf/market/marketTypes.ts`, `lib/mtf/market/config.ts`; test `config.test.ts`.
- `marketTypes.ts`: contract verbatim from spec (`LayerTag`, `QualityLevel`, `MarketGrade`, `RiskLevel`, `ReadinessState`, `EvidenceItem`, `UnifiedSignal`, `MarketIntelligenceResult`), importing the frozen types (`Verdict`, `Timeframe`, `OverallMarketState`, `RegimeType`, `TrendStage`, `MarketOutcome`, `OutcomeProbability`).
- `config.ts`: `QUALITY_WEIGHTS/BANDS`, `OPP_WEIGHTS/GRADES`, `RISK_POINTS/BANDS`, `READINESS` verbatim.

- [ ] **Step 1: Failing tests:** quality weights sum to 1; opp weights sum to 1; bands/grades strictly descending; risk bands ascending.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M8 market intelligence contract + config`

---

## Task 2: Quality + Risk engines

**Files:** Create `lib/mtf/market/quality.ts`, `risk.ts`, `quality.test.ts`, `risk.test.ts`.
- `marketQuality(agreement, confidence, hierarchy, lifecycle): { score; level; reasons }` — weighted blend per spec; reasons for components ≥65 / ≤35.
- `marketRisk(agreement, confidence, hierarchy, lifecycle, probability): { score; level; reasons }` — additive named points per spec table; each contributing factor becomes a reason.

- [ ] **Step 1: Failing tests:** quality hand-computed exact score + each band boundary + reasons content; risk each factor individually (hand-computed points), stacked factors clamp at 100, each level boundary, calm market → very_low with no reasons beyond none.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M8 quality + risk engines`

---

## Task 3: Opportunity + Readiness engines

**Files:** Create `lib/mtf/market/opportunity.ts`, `readiness.ts`, `opportunity.test.ts`, `readiness.test.ts`.
- `marketOpportunity(agreement, confidence, lifecycle, probability): { score; grade }` — weighted blend incl. `probability.opportunity.score` as one input; grades A+…F.
- `tradeReadiness(quality, opportunity, risk, hierarchy, probability): { state; reason }` — the four-rung first-match ladder; reason names the deciding rule. Environment gate only.

- [ ] **Step 1: Failing tests:** opportunity exact hand-computed + all six grade bands; readiness — each ladder rung reachable with a controlled fixture (avoid via high risk / dangerous quality / reversal_risk; no_trade via poor quality / sideways dominance; ready via good+B+medium; wait as fallback), first-match precedence verified (avoid beats ready when both would match).
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M8 opportunity + trade readiness engines`

---

## Task 4: Evidence + Narrative engines

**Files:** Create `lib/mtf/market/evidence.ts`, `narrative.ts`, `evidence.test.ts`, `narrative.test.ts`.
- `collectEvidence(agreement, confidence, hierarchy, lifecycle, probability): { supporting; opposing }` — the per-layer rules from the spec, each item `{ source: LayerTag, text }` with values interpolated.
- `composeNarrative(ctx): string[]` — the six ordered template sentences.

- [ ] **Step 1: Failing tests:** each supporting/opposing rule fires on its controlled fixture with the right source tag and interpolated value; quiet market → short lists; narrative — six sentences in order on a full fixture, deterministic (`toEqual` twice), **banned-vocabulary regex never matches any sentence**.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M8 evidence + narrative engines`

---

## Task 5: Unified signal feed

**Files:** Create `lib/mtf/market/unifiedSignals.ts`, `unifiedSignals.test.ts`.
- `unifySignals(agreement, confidence, hierarchy, lifecycle, probability, m8Own): { signals; warnings }` — map each layer's signals/warnings to `UnifiedSignal` with its `LayerTag`; dedupe by `code` (first occurrence wins); sort strong → warning → info. M2 not included (documented).

- [ ] **Step 1: Failing tests:** merged feed carries correct source tags per layer; duplicate codes deduped; severity sort order verified; empty layers safe.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M8 unified signal feed`

---

## Task 6: Orchestrator + full-stack entry point

**Files:** Create `lib/mtf/market/marketEngine.ts`, `marketEngine.test.ts`.
- `computeMarketIntelligence(agreement, confidence, hierarchy, lifecycle, probability): MarketIntelligenceResult` — assembles headline (incl. controller regime from `hierarchy.perTimeframe`, fallback `'ranging'`), the four blocks, evidence, outlook (derivable fields only), narrative, unified feed (+M8's own readiness note as a signal), diagnostics (schema versions + calibration + pass-through scores; NO timing).
- `computeFullMarketIntelligence(candlesByTf)` — runs the frozen stack (`buildTimeframeSnapshots → computeTimeframeHierarchy → computeTrendLifecycle`; M1→M4 on the controller TF's closed candles; `computeProbability`) and returns `{ result, layers }`. Pure composition.

- [ ] **Step 1: Failing tests:** controlled fixture → exact headline/outlook/diagnostics projections; **real M0→M8 pipeline** on real candles: well-formed result, calibration propagated, readiness ∈ union, every evidence source ∈ LayerTag, narrative non-empty + banned-vocab clean, determinism (`toEqual` twice); empty candles → safe, no throw; `layers` returned by the full entry point match what the synthesis consumed.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M8 market intelligence orchestrator + full-stack entry point`

---

## Task 7: Verification + docs + memory

- [ ] `npx vitest run` all green; `npx tsc --noEmit` clean.
- [ ] `git diff --name-only <base>..HEAD | grep -v '^lib/mtf/' | grep -v '^docs/'` → empty.
- [ ] `graphify update .`; add an **M8 section** to the constitution (mark M8 shipped, M9 next; record the M9-facing surface + the "from M7, only ProbabilityResult" clarification) and update memory `mtf-engine.md`.
- [ ] **Commit:** `docs: M8 pipeline + memory; verification`

## Self-Review Notes

- **Spec coverage:** contract/config (T1), quality+risk (T2), opportunity+readiness ladder (T3), evidence+narrative (T4), unified feed (T5), orchestrator + projections + full entry point + real pipeline (T6), verification/docs (T7).
- **Hybrid decisions:** five frozen inputs (Rule 1, resolves the MTFPlanM7 tension); conviction score DROPPED for structured quality/opportunity/risk/readiness (reviewer's call, conceded); readiness kept as environment gate with the M9 boundary frozen (Rule 6); timestamps/execution-time EXCLUDED (determinism); outlook trimmed to derivable fields (no price-level invalidation, no "next controller"); M2 excluded from the unified feed (not in the input set — documented); 13 tasks compressed to 7 (headline/outlook/diagnostics are projections, not engines).
- **Type consistency:** `LayerTag` used by evidence + unified signals; block outputs feed readiness in T3 and the orchestrator in T6; config single-sourced.
