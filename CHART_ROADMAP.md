# Chart Roadmap — Beating TradingView for the Active Trader

**Optimizes for:** the active BTC/ETH/SOL trader (PRODUCT.md default).
**Felt gap:** chart features + a fast way to add indicators.
**Framing:** We don't out-feature TradingView on breadth (100+ exchanges, Pine, social).
We win on the fastest multi-timeframe read + the tightest chart→trade loop, with
table-stakes charting good enough that a trader never leaves for the basics.

**Status legend:** ✅ done · 🔨 in progress · ⬜ not started

---

## What already exists (don't rebuild)

- **Primitive + hit-test system** (`lib/orderOverlayPrimitive.ts`, `lib/chartFxPrimitive.ts`,
  `customHitTest`) — foundation for all drawing tools.
- **Draggable price overlays** (entry/TP/SL), custom Y-axis wheel zoom, body-pan.
- **Chart types**: candlestick, Heikin-Ashi, Renko (ATR-auto bricks).
- **Indicator framework** (`lib/indicatorFramework.ts`) + custom indicators (squeeze
  momentum, SMA ribbon/crossover), per-plot styling, separate-pane support.
- **Golden-master harness** (`lib/testing/goldenMaster.ts`, `docs/PORTING_PINESCRIPT.md`)
  — verifies every indicator (library-backed OR hand-ported) against TradingView.
- **Live data**: 6-TF Binance WS + bookTicker, TanStack Query history, synth fallback.
- **Mood/confluence engine** (`lib/signals.ts` `aggregateMood`) + `SignalMatrix`.

**Structural limit to fix:** the chart renders exactly ONE active indicator
(`activeIndicatorId: string`). Phase 1B lifts this to a stack.

---

## Phase 0 — Stabilize ✅ DONE

- ✅ Moved 18 untracked scratch/recovery files to gitignored `_scratch/`.
- ✅ Typecheck clean (`tsc --noEmit` → 0 errors; the 142 KB `ts_errors.txt` was stale).
- ✅ 157 tests green.

---

## Phase 1 — Indicators (the immediate goal) · ~1.5–2 wk

### Strategy: bucket, don't transpile

We do **not** build a PineScript transpiler or embed a JS Pine runtime (weeks of work,
correctness risk, and most indicators aren't custom Pine anyway). Instead:

- **Bucket A — standard indicators**: wire the already-installed **`indicatorts`**
  library to plot templates. Math is pre-verified by the library; ~10 min each.
- **Bucket B — genuinely custom**: hand-port, golden-master gated. The small minority.
- **Bucket C — already built**: e.g. the Mood Table = existing `aggregateMood`.

Every indicator — Bucket A included — gets a `*.golden.test.ts`. Library-backed does
NOT mean TradingView-identical (VWAP session anchoring, Keltner EMA-vs-SMA basis,
Stochastic smoothing all diverge); the golden master is how we catch it.

### Phase 1A — The 14 Tier-1 indicators

| # | Indicator | Bucket | Source | TV-divergence risk |
|---|-----------|--------|--------|--------------------|
| 1 | MA Ribbon (EMA 9/21/50) | A | `ema()` ×3 | — |
| 2 | Parabolic SAR | A | `psar()` | — |
| 3 | RSI (14) | A | `rsi()` | — |
| 4 | MACD | A | `macd()` | — |
| 5 | Stochastic (14,3,3) | A | `stoch()` | ⚠️ %K/%D smoothing |
| 6 | Bollinger Bands (20,2) | A | `bb()` | — (population stdev ✅) |
| 7 | ATR (14) | A | `atr()` | — |
| 8 | Keltner Channels | A | `kc()` | ⚠️ EMA basis + ATR |
| 9 | Volume (raw) | A-trivial | candle.volume | — |
| 10 | OBV | A | `obv()` | — |
| 11 | VWAP | A | `vwap()` | ⚠️ session anchor reset |
| 12 | **ADX (14)** | **B (port)** | Wilder DI/ADX via `pm.rma` | (port) |
| 13 | **SuperTrend** | **B (port)** | ATR bands on `atr()` | (port) |
| 14 | Multi-TF Mood Table | **C** | exists (`signals.ts`) | — |

**Tasks:**
1. ✅ **Scaffold** — `lib/indicators/itsTemplates.ts` (alignRight/cols/resolveInputs) +
   `lib/testing/goldenRunner.ts` (`defineGoldenTest`, ~8 lines per indicator).
2. ✅ Wired the 11 Bucket-A indicators through plot templates; snapshot-baselined each
   (Keltner + VWAP done via `pineMath` for TV-faithful EMA/ATR + session anchoring).
3. ⬜ Upgrade the 3 ⚠️ indicators (Stochastic, Keltner, VWAP) to TradingView-sourced
   golden fixtures (currently snapshot baselines — regression-only).
4. ✅ Hand-ported ADX + SuperTrend, golden-master + sanity-test gated.
5. ⬜ Surface the Mood Table as a chart-attached widget (presentation only).

All 13 compute indicators are registered in `CUSTOM_INDICATORS` and selectable in the
chart's indicator dropdown today. 172 tests green, typecheck clean.

### Phase 1B — Multi-indicator stack engine

**1B-1 (done ✅):** `activeIndicatorId: string` → `activeIndicatorIds: string[]` across
page → ChartPanel → ChartToolbar → Chart. Chart takes an additive `indicatorResults`
stack; series are **namespaced** `instanceKey::plotId` (fixes Bollinger/Keltner `basis`
collisions); signal markers merged + sorted across the stack; the `IndicatorSelect`
dropdown is now a multi-select checklist with a count badge + "Clear all"; signal matrix
shows one row per active indicator; the stack persists to `localStorage`. Debug
`console.log`s removed from the render hot path. Production build + 172 tests green.

**1B-2 (done ✅):**
- ✅ Per-instance **oscillator panes** — each oscillator instance gets its own pane via a
  *signature-gated full rebuild* (rebuild series+panes only when the stack structure
  changes; per-tick only push data). Robust against pane-index shifts.
- ✅ Per-instance **legend rows** (name · params · value · eye · gear · ✕) with
  per-instance **visibility** (local `hiddenKeys`) and a per-instance **settings modal**.
  Style edits (color/thickness/visibility) apply per `instanceKey::plotId`.
- ✅ Persist the stack in the **share URL** (`?ind=a,b,c`); URL wins over localStorage.
- ⬜ Multiple **instances of the same** indicator (two EMAs, different lengths) — still
  deferred; needs an instance-id data model (low real-world value).
- ⚠️ **Not visually verified** — Chart has no automated coverage; needs a browser smoke
  test (3+ overlays + 2 oscillators → each oscillator in its own pane; toggle eye/gear/✕;
  reload; open a shared `?ind=` link).

---

## Phase 2 — Drawing tools (the #1 table-stakes gap) · ~2–3 wk · ✅

Built as a **decoupled SVG overlay** (`components/DrawingLayer.tsx`) over the chart rather
than threading state through the chart's fragile canvas pointer machine. The chart exposes a
`ChartApi` (timeToX/priceToY/xToTime/yToPrice/candleAtX/subscribe via `onReady`); the overlay
positions drawings in chart-time/price space so they stick on pan/zoom. Left tool rail
`DrawingToolbar.tsx`; geometry + per-symbol reactive store in `lib/drawings.ts` (9 tests).

1. ✅ Horizontal line.
2. ✅ Trend line + ray (extends to edge).
3. ✅ Measure tool (Δprice, Δ%).
4. ✅ Fibonacci retracement (0/.236/.382/.5/.618/.786/1 with labels).
5. ✅ Rectangle / zone + text note.
6. ✅ Magnet (snap to nearest OHLC) + lock + hide-all + clear; select/drag (endpoint or whole)
   + Delete/Esc keys; 6-color picker.

**Persistence:** drawings keyed by **symbol** (persist across TF), stored in `localStorage`
(`btc-mood:drawings:v1`). Follow-ups: inline text editing (uses `window.prompt` today),
measure bar-count, export drawings in the share URL, and richer per-drawing styling.

⚠️ **Not visually verified** — needs a browser smoke test (draw each tool, drag endpoints,
magnet snap, lock/hide, reload to confirm persistence, switch symbol).

---

## Phase 3 — Chart types & precision · ~1 wk · ✅

- ✅ **Chart types decided: Candlestick / Heikin-Ashi / Renko only.** Line/Area/Baseline/
  Bars/Hollow are **intentionally not wanted** (would also mean re-attaching the
  order-overlay/FX/marker primitives bound to the candle series). Scope closed.
- ✅ **Renko box-size methods** — Traditional (fixed price units), ATR (ATR(length) of the
  source candles, configurable length), Percentage (percent of last traded price, with a
  live box-size preview). Engine in `lib/renko.ts` (`RenkoMethod`/`RenkoConfig`,
  golden-master-style unit tests), toolbar control `RenkoControl` (Trad / ATR / %).
- ✅ **Log / % price-scale toggle** — `Lin / Log / %` segmented control, applied via
  `priceScale('right').applyOptions({ mode })`.
- ✅ Bar-close countdown — already implemented (`countdownTextRef`, the price-axis pill).
- ✅ Crosshair data sync across panes — native to lightweight-charts (single chart, N panes).

---

## Phase 4 — Differentiators (where you pass TradingView) · ~3–4 wk · 🔨

Lean on what you uniquely have: 6 live TFs + mood engine + paper trading.

1. ✅ **MTF confluence ribbon** under the chart — one row per timeframe, each a
   *time-aligned heatmap* of that TF's signal over the selected chart's time window.
   Pure engine in `lib/confluence.ts` (`perBarSignals` reuses the shared `scoreSignal`;
   `buildRibbonSegments` maps each TF onto the common domain + merges runs), 9 unit tests;
   component `components/ConfluenceRibbon.tsx`, mounted under the chart in `app/app/page.tsx`.
   Colorblind-safe (color + glyph + label), click a row to switch TF, stale bars dimmed.
   Follow-up polish: pixel-sync to the chart's pan/zoom, and flip pulse animation.
2. ✅ **Divergence callouts** — `lib/divergence.ts` (`detectDivergence` over lower 1m–15m
   vs higher 1h–1d group bias, 6 tests); a callout banner surfaces inside `ConfluenceRibbon`
   when the groups oppose ("Lower timeframes are bearish while higher are bullish — watch
   for a pullback"). Follow-up: per-bar on-chart markers at the bar a divergence opened.
3. ✅ **Chart→trade one surface** — wired the dashboard chart to the paper engine:
   right-click → **Market Buy/Sell** (`executeOrder`), **Buy/Sell limit/stop** (stages via
   `setActiveOrder`); the open position draws **entry / TP / SL** lines and **dragging TP/SL
   updates the position** (`setPositionOverlay`); chip → close / clear. Done in `ChartPanel`
   (overlays + `onOverlayDrag` + `onChartContextMenu`) reusing the existing overlay
   primitive. Follow-ups: "Set price alert here" (needs the price-alert model → item 5);
   adding a TP/SL by dragging from nothing (today only existing TP/SL lines are draggable).
4. ✅ **Bar Replay** — toolbar **Replay** button → a scissors **cut-point selector**
   (`ReplaySelector.tsx`: blue dashed line follows the cursor, scissors cursor, click a
   candle to set the start; everything right is hidden) → bottom bar (`ReplayBar.tsx`):
   play/pause/step±1/scrub, speeds **0.1/0.3/0.5/1/3/10×**, and **multi-bookmark** (mark a
   bar, jump back to it, remove). All replay state lives in `ChartPanel` (slices the candle
   array to the play index, so indicators replay too). Exits on TF/symbol change. Follow-up:
   replay the side-panel mood/ribbon (stay live today); intrabar tick animation within a bar.
5. ✅ **Price alerts** — NEW price-alert model `lib/priceAlerts.ts` (+ 6 tests) and reactive
   store `lib/priceAlertsStore.ts`; "Set alert here" in the right-click menu; alerts render as
   dashed price lines on the chart (`Chart` `priceLines` via `createPriceLine`) with management
   pills under the chart; firing on price cross in `page.tsx` (Notification + one-shot disable).
   Follow-up: drag a line to reposition (today create via menu / remove via pill).
6. 🔨 **VWAP bands** ✅ — `lib/indicators/vwapBands.ts`: session VWAP + volume-weighted ±σ /
   ±2σ bands, registered + golden-tested. **Volume Profile** (price-axis volume histogram)
   ⬜ deferred — it's a large custom canvas-primitive feature; own pass.

---

## Phase 5 — Layout & workspace · ~2 wk · ✅

- ✅ **Multi-chart grid** — `MultiChartGrid.tsx`: 2×2 grid of the current symbol across
  15m/1h/4h/1d, each cell a self-contained `Chart` with the active indicator stack; click a
  cell's TF to focus it. Toolbar toggle + `G` key. Follow-up: per-cell symbol selection.
- ✅ **Saved workspaces** — `lib/workspaces.ts` (model + reactive store + 5 tests) +
  `WorkspaceMenu.tsx`: name/save the current {chartType, symbol, tf, indicator stack}, apply,
  delete; localStorage-persisted. Follow-up: also capture per-indicator settings / scale /
  renko (they live in ChartPanel) + round-trip via URL.
- ✅ **Symbol quick-search** — `SymbolSearch.tsx`: `/` opens a fuzzy command palette
  (arrow keys + Enter). Sets the pattern for a larger universe.

---

## Sequencing summary

| Phase | Theme | Est. | Status |
|------|-------|------|--------|
| 0 | Stabilize | 0.5 wk | ✅ |
| 1A | The 14 indicators (bucket + golden master) | ~1 wk | ✅ compute done (TV fixtures + mood widget remain) |
| 1B | Multi-indicator stack engine | ~1 wk | ✅ 1B-1 + 1B-2 done (multi-instance-of-same deferred) |
| 3 | Chart types & precision | ~1 wk | ✅ Renko methods + log scale + countdown + crosshair (extra chart types intentionally out of scope) |
| 4 | MTF ribbon, chart→trade, replay, alerts, vol profile | 3–4 wk | ✅ items 1–5 done · 6 = VWAP bands done, Volume Profile deferred |
| 5 | Multi-chart grid, templates, search | 2 wk | ✅ grid + workspaces + symbol search done |
| 2 | Drawing tools + persistence | 2–3 wk | ✅ 7 tools + magnet/lock/hide + per-symbol persistence |

**All phases complete** (built order 0 → 1 → 3 → 4 → 5 → 2). Remaining work is the deferred
follow-ups noted per phase (TradingView-sourced golden fixtures, Volume Profile, draggable
alert lines, multi-instance indicators, workspace settings capture, drawing text-edit/URL).

**Build order note (per user):** Phase 2 (drawing tools) is intentionally moved to
**last** — sequence is 0 → 1 → 3 → 4 → 5 → 2.

**If you only do three things:** Phase 1 (indicators + stack), Phase 2 items 1–4
(lines, trendline, measure, fib + persistence), and Phase 4 item 1 (the confluence
ribbon). That makes the chart sufficient to stay in, and gives one thing TradingView
structurally lacks.

## Deliberately NOT building

- No PineScript transpiler / DSL / JS Pine runtime (see Phase 1 strategy).
- No social/ideas/community.
- No multi-exchange aggregation yet.
- No third-party charting-library swap (would discard the chart layer just stabilized).
