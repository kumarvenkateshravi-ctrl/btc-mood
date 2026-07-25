# MTF Engine Architecture

The Multi-Timeframe (MTF) Engine is the central intelligence service of
MyCryptoStack. Every feature — dashboard, alerts, scanner, replay, reports,
Stack Score, widgets, future AI — asks one question: *"What does the MTF Engine
think about the market right now?"* No feature computes its own version of the
truth.

This document defines the layered architecture and the contract for **M0: the
Indicator Registry**, which is implemented. Later milestones build on it
without changing its contract.

## Layers

```
Raw indicators (lib/indicators/*, golden-tested)
        ↓
M0  Indicator Registry        lib/mtf/registry.ts      — fixed roster, weighted scoring
        ↓
     Alignment Engine          lib/alignment.ts         — per-timeframe matrix (unchanged API)
        ↓
M1+ Category Engines           trend / momentum / volume / strength
        ↓
M2+ Market Context Engine      MarketContext: bias, confidence, conflict, explanations
        ↓
M3+ Decision Engine            zones + context → explainable signals, quality grades
```

Design principles (locked in from day one):

- **Pure and deterministic.** No UI, React, chart, or network code below the
  visualization layer. Same candles in → same result out. Closed-bar only —
  a produced signal never repaints.
- **Fixed roster.** The engine always evaluates the same indicators; hiding an
  indicator on the chart never changes signal quality.
- **One source of truth.** Indicator math lives in `lib/indicators/` and
  `lib/pineMath.ts`; scoring lives in the registry. Nothing is recalculated
  elsewhere.
- **Configuration-driven.** Weights, thresholds, and decision rules are typed
  configuration, never hardcoded, so backtesting can tune them without engine
  changes.
- **Explainable.** Every score can be traced to per-indicator results; no
  black boxes.

## M0: Indicator Registry

### Responsibility

Hold the indicator roster in stable dashboard row order, evaluate it against
one timeframe's closed candles, and compose a weighted 0–100 score. Nothing
else: no timeframes, no aggregation, no decisions.

### What it consumes

`Candle[]` for a single timeframe (closed bars), plus optional
`IndicatorWeights` overrides.

### What it produces

`IndicatorResult[]` — one per registered indicator — and a composite score.

### Data contracts (`lib/mtf/types.ts`)

```ts
type Verdict = 'bullish' | 'bearish' | 'neutral';
type IndicatorCategory = 'trend' | 'momentum' | 'volume' | 'strength';

interface IndicatorDefinition {
  id: string;                       // 'ema' | 'supertrend' | ...
  label: string;                    // 'EMA Alignment'
  sub: string;                      // settings summary, e.g. '12,26,9'
  kind: 'label' | 'value';          // how the dashboard renders the cell
  category: IndicatorCategory;      // which category engine it feeds (M1)
  defaultWeight: number;            // relative, normalized across the roster
  evaluate(candles: Candle[]): { score: number; display: string };
}

interface IndicatorResult {
  id: string;
  score: number;                    // 0–100 (100 max bull, 0 max bear, 50 neutral)
  verdict: Verdict;                 // derived: >55 bull, <45 bear, else neutral
  display: string;
  weight: number;                   // effective weight used
}

type IndicatorWeights = Record<string, number>; // partial overrides
```

### Public API (`lib/mtf/registry.ts`)

```ts
class IndicatorRegistry {
  register(def: IndicatorDefinition): void;     // throws on duplicate id / bad weight
  has(id: string): boolean;
  get(id: string): IndicatorDefinition | undefined;
  list(): IndicatorDefinition[];                // stable registration order
  evaluate(candles, weights?): IndicatorResult[];
  compositeScore(results, weights?): number;    // weighted, rounded 0–100
}

createDefaultRegistry(): IndicatorRegistry;     // fresh instance, fixed 7-indicator roster
```

### How indicators register themselves

The default roster (`lib/mtf/definitions.ts`) is fixed: EMA Alignment,
Supertrend, RSI, MACD, ADX, OBV, Volume — each a pure `IndicatorDefinition`
with a category and default weight. Future indicators (VWAP, funding rate,
open interest, …) are added by appending a definition or calling
`register()` on a composed instance; no engine redesign. There is no global
mutable singleton: each consumer creates its own registry via
`createDefaultRegistry()`, so runtime registration in one feature can never
leak into another (the alignment matrix keeps its own private instance).

### How settings are stored and versioned

Indicator parameters (RSI 14, MACD 12/26/9, …) are baked into the definition's
`sub` string and `evaluate` body, matching the golden-tested indicator
implementations. Weights are runtime configuration (`IndicatorWeights`),
defaulting to equal — which makes the composite exactly the legacy rounded
mean, so M0 changes no observable behavior. Persisted weight profiles and
versioned settings arrive with the Context Engine milestone.

### Aggregation and consumers today

`lib/alignment.ts` keeps its public API unchanged (`computeTfCells`,
`computeAlignmentMatrix`, `AlignmentMatrix`) and now delegates scoring to the
registry. Its 12 existing consumers — multi-timeframe page, alerts,
Stack Score, trade setup, scanner/reports via `multiTimeframe.ts` — are
untouched and continue to consume `AlignmentMatrix`. A 13th consumer joined
2026-07-25: the MTF Board (`lib/mtf/board/`), which formalizes this same
independent pipeline into `BoardDecision`, the M0-M9 stack's sole direction
authority (Arch v2) — see `docs/architecture/market-intelligence-pipeline.md`.

### How the rest of the app will consume intelligence (M1+)

- **Category engines** group registry results by `category` into trend /
  momentum / volume / strength scores with their own configurable weights.
- **Market Context Engine** aggregates timeframes (configurable
  `TimeframeWeights`, weighted higher-TF agreement — no binary vetoes) into a
  `MarketContext` with `overallBias`, `contextScore`, `confidence`,
  `conflictScore`, `riskLevel`, and structured confirmations/warnings —
  including *why-not* explanations for rejected signals.
- **Alerts, Scanner, Replay, Reports, Widgets** subscribe to `MarketContext`
  instead of raw indicator values; replay determinism holds because the whole
  stack is pure over closed bars.

## M0 acceptance criteria

Verified by `lib/mtf/registry.test.ts` (16 tests) plus the pre-existing suite:

1. Registry modules are pure TypeScript — no UI/React/chart imports.
2. The default roster registers exactly `ema, supertrend, rsi, macd, adx, obv, volume`.
3. `list()` order is stable and matches dashboard row order.
4. Registering a duplicate id throws.
5. Registering a non-positive or non-finite weight throws.
6. Every definition declares an `IndicatorCategory`.
7. `evaluate()` returns one result per indicator with `score ∈ [0,100]` and `verdict = verdictOf(score)`.
8. Short series evaluate without throwing, scores stay in range.
9. Empty candles produce all-neutral (50) results.
10. Registry scores/verdicts/displays match legacy `computeTfCells` exactly (behavior parity).
11. `compositeScore` under default weights equals the legacy rounded mean.
12. Weights are normalized — uniform scaling doesn't change the composite.
13. Custom weights shift the composite as expected; overrides for unknown ids or invalid values throw.
14. Evaluation is deterministic (same input ⇒ identical output) and instances are independent.
15. The entire pre-existing test suite passes unchanged (824/824), and `alignment.ts` exports are unmodified.
