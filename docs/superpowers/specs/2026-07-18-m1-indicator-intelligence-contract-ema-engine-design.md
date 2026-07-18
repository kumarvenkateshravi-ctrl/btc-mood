# M1 — Indicator Intelligence Contract + EMA Intelligence Engine

**Date:** 2026-07-18
**Status:** Approved (design)
**Milestone:** M1 (Explainability), part of the MTF Engine roadmap
**Builds on:** M0 Indicator Registry (`lib/mtf/`), `docs/architecture/mtf-engine.md`
**Sources:** `MTFMainM1.md`, `M1Enhance.md` (advisory reviews in Downloads)

> **Architectural Rule.** The intelligence values produced in M1 — *indicator*
> confidence, *indicator* strength, diagnostics, signals, and warnings — are
> **indicator-local evidence**, not market-level conclusions. Higher-level engines
> in later milestones (Category, Confidence, Market Context, Decision) are
> responsible for aggregating these into market-wide intelligence. Nothing in M1
> may present these as market conclusions.

## Objective

Establish a **future-proof intelligence contract** that every indicator can speak,
and upgrade the **EMA** indicator to be the first to speak it richly — **without
changing any observable behavior**. M1 is Explainability, not Trading Logic.

Delivered as **one feature, two phases, two commits, two acceptance gates:**
- **Phase 1 (M1.0)** — the Indicator Intelligence contract + registry wiring.
- **Phase 2 (M1.1)** — the EMA Intelligence engine (first real producer).

## Hard invariants (both phases)

- **Score frozen.** `score`, `display`, `verdict`, the per-indicator weight, and the
  composite alignment score stay **byte-identical** to current output for all seven
  indicators. Do not touch the EMA → alignment → composite score chain.
- **Public API unchanged.** `computeAlignmentMatrix()` and every consumer
  (dashboard, Custom MTF, Stack Score, alerts, trade setup) remain untouched.
- **Pure & deterministic.** No global state, no extra passes over candle history
  where avoidable, replay-safe.

## Files

**Allowed to change:** `lib/mtf/intelligence.ts` (new), `lib/mtf/types.ts`,
`lib/mtf/registry.ts`, `lib/mtf/registry.test.ts`, `lib/mtf/indicators/ema.ts` (new),
`lib/mtf/indicators/ema.test.ts` (new), `lib/mtf/definitions.ts`.

**Must NOT change:** anything under `app/`, `components/`, `lib/alignment.ts`, and
the other six indicator implementations (RSI, MACD, ADX, OBV, Volume, Supertrend).

---

## Phase 1 (M1.0) — Indicator Intelligence Contract

Purely architectural. No dashboard, scoring, intelligence, or UI changes.

### Types

**`lib/mtf/types.ts`** — add a shared signal primitive and widen the evaluation:

```ts
export interface IndicatorSignal {
  code: string;                                  // machine-readable, e.g. 'EMA_ALIGNMENT_STRONG'
  message: string;                               // human-readable
  severity: 'info' | 'warning' | 'strong';
  /** Optional epoch-ms timing (unused in M1; replay/AI/reports attach later). */
  timestamp?: number;
}

/** Marker base for per-indicator diagnostics — each indicator OWNS its concrete
 * shape (EmaDiagnostics, later RsiDiagnostics, …); the registry never inspects it. */
export interface IndicatorDiagnostics {}

export interface IndicatorEvaluation {
  score: number;
  display: string;
  // Optional richer intelligence — absent means "use placeholders" (M1.0 default).
  confidence?: number;
  strength?: number;
  diagnostics?: IndicatorDiagnostics;
  signals?: IndicatorSignal[];
  warnings?: IndicatorSignal[];
}
```

`IndicatorResult` moves out of `types.ts` (see below); `IndicatorDefinition` and the
`verdictOf` / `labelOf` helpers stay as-is.

**`lib/mtf/intelligence.ts`** (new) — the canonical intelligence object. Imports
`IndicatorCategory`, `Verdict`, `IndicatorSignal` from `types.ts` (one-directional):

```ts
export interface IndicatorIntelligence {
  id: string;
  category: IndicatorCategory;
  score: number;                 // frozen directional 0–100 (unchanged from today)
  verdict: Verdict;              // derived from score (unchanged)
  confidence: number;            // INDICATOR confidence 0–100 (see Architectural Rule)
  strength: number;              // INDICATOR strength 0–100, direction-independent
  display: string;
  diagnostics: IndicatorDiagnostics;
  signals: IndicatorSignal[];
  warnings: IndicatorSignal[];
}

/** What the registry returns per indicator: full intelligence + applied weight. */
export type IndicatorResult = IndicatorIntelligence & { weight: number };
```

> **Evolution note (locked direction, M2+):** over time each indicator module will
> construct its complete `IndicatorIntelligence` itself, and the registry will only
> register, orchestrate, and attach the effective `weight` (coordinator, not
> transformer). Not implemented in M1 — it would force every indicator to duplicate
> `id`/`category` metadata today — but new code must not make it harder.

### Registry

**`lib/mtf/registry.ts`** — `evaluate()` becomes the single place that assembles the
intelligence object. For each definition it calls `def.evaluate()` → `ev`, then builds:

```ts
{
  id: d.id,
  category: d.category,
  score: ev.score,
  display: ev.display,
  verdict: verdictOf(ev.score),
  confidence: ev.confidence ?? ev.score,     // placeholder when indicator is silent
  strength:   ev.strength   ?? ev.score,
  diagnostics: ev.diagnostics ?? {},
  signals:     ev.signals     ?? [],
  warnings:    ev.warnings    ?? [],
  weight: resolved.get(d.id)!,
}
```

Import `IndicatorResult` from `./intelligence`. `compositeScore()` unchanged — it only
reads `score` and `weight`.

### Tests (`registry.test.ts`)

- Every result has `confidence`, `strength`, `diagnostics`, `signals`, `warnings`.
- For all seven indicators, `score` / `display` / `verdict` are **identical** to a
  snapshot of current values (guard against regressions); composite unchanged.
- With no indicator producing rich fields yet: `confidence === score`,
  `strength === score`, `diagnostics === {}`, `signals === []`, `warnings === []`.

### Phase 1 acceptance

✓ No observable behavior change ✓ Alignment identical ✓ Public API unchanged
✓ Registry internally produces `IndicatorIntelligence` ✓ existing + new tests pass.

---

## Phase 2 (M1.1) — EMA Intelligence Engine

Upgrade **only** EMA. Create the `lib/mtf/indicators/` folder now (every later M1.x
milestone adds its own module there). `definitions.ts` becomes a lightweight registry
whose EMA entry **delegates** evaluation to `lib/mtf/indicators/ema.ts`; the other six
stay inline until their own milestone.

### `lib/mtf/indicators/ema.ts` (new, pure)

Exports `evaluateEma(candles): IndicatorEvaluation`. **`score` uses the current bucket
logic verbatim (frozen):** `e20>e50>=long → 100`, `e20<e50<=long → 0`, else
`e20>e50 ? 65 : 35`, insufficient → 50 (`long = e200 ?? e50`). `display = labelDisplay(score)`.

The five dimensions populate the intelligence fields only. **All constants live at the
top of the module and are tunable** (conservative defaults; refine later against real
BTC data — do not over-fit now).

**Diagnostics — five deterministic dimensions (0–100):**

| Dim | Formula | Kind |
|-----|---------|------|
| `alignment` | `a=(e20>e50), b=(e50>e200)`: both→100, neither→0, (1,0)→65, (0,1)→35; insufficient→50 | directional |
| `separation` | `sepPct = (|e20−e50| + |e50−e200|) / e200 · 100`; `clamp(sepPct / SEP_SAT · 100, 0, 100)`, `SEP_SAT = 6` | magnitude |
| `slope` | mean %-change of the three EMAs over `SLOPE_LOOKBACK = 10` bars; `clamp(50 + mean · SLOPE_GAIN, 0, 100)`, `SLOPE_GAIN = 8` | directional |
| `pricePosition` | (count of EMAs price is above ÷ 3) · 100 → 0 / 33 / 67 / 100 | directional |
| `freshness` | `barsSinceCross(e20,e50)`: **no cross → 50 (neutral)**; else `clamp(100 − bars · FRESH_DECAY, 20, 100)`, `FRESH_DECAY = 4` | magnitude |

`barsSinceCross` scans the already-computed `emaPine` arrays (one pass over them — no
extra pass over candles).

**Confidence & strength are built FROM the diagnostics object** (per M1Enhance — one
source of truth, so the future M3 Confidence Engine composes indicator confidences
rather than competing with a hardcoded one). Directional dims contribute their
*conviction magnitude* `conv(x) = |x − 50| · 2`; magnitude dims contribute raw:

```ts
export const EMA_CONFIDENCE_WEIGHTS = { alignment: 0.40, slope: 0.20, separation: 0.20, pricePosition: 0.10, freshness: 0.10 };
export const EMA_STRENGTH_WEIGHTS   = { alignment: 0.50, separation: 0.25, slope: 0.25 };

// Indicator Confidence (0–100) — conviction, NOT market confidence:
buildConfidence(d) = W.alignment·conv(d.alignment) + W.slope·conv(d.slope)
                   + W.separation·d.separation + W.pricePosition·conv(d.pricePosition)
                   + W.freshness·d.freshness

// Indicator Strength (0–100) — trend quality, direction-independent:
buildStrength(d)   = S.alignment·conv(d.alignment) + S.separation·d.separation + S.slope·conv(d.slope)
```

Both take the `EmaDiagnostics` object as their only input. Result rounded, clamped 0–100.

**Signals / warnings** are `IndicatorSignal[]`, threshold-derived from the diagnostics:

- Signals (positive): `alignment===100 → EMA_ALIGNMENT_STRONG / "Strong EMA Alignment" / strong`;
  `pricePosition===100 → EMA_PRICE_ABOVE_ALL / "Price Above All EMAs" / strong`;
  `pricePosition===0 → EMA_PRICE_BELOW_ALL / "Price Below All EMAs" / strong`;
  `freshness>=70 → EMA_FRESH_CROSS / "Fresh EMA Cross" / info`;
  `separation>=70 → EMA_WIDE_SEPARATION / "Wide EMA Separation" / info`;
  `slope>=70 → EMA_RISING / "Rising EMAs" / info`; `slope<=30 → EMA_FALLING / "Falling EMAs" / info`.
- Warnings: `separation<=30 → EMA_COMPRESSION / "Weak Separation" / warning`;
  `freshness<=25 → EMA_AGING / "Aging Trend" / warning`;
  `slope>=40 && slope<=60 → EMA_FLAT_SLOPE / "Flat EMA Slope" / warning`;
  `alignment===35 || alignment===65 → EMA_MIXED_ALIGNMENT / "Mixed Alignment" / warning`.

`diagnostics = { alignment, separation, slope, pricePosition, freshness }`, typed as
`interface EmaDiagnostics extends IndicatorDiagnostics` — EMA owns its shape; the
registry and future engines receive it through the marker base.

Every exported constant carries a JSDoc of the form *"Conservative default; tuned
later against real BTC data; API stable."*

### `lib/mtf/definitions.ts`

EMA entry keeps its metadata (`id/label/sub/kind/category/defaultWeight`) but its
`evaluate` delegates: `evaluate: (candles) => evaluateEma(candles)`. Remove the inline
EMA math (now in `ema.ts`). The other six definitions are untouched.

### Tests

**`lib/mtf/indicators/ema.test.ts`** — eight scenarios with hand-built candle series:
Perfect Bull, Strong Bear, Mixed Alignment, Fresh Cross, Old Cross, Flat Market,
Insufficient Data, Sideways. Assert per scenario: `score` matches the frozen bucket;
each diagnostics dimension is in its expected band; `confidence`/`strength` in range and
directionally sensible; signals/warnings contain the expected `code`s; no-cross series →
`freshness === 50`.

**`registry.test.ts`** — the EMA result now has populated `confidence` / `strength` /
`diagnostics` / `signals` (structured) / `warnings`, while EMA `score` / `display` /
`verdict` remain frozen.

### Phase 2 acceptance

✓ EMA returns full `IndicatorIntelligence` ✓ dashboard unchanged (score frozen)
✓ score 0–100 ✓ confidence/strength/diagnostics/signals/warnings populated
✓ all tests pass ✓ no public API changes ✓ only EMA modified
✓ **performance:** each EMA series (`emaPine` 20/50/200) computed exactly once per
evaluation and reused for score, separation, slope, price position, and freshness —
no redundant passes over candle history, no per-call state.

---

## Deliverables

- `intelligence.ts` (`IndicatorIntelligence`, `IndicatorResult`), `types.ts`
  (`IndicatorSignal` + widened `IndicatorEvaluation`), registry assembling intelligence.
- `lib/mtf/indicators/` folder with `ema.ts` (+ tests); `definitions.ts` delegating EMA.
- Updated tests; **no UI changes**; score chain frozen.
