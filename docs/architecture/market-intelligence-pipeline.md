# Market Intelligence Pipeline (M0–M9) — Engine Constitution

**Status: 🔒 INTELLIGENCE PLATFORM v1.0 — PERMANENTLY FROZEN (2026-07-19, user-declared).**

M0–M7 together constitute **Version 1.0 of the Intelligence Platform**. From this point:
- **No redesign of the lower layers.** The architectures, formulas, and public contracts of M0–M7 are
  final for v1.
- **Only additive enhancements, bug fixes, or performance improvements** are permitted (per §Versioning:
  additive-only; anything breaking requires a platform major version, not a patch).
- **M8–M10 consume these contracts — they never modify them.** Higher-level reasoning engines build on
  the frozen surfaces below.

Every future milestone (M8 Market Intelligence, M9 Trade Decision, M10 Trading Plan Generator, Alerts,
AI narration, Scanner) references this document rather than re-deriving how these layers interact.
Changing a public contract below requires a version bump (see §Versioning) and an edit here.

```
Candles → M0 Registry → M1 Indicator Intelligence → M2 Category Intelligence → M3 Agreement
                                                                                       │
        M7 Probability ← M6 Trend Lifecycle ← M5 Timeframe Hierarchy + Regime ← M4 Confidence
                │
       (M8 Market Intelligence → M9 Trade Decision → M10 Trading Plan → …)
```

Everything below is pure, deterministic, closed-bar, replay-safe, and free of React/UI/network.
Same inputs ⇒ identical outputs (except explicitly noted timing metadata). All code lives under
`lib/mtf/**`; no layer reads candles except M0/M1.

---

## Roadmap (M0–M10, canonical)

The authoritative milestone plan. Every milestone consumes only lower-layer outputs; each is
pure, deterministic, releasable-per-task, and invisible until explicitly wired to a consumer.

| Milestone | Description | Status |
|-----------|-------------|--------|
| **M0** | Indicator Registry & plugin architecture (registration, metadata, settings, categories, weights, enable/disable, compute contract). | ✅ shipped |
| **M1** | Each indicator returns a standardized `IndicatorIntelligence` object. | ✅ shipped |
| **M2** | Dynamic Category Engines that discover enabled indicators by category. | ✅ shipped¹ |
| **M3** | Agreement engines. | ✅ shipped |
| **M4** | Confidence engines. | ✅ shipped |
| **M5** | Timeframe Hierarchy + Market Regime engines. | ✅ shipped |
| **M6** | Trend Lifecycle detection. | ✅ shipped |
| **M7** | Probability Engine. | ✅ shipped |
| **M8** | Market Intelligence Engine (combine all outputs). | ✅ shipped |
| **M9** | Trade Decision Engine. | ✅ shipped |
| **M10** | Goal-Based Trading Plan Generator. | ← next |

¹ **M2 divergence to reconcile:** the roadmap lists categories *Trend, Momentum, Volume,
Volatility, **Structure, Smart Money*** with *dynamic* per-category indicator discovery. As built
(per the frozen MTFM2 brief) M2 ships *Trend, Momentum, Volume, Volatility, **Quality, Participation***
with **fixed** contributor lists. Structure/Smart-Money categories and dynamic discovery are not yet
implemented — revisit before or during a milestone that needs them.

## UI Wiring — Phase 1b (complete, 2026-07-20)

Before starting M9, the frozen M0–M8 stack was wired into `/custom-multi-timeframe` and
live-validated against real BTCUSDT data (spec:
`docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1b-design.md`).

- `components/mtf/useMarketIntelligence.ts` now calls M8's single entry point,
  `computeFullMarketIntelligence(candlesByTf)`, once per closed-bar signature, and separately
  computes a per-selected-timeframe M1–M4 bundle for the interactive panels.
- Four new dumb renderers added to `components/mtf/MarketIntelligence.tsx`:
  `MarketIntelligenceVerdict`, `TrendLifecyclePanel`, `ProbabilityPanel`, `NarrativeEvidencePanel`.
- Live Playwright validation (0 console errors) confirmed the coherence properties the phase
  exists to prove: controller identical across the verdict/board/trade-context panels; readiness
  ladder consistent with quality/opportunity/risk (`wait` because opportunity grade C sits below
  the B threshold despite good quality and low risk); lifecycle stage consistent with the M5
  `overallMarketState`; M7 probability buckets sum to ~100% on screen; the `model priors`
  calibration badge renders wherever M7 output is shown.
- Deferred (explicitly out of scope for this phase): Phase 2 widget, Phase 3 alerts, consolidating
  `TradeContextCard` into the M8 verdict, and pointing any other page at M8.

**Conclusion: the intelligence stack produces coherent conclusions on live data. M9 (Trade
Decision Engine) may now build on this validated foundation.**

## UI Wiring — Phase 1c (complete, 2026-07-20)

M9's decision wired into `/custom-multi-timeframe` for a multi-day practice period before any
M9 fine-tuning or M10 (user directive via MTFM91c.md: "trade with it → replay it → refine if
necessary → freeze M9"; spec: `docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1c-design.md`).

- `decisionEngine.ts` additively exports `executionTimeframeOf(hierarchy)` (no logic change).
- `components/mtf/useTradeDecision.ts` reuses the page's already-computed `FullMarketIntelligence`
  (never re-runs the stack) and the page's closed-bar-cached `smcByTf`; passes the execution TF's
  `SmcSnapshot` only when the toggle is on. Memoized on the closed-bar signature + toggle.
- `TradeDecisionPanel` (dumb renderer) shows action, execution TF, risk tier, the priors chip,
  gate reason when blocked, the full setup (entry/stop/targets with sources + RR, ATR),
  confluence notes, warnings, and explanation — plus an **SMC confluence on/off toggle** so
  ATR-only vs ATR+SMC decisions can be compared live. Mounted directly below the M8 verdict.
- Live Playwright validation (0 console errors) confirmed M9 defers to M8's environment gate: the
  verdict's readiness (`avoid` / "high environment risk") passed through verbatim as M9 NO TRADE /
  `environment_avoid`; the SMC toggle flipped ON↔OFF without error (a no-trade-by-environment
  decision is correctly unaffected, since the gate fires before pricing).
- The setup path (ready ⇒ entry/stop/targets) and SMC-adjusted levels are proven by unit tests;
  observing them live across regimes is the point of the practice period.
- Deferred: M9 bar-replay integration, alerts, other pages, any M9 logic change, M10.

## M0 — Indicator Registry

**Responsibility:** hold the fixed indicator roster in stable row order; evaluate each against one
timeframe's candles; compose a weighted 0–100 score. Single source of truth for *which* indicators
exist and *how they are scored*. No intelligence.

**Files:** `lib/mtf/types.ts`, `lib/mtf/registry.ts`, `lib/mtf/definitions.ts`.

**Public contract:**
- `createDefaultRegistry(): IndicatorRegistry` — the seven-indicator roster (`ema, supertrend, rsi,
  macd, adx, obv, volume`) in dashboard row order.
- `registry.evaluate(candles: Candle[], opts?: { weights?; settings? }): IndicatorResult[]`.
- `registry.compositeScore(results, weights?): number`.
- `IndicatorDefinition { id, label, sub, kind, category, defaultWeight, evaluate(candles, settings?), subFor? }`.
- `IndicatorEvaluation { score, display, confidence?, strength?, diagnostics?, signals?, warnings? }` —
  what a definition's `evaluate` returns (rich fields optional).

**Invariants:**
- Row order is stable (dashboard order); empty candles ⇒ every indicator scores neutral (50, `display '—'`).
- With default (equal) weights the composite equals the legacy rounded mean (behaviour parity).
- `definitions.ts` is a thin registry: metadata + one-line delegation to the per-indicator engine.

**Depends on:** candles only.

---

## M1 — Indicator Intelligence

**Responsibility:** make each indicator *explainable* — a frozen directional score plus
indicator-local evidence (confidence, strength, diagnostics, signals, warnings). Explainability,
not new trading logic.

**Files:** `lib/mtf/intelligence.ts` (contract), `lib/mtf/indicators/<id>.ts` (one engine per
indicator), `lib/mtf/indicators/shared.ts` (numeric helpers).

**Public contract:**
- `IndicatorIntelligence { id, category, score, verdict, confidence, strength, display, diagnostics, signals, warnings }`.
- `IndicatorResult = IndicatorIntelligence & { weight: number }` — what the registry returns per indicator.
- `IndicatorSignal { code, message, severity: 'info'|'warning'|'strong', timestamp? }`.
- `IndicatorDiagnostics` — marker base; each indicator owns its concrete shape (`EmaDiagnostics`, …).
- Per-indicator `evaluate<Id>(candles, settings?): IndicatorEvaluation` (e.g. `evaluateEma`), delegated to from `definitions.ts`.

**Invariants (the M1 law):**
- **Score frozen.** `score` / `display` / `verdict` / composite are byte-identical to M0. Rich fields
  are additive; they never change the score chain.
- Intelligence values are **indicator-local evidence**, not market conclusions (higher layers aggregate).
- `confidence` / `strength` are built **from the diagnostics object**; all formulas are exported,
  documented, tunable constants (conservative v1 defaults).
- Registry supplies placeholders when an indicator is silent: `confidence ?? score`, `strength ?? score`,
  `diagnostics ?? {}`, `signals/warnings ?? []`.

**Depends on:** M0 (candles + definitions).

---

## M2 — Category Intelligence

**Responsibility:** answer "what does each market *category* think?" — six categories
(`trend, momentum, volume, volatility, quality, participation`), each a typed result with five
diagnostics, category-local confidence/strength, a typed state, and traceable signals/warnings.

**Files:** `lib/mtf/categoryTypes.ts`, `lib/mtf/categoryEngine.ts`,
`lib/mtf/categories/{shared, trend, momentum, volume, volatility, quality, participation}.ts`.

**Public contract:**
- `computeCategoryIntelligence(indicators: IndicatorResult[]): CategoryEngineResult`.
- `CategoryEngineResult { schemaVersion: 1, categories: Record<CategoryId, CategoryResult> }` (typed Record, not array).
- `CategoryResult<S> { id, score, verdict, confidence, strength, state: S, contributors, diagnostics, signals, warnings }`.
- `CategorySignal { code, message, severity, category, source: string[] }` — dedicated (NOT an alias of `IndicatorSignal`); `source` traces contributing indicator ids.
- Typed state unions per category (`TrendState`, `MomentumState`, …); `CATEGORY_CONTRIBUTORS: Record<CategoryId, string[]>`.

**Invariants:**
- **Consumes M1 output only** — no candles, no recomputation, **no cross-category dependencies**
  (each category is independently computable from indicators; participation reads the EMA *indicator*,
  not the Trend category).
- Exactly five diagnostics per category; confidence/strength built from the diagnostics object.
- **No-evidence rule:** all consumed magnitudes 0 ∧ all directionals 50 ⇒ neutral state, confidence 50,
  strength 0, no signals/warnings.
- Non-directional categories (`volatility`, `quality`) hardcode `score 50` — intensity lives in
  `strength`; their no-evidence check reads the *consumed inputs*, not derived dims that saturate on empty.

**Depends on:** M1 (`IndicatorResult[]`).

---

## M3 — Agreement Engine

**Responsibility:** answer "how much does the market agree with itself?" — **Agreement**, not
Confidence (M4 owns Confidence). Weighted voting across indicators and categories; dominance,
conflict, and a self-explaining result.

**Files:** `lib/mtf/agreement/{agreementTypes, vote, conflict, indicatorAgreement, categoryAgreement,
dominance, explanation, agreementEngine}.ts`.

**Public contract:**
- `computeAgreement(indicatorResults: IndicatorResult[], categoryResults: CategoryResult[], previousAgreement?: number): AgreementResult`.
- `AgreementResult { schemaVersion: 1, agreement, conflict, dominantBias, state, consensus,
  indicatorAgreement, categoryAgreement, contributors: Contributor[], signals, warnings, diagnostics,
  previousAgreement?, agreementDelta? }`.
- `Voter { id, verdict, confidence, weight? }` — the ONLY shape the engine reads (both `IndicatorResult`
  and `CategoryResult` satisfy it).
- `AgreementSignal { code, message, severity, source: 'indicator'|'category' }`;
  `Contributor { id, layer, vote, weight }`.
- Tunables: `AGREEMENT_BLEND = { indicator: 0.4, category: 0.6 }`, `AGREEMENT_THRESHOLDS`.

**Invariants (the M3 architectural law):**
- **Generic purity:** the engine is completely unaware of specific indicators/categories — no
  `if id === 'ema'` / `if id === 'trend'`. New voters (VWAP, Ichimoku, new categories) work with zero
  engine changes.
- `agreement = max(bull,bear,neutral)/total·100` (neutral **in** the denominator — lack of conviction
  dilutes agreement).
- `conflict = (1 − |bull−bear|/dir)·(dir/total)·100`, clamped — an **independent** metric, not `100−agreement`.
- `dominantBias` comes from the **combined weighted vote** across both layers (blend renormalized when a
  layer is empty), never by blending the two layers' separate winners.
- **State is agreement quality, conflict is orthogonal:** `none → strong → moderate → conflicted → weak`;
  a strong consensus keeps `state:'strong'` and reports conflict in its own field.
- **Explainability invariant:** every field is traceable from the same result — `contributors` covers
  every input voter, and any id named in a signal/warning message exists in `contributors`.

**Depends on:** M1 (`IndicatorResult[]`) + M2 (`CategoryResult[]`).

---

## M4 — Market Confidence Engine

**Responsibility:** answer "can I trust the current market state enough to act?" — **trust, not
agreement**. A 95%-agreement neutral market yields *low* directional confidence.

**Files:** `lib/mtf/confidence/{confidenceTypes, config, indicatorConfidence, categoryConfidence,
agreementConfidence, evidence, penalties, explanation, confidenceEngine}.ts`.

**Public contract:**
- `computeConfidence(indicatorResults: IndicatorResult[], categoryResults: CategoryResult[], agreementResult: AgreementResult, previousConfidence?: number): ConfidenceResult`.
- `ConfidenceResult { schemaVersion: 1, confidence, state, contributors: ConfidenceContributor[],
  signals, warnings, diagnostics{ indicatorConfidence, categoryConfidence, agreementConfidence,
  evidence, penalties }, previousConfidence?, confidenceDelta? }`.
- `ConfidenceContributor { id, layer, kind: 'base'|'evidence'|'penalty', contribution }` (signed).
- Config (single source `config.ts`): `CONFIDENCE_WEIGHTS` (pillar blend), `CATEGORY_CONFIDENCE_FACTORS`
  (directional-category aggregation), `CONFIDENCE_THRESHOLDS`, `CONFIDENCE_EVIDENCE`, `CONFIDENCE_PENALTIES`.

**Invariants:**
- **Consumes M1/M2/M3 outputs only.** Confidence is trust, not agreement.
- **Audit identity:** `confidence = clamp(Σ contributors.contribution)`; every point maps to a signed
  base / evidence / penalty contribution — no hidden scoring.
- **Base = pillar blend** (indicator/category/agreement confidence). **Evidence** (data completeness)
  and **penalties** (conflict, layer-mismatch, low quality, high volatility, weak-pillar limiter) are
  strictly **orthogonal** to the base — never re-counting a base signal.
- **Neutral consensus → low confidence:** `agreementConfidence = agreement × directionalShare`.
- **Weak-pillar limiter:** a strong result is constrained by its weakest foundational pillar.
- **Semantic but declarative (relaxed Rule 6):** category knowledge lives in `CATEGORY_CONFIDENCE_FACTORS`
  and the named quality/volatility penalties — never ad-hoc `if id === …` in general logic.

**Depends on:** M1 (`IndicatorResult[]`) + M2 (`CategoryResult[]`) + M3 (`AgreementResult`).

---

## M5 — Timeframe Hierarchy + Market Regime

**Responsibility:** the first CROSS-timeframe engine — per-TF stationary **regime**, and how the
timeframes **relate** (authority, alignment, control transfer, `overallMarketState`). Boundary with
M6: M5 = "what is the current multi-timeframe context?"; M6 = "where are we in the trend lifecycle?".

**Files:** `lib/mtf/timeframe/{timeframeTypes, config, regime, hierarchy, hierarchyState, snapshots}.ts`.

**Public contract:**
- `buildTimeframeSnapshots(candlesByTf): TimeframeSnapshot[]` — the only candle-touching helper; runs
  M0→M4 per TF + `classifyRegime`. **Outside** the core.
- `computeTimeframeHierarchy(snapshots: TimeframeSnapshot[]): HierarchyResult`.
- `classifyRegime(trend, volatility): RegimeResult`.
- `RegimeType` (5 stationary: trending_up/down, ranging, compression, expansion); `OverallMarketState`
  (cross-TF composite incl. pullback/transition/reversal_risk); `TimeframeSnapshot`, `HierarchyResult`.
- Config (`config.ts`): `TIMEFRAME_HIERARCHY` + position-derived `tfWeight`/`tfRole`, `REGIME_THRESHOLDS`,
  `AUTHORITY`, `HIERARCHY_THRESHOLDS`.

**Invariants:**
- **M5 core never sees candles** — consumes `TimeframeSnapshot[]`. `buildTimeframeSnapshots` is the sole
  M0–M4 orchestrator.
- **Reuses the frozen M3 vote primitive** — TFs are `Voter { id: tf, verdict: bias, confidence, weight }`.
- **Per-TF regime is stationary; cross-TF interpretation is `overallMarketState`** (pullback/transition/
  reversal_risk live at the hierarchy level, not in regime — clean M6 boundary).
- **Hybrid authority:** intrinsic authority (confidence + regime clarity) + top-down control **transfer**
  when a higher TF drops below the authority threshold.
- **Configurable hierarchy** — swap `TIMEFRAME_HIERARCHY` for scalp/swing with no engine change.

**M6-facing durable surface:** `htfBias`, `alignment`, `conflict`, `controller`, per-TF `authority`,
`overallMarketState`, `transition`, per-TF `regime`. M6 consumes `TimeframeSnapshot[]` + `HierarchyResult`.

**M6 additive extension:** `TimeframeSnapshot` gained two fields for lifecycle evidence (schema stays
additive-compatible, no version bump): `trendFreshness` (from the `supertrend` indicator's
`diagnostics.flipFreshness`) and `momentumExhaustion` (from the `momentum` category's
`diagnostics.exhaustion`), both computed in `buildTimeframeSnapshots`.

**Depends on:** M0–M4 (via `buildTimeframeSnapshots`).

---

## M6 — Trend Lifecycle

**Responsibility:** the first EVOLUTIONARY engine — where is the controller timeframe's trend in its
lifecycle? Boundary with M5: M5 = "what is the current multi-timeframe context?"; **M6 = "where are we
in the evolution of the trend?"**

**Files:** `lib/mtf/lifecycle/{lifecycleTypes, config, stage, expectation, progression, invalidation,
strength, explanation, lifecycleEngine}.ts`.

**Public contract:**
- `computeTrendLifecycle(snapshots: TimeframeSnapshot[], hierarchy: HierarchyResult, previousStage?: TrendStage): TrendLifecycleResult`.
- `TrendStage` — 9-stage canonical cycle (`accumulation → breakout → confirmation → trend_establishment
  → healthy_pullback → continuation → exhaustion → distribution → reversal`) plus off-cycle `range`.
- `TrendLifecycleResult { schemaVersion: 1, timeframe (controller), stage, direction, lifecycleStrength,
  freshness, exhaustion, stageConfidence, nextStageConfidence, progression, expectation, invalidation,
  perTimeframe, signals, warnings }`.

**Invariants:**
- **Never recomputes M1–M5** — consumes `TimeframeSnapshot[]` + `HierarchyResult` only.
- **Controller timeframe is the headline**, with a coarse per-TF stage map alongside (oms-derived
  branches — reversal/pullback/continuation — are stack-wide facts, only meaningful for the controller;
  non-controller snapshots fall through to a regime/freshness/exhaustion-only classification).
- **`accumulation`/`distribution`/`confirmation` are documented approximations** from a single snapshot,
  not precise Wyckoff phases — the rest of the cycle classifies cleanly.
- **`lifecycleStrength` (stage expression) is never conflated with `freshness` (age)** — a trend can be
  fresh-and-strong or old-and-strong; they're independent fields.
- **Expectation, Progression, and Invalidation are separate small engines**, not folded together:
  Expectation = deterministic forward map (current → expected next); Progression = trajectory
  (previous → current: advancing/stalling/regressing); Invalidation = what would break the current stage.
- **`stageConfidence`/`nextStageConfidence` are reserved for M7, NOT probabilities** — they express the
  engine's own confidence in its classification/forecast; M7 (Probability Engine) combines them with
  actual probability modeling without requiring another M6 contract revision.

**M7-facing durable surface:** `stage`, `direction`, `lifecycleStrength`, `freshness`, `exhaustion`,
`stageConfidence`, `nextStageConfidence`, `expectation`, `invalidation`, per-TF stages.

**Depends on:** M0–M5 (via `TimeframeSnapshot[]` + `HierarchyResult`).

---

## M7 — Probability Engine

**Responsibility:** estimate the probability distribution of future market outcomes — deterministic,
explainable, and **honest about its source**. Laws: (1) Confidence ≠ Probability; (2) probability is a
model estimate, not a prediction — v1 is always `calibration: 'prior'` with the permanent
`PROB_MODEL_PRIORS` signal; (3) calibration is built in — `priors.ts` is the swap point where a future
empirical transition matrix (from replay/backtesting) replaces the model priors with zero contract change.
**M7 never predicts price.**

**Files:** `lib/mtf/probability/{probabilityTypes, config, priors, transitions, directional, outcomes,
opportunity, explanation, probabilityEngine}.ts`.

**Public contract:**
- `computeProbability(lifecycle: TrendLifecycleResult, hierarchy: HierarchyResult): ProbabilityResult`.
- Three normalized layers (0–1, Σ=1 each): `stageTransitions` (advance/stay/regress/break with target
  stages), `directional` (bullish/bearish/sideways), `marketOutcomes` (continuation/pullback/range/
  reversal/false_breakout/expansion — the trader-facing layer).
- `dominantTransition` / `dominantDirection` / `mostLikelyOutcome`; `opportunity { score, grade }`;
  `contributors` (multiplicative audit trail); `calibration/modelVersion/sampleSize/confidenceInterval`
  (calibration metadata, the latter two reserved for empirical mode).

**Invariants:**
- **Consumes M6 + M5 outputs only** (`TrendLifecycleResult` + `HierarchyResult`) — no candles, never
  recomputes lower layers.
- **Multiplicative audit identity per layer:** `final = prior × Π(named factors) / Z`; contributors record
  every factor ≠ 1; tests reconstruct all three distributions from the contributors.
- **`opportunity` is distribution ACTIONABILITY, not trade quality** — `expectedRR`/execution-quality are
  deliberately excluded (they require price levels M7 cannot see; M9 owns them).
- `confidenceInterval` MUST remain undefined while `calibration === 'prior'`.
- Layer 3 buckets transition mass by **target stage** (breakout→expansion; confirmation/
  trend_establishment/continuation→continuation; healthy_pullback→pullback; exhaustion/distribution/
  reversal→reversal; range/accumulation→range), with a **false-breakout override** for regress/break out
  of breakout/confirmation stages, then three directional modulations.

**M8-facing durable surface:** the entire `ProbabilityResult`. (Clarification, resolved in M8: this
constraint governs the **M7 edge** — from M7, M8 consumes only `ProbabilityResult` and never reaches
into M7 internals. M8 additionally consumes the other four frozen result objects, per its Rule 1.)

**Depends on:** M0–M6 (via `TrendLifecycleResult` + `HierarchyResult`).

---

## M8 — Market Intelligence Engine

**Responsibility:** the **Institutional Intelligence Synthesizer** ("CEO dashboard") — NOT another
analysis engine. Collects the frozen v1.0 outputs and produces the single complete picture that UI,
alerts, AI narration, reports, and M9 consume. Single source of truth.

**Files:** `lib/mtf/market/{marketTypes, config, quality, opportunity, risk, readiness, evidence,
narrative, unifiedSignals, marketEngine}.ts`.

**Public contract:**
- `computeMarketIntelligence(agreement, confidence, hierarchy, lifecycle, probability): MarketIntelligenceResult`.
- `computeFullMarketIntelligence(candlesByTf): { result, layers }` — **the single public entry point**:
  runs the entire frozen v1.0 stack (closed-bar) and returns both the synthesis and the layer objects.
- `MarketIntelligenceResult { schemaVersion: 1, headline, quality{score,level,reasons},
  opportunity{score,grade A+…F}, risk{score,level,reasons}, readiness{state,reason}, evidence
  {supporting,opposing}, outlook, narrative, signals, warnings, diagnostics }`.

**Invariants:**
- **Never recalculates anything** — consumes exactly the five frozen result objects (`AgreementResult`,
  `ConfidenceResult`, `HierarchyResult`, `TrendLifecycleResult`, `ProbabilityResult`).
- **No timestamps, no execution-time fields** — strict determinism (same inputs ⇒ identical output).
- **No composite conviction score** — quality/opportunity/risk/readiness are the decomposed,
  explainable alternative; every value derives from named v1.0 fields via documented config formulas.
- **Readiness is an ENVIRONMENT GATE** — no direction, entry, size, or RR (M9 owns those; M9 consumes
  readiness as an input).
- Evidence/reasons are source-tagged (`LayerTag M3–M8`); narrative is deterministic templates
  (banned-vocabulary tested; probability phrased as "currently favors"); the unified feed merges
  M3–M7 (+M8) signals — M2 category signals are not in the input set (documented; they surface
  transitively via M3 contributors).
- M7's honesty flag (`calibration`) is propagated in headline + diagnostics — never hidden.

**M9-facing durable surface:** the entire `MarketIntelligenceResult` + `computeFullMarketIntelligence`.

**Depends on:** Intelligence Platform v1.0 (M0–M7), consumed via the five frozen contracts.

---

## M9 — Trade Decision Engine

**Responsibility:** the first **actionable** layer — M0–M8 describe; M9 gates, translates, and
**prices** M8's conclusion into a conditional setup proposal. NOT execution (no orders, no account,
no equity) and never a prediction: the stop IS the invalidation.

**Files:** `lib/mtf/decision/{decisionTypes, config, gate, swings, levels, smcConfluence, riskTier,
explanation, decisionEngine}.ts` (+ test-only `testFixtures.ts`).

**Public contract:**
- `computeTradeDecision(intel: FullMarketIntelligence, candlesByTf, smc?): TradeDecisionResult`.
- `computeFullTradeDecision(candlesByTf, smc?): { decision, intel }` — convenience: whole stack.
- `TradeDecisionResult { schemaVersion: 1, action long|short|no_trade, gate{passed,blockedBy,reason},
  direction (echoed M8 bias), executionTf, setup{entry{zone,type,basis}, stop(+distancePct),
  targets[](+rr), rr, atr} | null, riskTier full|half|quarter|none, confluence[], calibration,
  explanation, signals, warnings, diagnostics }`.

**Gate — first-match no-trade ladder:** (1) M8 readiness ≠ ready → `environment_<state>` with M8's
reason verbatim; (2) neutral bias → `no_directional_edge`; (3) extreme risk; (4) lifecycle
invalidated; (5) `insufficient_data` (< 20 closed bars); (6) `insufficient_structure` (missing the
side-specific anchoring swing, or close already at/beyond the stop); (7) `rr_too_low` (< 1.5 —
fires when a structural obstacle sits too close, or after SMC refinement lowers RR; `rawRR` recorded).

**Levels core:** ATR = last RMA(TR) via `lib/pineMath`; fractal swings (strict, k=2, confirmed only);
entry zone anchored at the swing (width 0.25·ATR), stop beyond it by 1.0·ATR, structural obstacle
(opposing swing) is ALWAYS target 1 when it exists and gates RR — never papered over by the measured
2R target; without an obstacle the measured move leads. All multiples in `DECISION_CONFIG`.

**SMC confluence (optional, bounded, additive):** entry snap to order block/FVG within 0.5·ATR,
stop extension past a resting pool within 0.75·ATR (+ `STOP_HUNT_RISK` warning), target upgrade to
an opposing pool only if RR stays ≥ 1.5. Every adjustment emits a `ConfluenceNote{before,after}`;
RR is re-gated after refinement; omitting `smc` reproduces the core byte-for-byte.

**Risk tier:** account-agnostic first-match ladder (excellent∧≤low → full; ≥good∧≤medium → half;
else quarter; gate failed → none) with the **honesty cap**: while `calibration === 'prior'`, `full`
is reduced to `half` (`TIER_CAPPED_PRIOR` signal) — model priors never justify full risk.

**Invariants:** `setup === null ⟺ action === 'no_trade' ⟺ riskTier === 'none'`;
`gate.passed ⟺ action ≠ no_trade`; direction never recomputed (echoed M8 headline bias); closed-bar
only; deterministic; banned predictive vocabulary in all text; `calibration` propagated, never hidden.

**Depends on:** M8 only (`FullMarketIntelligence`), candles for pricing (M9 owns price levels —
M7/M8 explicitly excluded them), and structurally `SmcSnapshot['objects']` when offered.

---

## Cross-cutting rules

**Dependency rule (one direction, never up or sideways):**
`Candles → M0 → M1 → M2 → M3`. A layer imports only from lower layers. M2 never imports M3; categories
never import each other; M3 never imports a concrete indicator/category module — it consumes `Voter`.

**Determinism & replay:** pure functions, no global state, closed-bar only, no extra passes over candle
history where avoidable. Same inputs ⇒ identical outputs (except `metadata.createdAt` /
`computationTimeMs` where present).

**Explainability:** every computed value at every layer is reconstructible from that layer's own output
(diagnostics + contributors/source + signals). This is what makes M5 AI narration possible without
reverse-engineering the engines.

**Isolation:** the whole pipeline lives under `lib/mtf/**` and has no UI/consumers wired in yet (M2/M3
are invisible). Downstream apps (dashboard, Stack Score, Custom MTF, scanner, alerts, replay, trade
setup) remain byte-identical until a milestone explicitly wires a consumer.

## Versioning

- **`schemaVersion: 1`** on `CategoryEngineResult` and `AgreementResult` is the *data-schema* version
  (git owns code history).
- **v1 permits additive changes only** — new optional fields, new signal/warning codes, new enum
  members. Consumers must tolerate unknown additive fields.
- Removing/retyping an existing field, or changing the meaning of an existing number, **requires
  `schemaVersion++`**, a migration note in the owning spec, and an update here.
- M0/M1 have no `schemaVersion`; their frozen-score parity tests are the equivalent guarantee — changing
  a frozen score is a breaking change requiring explicit sign-off.

## Specs (authoritative detail)

- M1 contract + EMA: `docs/superpowers/specs/2026-07-18-m1-indicator-intelligence-contract-ema-engine-design.md`
- M1.x six indicators: `docs/superpowers/specs/2026-07-18-m1x-six-indicator-intelligence-design.md`
- M2 categories: `docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md`
- M3 agreement: `docs/superpowers/specs/2026-07-19-m3-market-agreement-engine-design.md`
- M4 confidence: `docs/superpowers/specs/2026-07-19-m4-market-confidence-engine-design.md`
- M5 timeframe hierarchy + regime: `docs/superpowers/specs/2026-07-19-m5-timeframe-hierarchy-market-regime-design.md`
- M6 trend lifecycle: `docs/superpowers/specs/2026-07-19-m6-trend-lifecycle-design.md`
- M7 probability engine: `docs/superpowers/specs/2026-07-19-m7-probability-engine-design.md`
- M8 market intelligence: `docs/superpowers/specs/2026-07-20-m8-market-intelligence-engine-design.md`
- M9 trade decision: `docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md`
- Architecture graph (navigation): `graphify-out/`
