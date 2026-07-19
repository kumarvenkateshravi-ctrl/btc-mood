# Market Intelligence Pipeline (M0–M6) — Engine Constitution

**Status:** Canonical reference. Frozen. Every future milestone (M7 Probability, M8 Market Intelligence,
M9 Trade Decision, M10 Trading Plan Generator, Alerts, AI narration, Scanner) references this document
rather than re-deriving how these layers interact. Changing a public contract below requires a version
bump (see §Versioning) and an edit here.

```
Candles → M0 Registry → M1 Indicator Intelligence → M2 Category Intelligence → M3 Agreement
                                                                                       │
                          M6 Trend Lifecycle ← M5 Timeframe Hierarchy + Regime ← M4 Confidence
                                    │
                       (M7 Probability → M8 Market Intelligence → M9 Trade Decision → M10 Trading Plan → …)
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
| **M7** | Probability Engine. | ← next |
| **M8** | Market Intelligence Engine (combine all outputs). | planned |
| **M9** | Trade Decision Engine. | planned |
| **M10** | Goal-Based Trading Plan Generator. | planned |

¹ **M2 divergence to reconcile:** the roadmap lists categories *Trend, Momentum, Volume,
Volatility, **Structure, Smart Money*** with *dynamic* per-category indicator discovery. As built
(per the frozen MTFM2 brief) M2 ships *Trend, Momentum, Volume, Volatility, **Quality, Participation***
with **fixed** contributor lists. Structure/Smart-Money categories and dynamic discovery are not yet
implemented — revisit before or during a milestone that needs them.

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
- Architecture graph (navigation): `graphify-out/`
