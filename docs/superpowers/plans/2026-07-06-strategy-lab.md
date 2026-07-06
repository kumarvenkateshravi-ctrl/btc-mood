# MyCryptoStack Strategy Lab (Chartink-inspired) — Implementation Plan

> Status: DRAFT — awaiting review. Source: ChartInkClone.md (15-sprint enterprise
> roadmap), scoped for the July deadline + token budget.

**Goal:** a Strategy Development Platform — build → validate → backtest → live signals →
tracked trades → analytics — for the app's single-symbol, multi-TF world. Better than
Chartink because: unlimited nested logic, per-condition timeframes, immutable non-repaint
signals with TP1/2/3 lifecycle + MFE/MAE, chart-native rendering, and **backtesting for
free** (the evaluator is deterministic over history — Chartink sells this separately).

## Why this is 6 sprints here, not 15

We already own most of the doc's architecture — the plan REUSES, not rebuilds:

| Doc phase | Already built | Gap to build |
|---|---|---|
| 1 Indicator registry | `CUSTOM_INDICATORS` (20+ indicators, typed inputs, plot outputs) | operator metadata + series adapter + cache |
| 5 Multi-TF engine | `candlesByTf` (6 TFs), closed-bar discipline | per-TF series cache keys |
| 6 Rule evaluation | closed-bar cache pattern (×3 proven) | expression-tree evaluator |
| 7 Signal engine | immutability conventions, ATR SL/TP math | strategy→signal adapter |
| 9 Trade engine | `walkVdTrades` (full lifecycle, BE/trailing, MFE/MAE) | generalize input type |
| 8 Chart overlay | arrows/levels/R:R boxes/price tags (VD work) | one registered indicator |
| 10 Analytics | `vdStats` (win rate/PF/expectancy/MFE/MAE/rollups) | per-strategy/version slice |
| 13 Backtest | deterministic closed-bar evaluation IS the backtest | report view |
| Persistence | localStorage patterns (paperStore) | strategy + signal stores |

**Deferred (post-launch):** Telegram/Discord/email/webhook alerts (browser toast ships
now), Community Marketplace (needs auth/backend — ties to the deferred Supabase/Stripe
plan), AI Strategy Assistant. Sprint 14/15 material.

---

## Architecture (`lib/strategy/` — pure engine; UI in `components/strategy/`)

```
registry.ts    StrategySource plugins: id, name, params, outputs, operators, TFs
               v1 roster: price(close/high/low), EMA, SMA, RSI, MACD(macd/signal/hist),
               Supertrend, ADX(+DI/−DI), OBV, ATR, VWAP, Volume(+SMA20), Bollinger,
               Stochastic — PLUS platform exclusives: contextScore / trendScore /
               momentumScore / volumeScore per TF (Market Context Engine)
seriesCache.ts closed-bar cached series per (source, params, tf)
operators.ts   >, <, >=, <=, between, crossAbove, crossBelow, increasing, decreasing
types.ts       Strategy JSON schema (versioned) + expression tree + StrategySignal
evaluate.ts    tree evaluator: per closed chart-TF bar; conditions read THEIR OWN
               TF's last-closed values (non-repaint); returns per-bar boolean
signals.ts     tree TRUE on bar close → immutable StrategySignal {id, time, direction,
               entry=close, SL/TP1-3 from exit config (ATR-multiple defaults),
               matched conditions, confidence = matched-weight share}
strategyStore.ts  localStorage: strategies + IMMUTABLE VERSIONS (edit = new version,
               compare/rollback) + enabled flags + signal log (capped)
```

### Strategy JSON (Phase 2/4 — unlimited nesting)

```ts
interface Strategy {
  id: string; name: string; direction: 'long' | 'short';
  schemaVersion: 1;
  versions: Array<{ v: number; createdAt: number; note: string; tree: GroupNode }>;
  activeVersion: number; enabled: boolean;
  exits: { slAtr: number; tp1R: number; tp2R: number; tp3R: number };
}
type GroupNode = { logic: 'AND' | 'OR'; children: Array<GroupNode | Condition> };
interface Condition {
  left: SeriesRef;                      // { source: 'rsi', output: 'rsi', params: {len:14} }
  op: Operator;
  right: SeriesRef | number | [number, number]; // series, constant, or between-range
  tf: Timeframe;                        // per-condition timeframe (Phase 5)
}
```

### Trade tracking & analytics
`walkVdTrades` is generalized to `walkTrades(candles, TradePlan[], exits)` (a tiny
type-widening refactor — VD keeps working, golden tests prove it). Strategy signals
become tracked trades with the SAME lifecycle (BE after TP1, trailing, MFE/MAE, points),
the same chart rendering (arrows, R:R boxes, price tags, outcome chips), and the same
stats (win rate, expectancy, PF, streaks + **per-version** rollup → the doc's
versioning payoff: v1.0 62% → v1.2 76% comparisons).

### Chart integration
One new registered indicator `strategy_signals`: reads the ENABLED strategies from the
store (module-store pattern, chart-host-only publishing — the flicker lesson), renders
each strategy's signals/trades with the proven VD rendering. Hover/click detail comes
from the trade table (same click-to-focus as VD).

### Backtest = the evaluator itself (Phase 13)
Because evaluation is deterministic over closed bars, loading N bars of history IS the
backtest: every historical trigger becomes a signal → trade → stats. The Lab shows the
report per version: trades, win rate, PF, expectancy, TP1/2/3 hit distribution, avg
duration, max drawdown (R), streaks. No separate engine needed.

---

## Sprints (TDD; commit per sprint; you verify visually — no Playwright)

**S1 — Registry + operators + series cache** (`registry.ts`, `operators.ts`,
`seriesCache.ts` + tests). Adapters wrap existing computes (plot-id extraction, the
producer pattern from `indicatorScores.ts`). Operators tested on crafted series incl.
cross semantics (prev vs now) and warm-up nulls.

**S2 — Schema + evaluator** (`types.ts`, `evaluate.ts` + tests). Unlimited nesting,
per-condition TF, per-bar boolean output; determinism test (prefix invariance — the
non-repaint lock, same style as our goldens).

**S3 — Signals + trades + persistence** (`signals.ts`, `strategyStore.ts`,
`walkTrades` generalization + tests). Immutable signals; localStorage versioned store;
signal log survives reload (paperStore pattern).

**S4 — Chart overlay** (`strategy_signals` indicator + registration + tests). Arrows,
entry/SL/TP1-3 levels, R:R boxes, outcome chips — all reused.

**S5 — Strategy Lab UI** (rebuild `StrategyBuilderPanel` — currently a broken stub with
one of the 2 pre-existing tsc errors; this sprint deletes/replaces it, clearing that
debt). Visual builder: condition rows (source/output/op/value/TF selects driven
ENTIRELY by the registry → zero UI changes for future indicators), nested group
editor (recursive component), exits config, save-as-new-version with note,
enable/disable, strategy list.

**S6 — Analytics + backtest report + alerts-lite** (`components/strategy/` stats view).
Per-strategy per-version report (S3 stats over full history), version comparison table,
browser-toast alert on a new live signal (reuses the existing toast system).
Telegram/webhooks deferred.

## Review questions
1. **Scope OK?** S1–S6 now; marketplace/AI/external alerts deferred post-launch.
2. **v1 source roster** above (incl. the Context-score exclusives) — anything missing
   you consider must-have (e.g. Stack Score — needs its engine exposed as a series)?
3. **Exits**: v1 uses ATR/R-multiple exits per strategy (like the doc's signal shape).
   Zone-based TPs (VD-style) as a later exit mode — OK?
4. Strategy Lab lives in the existing right-dock **Strategy panel** (replacing the
   stub). A dedicated full page (`/lab`) can come later — OK for v1?
