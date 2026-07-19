# MTF Intelligence UI — Phase 1 (Custom MTF page)

**Date:** 2026-07-19 · **Status:** Approved & frozen (scope confirmed by user)
**Purpose:** Make the invisible M2–M5 intelligence stack **user-facing and validated with live BTC data**
on the Custom MTF page — before building M6. Phase 1 only (no widgets, no alerts, no new route).

## Scope (frozen)

Four read-only sections on `/custom-multi-timeframe`, in the left analysis column:
1. **MTF Intelligence Board** (M5) — `overallMarketState` hero, `htfBias`, stack `alignment`/`conflict`,
   `controller` (+ transfer note), and a per-TF row: `bias · regime · confidence · authority · role`, with
   an aligned/diverging marker.
2. **Agreement & Confidence** (M3/M4) — for the selected TF: agreement %, confidence % + state,
   dominant bias, top signals/warnings.
3. **Category Strip** (M2) — the six categories (state + confidence) for the selected TF.
4. **Trade Context card** (bridge, read-only) — `overallMarketState`, controller, execution TF, current
   opportunity, recommended action, risk. **Deterministic presentation mapping, NOT a decision engine**
   (M9 owns decisions); labeled as read-only context.

Engines are **not** modified. This is presentation + a pure aggregator + a memoized hook.

## Architecture

```
candlesByTf ─(closed bars)→ computeMarketIntelligenceBoard()  [pure, lib]
                                   │
                    ┌──────────────┼───────────────┐
             buildTimeframeSnapshots        per selected TF:
             → computeTimeframeHierarchy     M2 categories, M3 agreement, M4 confidence
                                   │
                        useMarketIntelligence() [hook: memoizes on the closed-bar signature]
                                   │
      MTFIntelligenceBoard · AgreementConfidencePanel · CategoryStrip · TradeContextCard  [dumb renderers]
```

- **Pure aggregator** `lib/mtf/marketIntelligence.ts`:
  - `computeMarketIntelligenceBoard(candlesByTf, selectedTf): MarketIntelligenceBoard` — slices each TF to
    closed bars, `buildTimeframeSnapshots` → `computeTimeframeHierarchy`, and for `selectedTf` runs the
    registry → categories → agreement → confidence, returning `{ hierarchy, snapshots, selected }`.
  - `deriveTradeContext(hierarchy, selectedConfidence): TradeContext` — deterministic mapping (table below).
- **Hook** `components/mtf/useMarketIntelligence.ts`: one `useMemo` keyed on the per-TF **last-closed-bar
  times** + `selectedTf` (never recomputes on ticks — same pattern as `smcByTf`).
- **Components** `components/mtf/MarketIntelligence.tsx` (board + panels + card), reusing MDS primitives
  (`Panel`, `InfoTip`) and the `MarketStructureCard` grammar. Dumb: every value comes from props.

## Trade Context mapping (deterministic, read-only)

`overallMarketState → { opportunity, action }`:
- `bullish_continuation` → Trend Continuation · Favor Longs With Trend
- `bearish_continuation` → Trend Continuation · Favor Shorts With Trend
- `bullish_pullback` → Trend Pullback · Wait For Continuation
- `bearish_pullback` → Trend Pullback · Wait For Continuation
- `bullish_transition` / `bearish_transition` → Developing Bias · Wait For Confirmation
- `reversal_risk` → Possible Reversal · Reduce Exposure / Wait
- `range_bound` → Range · Fade Extremes / Stand Aside
- `compression` → Compression · Await Expansion
- `expansion` → Expansion / Volatility · Trade With Caution

`executionTf` = highest-authority `trigger`-role TF present, else the lowest-weight present TF.
`risk` = `confidence ≥ 70 && conflict < 30 → Low`; `confidence ≥ 45 → Medium`; else `High`;
`reversal_risk`/`expansion` states floor risk at `Medium`.

## Contract (types in `marketIntelligence.ts`)

```ts
interface MarketIntelligenceBoard {
  hierarchy: HierarchyResult;
  snapshots: TimeframeSnapshot[];
  selected: { timeframe: Timeframe; agreement: AgreementResult; confidence: ConfidenceResult; categories: CategoryResult[] };
}
interface TradeContext { overallMarketState: OverallMarketState; controller: Timeframe; executionTf: Timeframe; opportunity: string; action: string; risk: 'Low' | 'Medium' | 'High'; }
```

## Tasks (releasable-per-task: tsc clean + full suite green + atomic commit + graph)

1. **Aggregator + trade context** (`lib/mtf/marketIntelligence.ts` + test) — pure; unit-test the board shape on real candles, closed-bar slicing, and the full `deriveTradeContext` mapping/risk table.
2. **Components** (`components/mtf/MarketIntelligence.tsx` + a11y test) — four dumb renderers taking props; not wired yet. Reuse `Panel`/`InfoTip`.
3. **Hook + wire + live-verify** (`components/mtf/useMarketIntelligence.ts`; edit `app/custom-multi-timeframe/page.tsx`) — memoized hook, mount the four sections; **live Playwright verification** against real BTC (the validation checkpoint).

## Acceptance

Read-only; deterministic; no engine changes; closed-bar-cached (no per-tick recompute). Full suite green,
tsc clean. Live-verified on the Custom MTF page with real data. Only `lib/mtf/`, `components/mtf/`,
`app/custom-multi-timeframe/page.tsx`, and docs touched. Widgets/alerts deferred to Phase 2/3.
