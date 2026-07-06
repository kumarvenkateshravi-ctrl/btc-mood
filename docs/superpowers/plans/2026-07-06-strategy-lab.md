# MyCryptoStack Strategy Lab (Chartink-inspired) — FINAL Plan (rev. 2)

> Status: APPROVED direction (sprintchartInk.md review) — all 6 refinements applied.
> Scoped for the July deadline + token budget.

**Goal:** a Strategy Development Platform — build → validate → backtest → live signals →
tracked trades → analytics — purpose-built for single-symbol, multi-TF Bitcoin trading.
Better than Chartink: unlimited nested logic, per-condition timeframes, immutable
non-repaint signals with TP1/2/3 lifecycle + MFE/MAE, chart-native rendering,
**explainable signals**, versioned strategy engineering, and **backtesting for free**
(deterministic closed-bar evaluation over history IS the backtest).

## Reuse map (why 7 sprints, not 15)

| Doc phase | Already built | Gap |
|---|---|---|
| Indicator registry | `CUSTOM_INDICATORS` (20+, typed inputs/plots) | registry defs + series adapters |
| Multi-TF engine | `candlesByTf`, closed-bar discipline | per-TF series cache |
| Rule evaluation | closed-bar cache pattern (proven ×3) | expression-tree evaluator |
| Signal engine | immutability conventions, ATR SL/TP math | strategy→signal adapter |
| Trade engine | `walkVdTrades` (lifecycle, BE/trailing, MFE/MAE) | generalize input type |
| Chart overlay | arrows/levels/R:R boxes/price tags/outcome chips | one registered indicator |
| Analytics | `vdStats` | per-strategy/per-version slice |
| Explainability | DESIGN.md §E grammar + SignalExplanation patterns | per-condition snapshots |
| Persistence | localStorage patterns (paperStore) | strategy + signal stores |

**Deferred post-launch:** Telegram/Discord/email/webhook alerts (browser toast ships
in v1), Community Marketplace (needs auth/backend → Supabase/Stripe plan), AI Strategy
Assistant. The JSON is **marketplace-ready from day one** (refinement 6).

---

## Architecture (`lib/strategy/` pure engine · `components/strategy/` UI)

### Registry, not switch statements (refinement 4 — the load-bearing principle)

```ts
interface StrategySource {
  id: string; name: string; group: 'standard' | 'structure' | 'intelligence';
  params: IndicatorInputDef[];                  // reused input schema
  outputs: Array<{ id: string; label: string }>;
  operators: Operator[];                        // which ops make sense for it
  tfs: Timeframe[];
  series: (candles: Candle[], params, output) => (number | null)[]; // the evaluator
}
```
Adding indicator #80 = one registration. Zero UI / parser / evaluator changes — the
builder's dropdowns, the validator, and the evaluator are all registry-driven.

### v1 source roster (refinement 1 — intelligence scores are first-class)

- **Standard:** price (close/high/low), EMA, SMA, RSI, MACD (macd/signal/hist), VWAP,
  Supertrend, ATR, ADX (+DI/−DI), Bollinger, Stochastic, Volume, Volume SMA20, OBV
  (CMF if present in lib — verified at S1, else Phase 2).
- **Structure:** Supply/Demand zone proximity (distance to nearest healthy VD zone in
  ATRs, inside-zone flag), VD zone confidence, market structure (HH/HL `structureScore`).
- **Intelligence (the USP):** Context Score, Trend Score, Momentum Score, Volume Score,
  HTF Alignment, Context Confidence, Conflict — per TF from the Market Context Engine;
  **Stack Score / Alignment Score** wrapped from the existing dashboard engines
  (existence verified at S1; if an engine isn't series-ready it ships as last-value).
- Enables exactly the doc's example: `Stack Score > 85 AND Trend Score > 80 AND
  Momentum > 75 AND EMA20 crossAbove EMA50 → BUY`.

### Strategy JSON (versioned + marketplace-ready, refinements 5 + 6)

```ts
interface Strategy {
  id: string; name: string; direction: 'long' | 'short';
  schemaVersion: 1;
  versions: Array<{
    v: number; createdAt: number; note: string;        // WHY the version exists
    tree: GroupNode;
    performance?: VersionStats;                         // frozen snapshot on supersede
  }>;
  activeVersion: number; enabled: boolean;
  exits: { slAtr: number; tp1R: number; tp2R: number; tp3R: number };
  // Marketplace-compatible now, unused until the community phase:
  ownerId: string | null; visibility: 'private' | 'public' | 'invite';
  createdAt: number; updatedAt: number;
  parentStrategy: string | null; forkCount: number; likes: number;
}
type GroupNode = { logic: 'AND' | 'OR'; children: Array<GroupNode | Condition> };
interface Condition {
  left: SeriesRef;                       // { source, output, params }
  op: Operator;                          // >, <, >=, <=, between, crossAbove/Below, increasing/decreasing
  right: SeriesRef | number | [number, number];
  tf: Timeframe;                         // per-condition TF
}
```
Editing a strategy ALWAYS creates a new immutable version (with note + frozen
performance of the old one) — compare and roll back per version.

### Validation Engine (refinement 3 — new sprint)

`validateStrategy(strategy, registry) → { ok, errors: ValidationError[] }`, run before
every save AND before evaluation (defense in depth):
- unknown source/output/operator · operator↔operand type mismatch (e.g. `crossAbove`
  against a constant where the source disallows it) · out-of-range params/constants
  (RSI > 300) · unsupported TF for the source · empty groups · nesting depth cap (16)
  · self/circular series references · malformed between-ranges.
UI blocks save with inline per-condition errors; invalid strategies are unrepresentable
in the store.

### Explainability (refinement 7 — "Why?")

Every generated signal stores a per-condition evaluation snapshot:
`{ label: 'RSI(14) 15m', value: 64, threshold: '> 60', pass: true }[]` + confidence
(= weighted share of passing conditions incl. group logic). Signal rows and the chart
trade's detail expose "Why?" → the checklist exactly as the doc mocks. This is also the
future AI assistant's training-free input.

### Evaluation / signals / trades / chart (unchanged from rev. 1)

Per closed chart-TF bar; conditions read their OWN TF's last-closed values
(non-repaint, prefix-invariance golden test). Tree TRUE → immutable `StrategySignal`
(entry = close, SL/TPs from exits config) → generalized `walkTrades` lifecycle →
`strategy_signals` registered indicator renders arrows/levels/R:R boxes/outcome chips
(chart-host-only publishing — the flicker lesson). Stats via the `vdStats` pattern,
sliced per strategy AND per version.

---

## Sprints (TDD; commit each; user verifies visually — no Playwright)

| # | Sprint | Contents |
|---|---|---|
| S1 | Registry + operators + series cache | source defs (all 3 groups incl. intelligence scores), operator engine, closed-bar per-(source,params,tf) cache. Existence-check Stack/Alignment engines and wire or fall back. |
| S2 | Schema + expression evaluator | types, unlimited nesting, per-condition TF, per-bar booleans, prefix-invariance determinism test. |
| S3 | **Validation Engine** | the full rule list above + tests per rule; wired ahead of save + evaluate. |
| S4 | Signals + trades + persistence | explainable immutable signals, `walkTrades` generalization (VD goldens prove no regression), versioned localStorage store (marketplace-ready fields), capped signal log. |
| S5 | Chart overlay | `strategy_signals` indicator: arrows, entry/SL/TP1-3, R:R boxes, outcome chips per enabled strategy. |
| S6 | Strategy Lab UI (right dock, refinement 2) | replaces the broken `StrategyBuilderPanel` stub (clears 1 of the 2 pre-existing tsc errors). List → builder (registry-driven selects, recursive group editor, inline validation), exits, save-as-version + note, enable toggle. Tabs: Conditions · History · Analytics · Versions. |
| S7 | Analytics + backtest report + alerts-lite + Why? | per-version stats + comparison table (v1.0 62% → v1.2 76%), TP1/2/3 hit distribution, streaks; browser-toast on new live signal; "Why?" checklist on signal/trade rows. |

Dedicated `/lab` workspace page: post-v1 evolution, as the review recommends.
