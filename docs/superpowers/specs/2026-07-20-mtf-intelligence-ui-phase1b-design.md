# MTF Intelligence UI — Phase 1b (wire M6–M8 into the Custom MTF page)

**Date:** 2026-07-20 · **Status:** Approved & frozen (user-directed validation checkpoint before M9)
**Builds on:** Phase 1 (`2026-07-19-mtf-intelligence-ui-phase1-design.md`), M8 (`computeFullMarketIntelligence`)

**Purpose:** validate that the complete M0–M8 stack produces the right conclusions on **live BTC data**
before building the Trade Decision Engine (M9). The M6 lifecycle, M7 probabilities, and M8 synthesis have
never been rendered — this makes them visible on the sanctioned experimentation surface.

## Scope (frozen)

- **Custom MTF page only.** No widgets (Phase 2), no alerts (Phase 3), no new routes. Read-only.
- **Engines untouched** — platform v1.0 + M8 are frozen; this is data-source rewiring + presentation.

## Architectural change: one source of truth

`useMarketIntelligence` v2 stops calling the Phase-1 aggregator and instead calls
**`computeFullMarketIntelligence(closedCandlesByTf)`** once (memoized on the closed-bar signature — never
on ticks), plus the existing per-**selected**-TF bundle (M1–M4 + categories for the TF the user clicks,
since M8's entry point computes agreement/confidence on the *controller* TF):

```
useMarketIntelligence(candlesByTf, selectedTf) → {
  full: FullMarketIntelligence,            // result + layers (hierarchy/lifecycle/probability/…)
  selected: { agreement, confidence, categories } | null,   // selected-TF detail (as Phase 1)
  tradeContext,                            // deriveTradeContext(full.layers.hierarchy, selected conf)
}
```
- Existing sections rewire: `MTFIntelligenceBoard` ← `full.layers.hierarchy`; Agreement/Confidence +
  CategoryStrip ← `selected`; `TradeContextCard` ← unchanged (kept for now — consolidation into the M8
  verdict is a deferred cleanup, noted below).
- `computeMarketIntelligenceBoard` in `lib/mtf/marketIntelligence.ts` becomes unused by the page (kept +
  tested; header comment marks it superseded by M8's entry point). `deriveTradeContext` stays in use.

## New sections (4 renderers in `components/mtf/MarketIntelligence.tsx`, all dumb/props-only)

1. **`MarketIntelligenceVerdict` (M8)** — the CEO card and headline validation artifact:
   headline row (bias · state · stage · regime · controller), the four verdicts —
   Quality (level + score + top reasons), Opportunity (grade + score), Risk (level + score + top reasons),
   **Readiness (state + reason, styled as the primary verdict)** — plus a `calibration` badge
   ("model priors") that is never hidden.
2. **`TrendLifecyclePanel` (M6)** — stage + direction, progression trajectory
   (previous → current, advancing/stalling/regressing), expected next stage + `nextStageConfidence`,
   invalidation status, and three mini-bars: lifecycle strength · freshness · exhaustion.
3. **`ProbabilityPanel` (M7)** — `marketOutcomes` distribution as horizontal bars (trader layer),
   directional distribution row, dominant outcome highlighted, and the `PROB_MODEL_PRIORS` note visible.
4. **`NarrativeEvidencePanel` (M8)** — the 6-sentence executive summary, supporting/opposing evidence
   lists (source-tagged M3–M8), and the top unified warnings.

Placement (left analysis column): Verdict directly under the matrix (above the M5 board), then the
existing Phase-1 sections, then Lifecycle + Probability side-by-side, then Narrative/Evidence.

## Validation checklist (live, Playwright)

- All new sections render real BTCUSDT data; 0 console errors; full-page screenshot captured.
- **Coherence checks (the point of this phase):** controller identical across board/verdict/lifecycle;
  readiness consistent with risk+quality per the frozen ladder; lifecycle stage consistent with the M5
  `overallMarketState`; probability Σ≈1 in the UI; calibration badge present.

## Tasks (releasable-per-task invariant, as always)

1. **Hook v2 + rewiring** — `useMarketIntelligence` switches to `computeFullMarketIntelligence` +
   selected-TF bundle; existing sections re-fed; suite + tsc green (page compiles, no visual additions yet).
2. **Four renderers + render tests** — props-only components with static-markup tests (Phase-1 pattern).
3. **Mount + live validation** — wire the sections into the page, run the dev server, Playwright-verify
   the checklist against live BTC, screenshot, stop server; update memory + mark Phase 1b in docs.

## Deferred (explicitly out of scope)

Phase 2 widget, Phase 3 alerts, consolidating `TradeContextCard` into the M8 verdict, and pointing any
other page at M8. After live validation passes → **M9 Trade Decision Engine**.
