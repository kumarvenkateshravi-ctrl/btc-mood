# "Moving Averages & FVG" Indicator — frozen design

**Date:** 2026-07-20 · **Status:** FROZEN (user-approved) · **Source:** `MA-FVG-Tune.pine`
**Registry id:** `ma_fvg` · **Display name:** "Moving Averages & FVG" · **Overlay** (price pane)

## License

The FVG module is **LuxAlgo, CC BY-NC-SA 4.0 (NonCommercial)**. Flagged to the user; ported as
requested. Same NonCommercial constraint as the existing LuxAlgo-derived work on this branch.

## What this is

A faithful TypeScript port of the Pine overlay, rendered through the existing indicator framework
(`IndicatorResult`: `plots` / `markers` / `signals`). Five feature blocks, all on the price pane:

1. **MA Ribbon** — 4 configurable MAs.
2. **VWAP** (+3 σ/percentage bands) and an independent **VWAP-1** (+1 band).
3. **MA + VWAP confluence** candle highlight.
4. **Fair Value Gaps** (LuxAlgo) — boxes, mitigation, unmitigated levels.
5. **RSI overlay** scaled onto price + **Buy/Sell signals**.

## Approved adaptations (only deviations from the Pine)

1. VWAP anchors limited to **Session / Week / Month / Quarter / Year** (reuse existing
   `vwapAnchor.ts`; drop Earnings/Dividends/Splits/Decade/Century — no such events for BTC).
2. FVG evaluated on the **chart timeframe** (the Pine's own default `tf=''`); MTF-FVG deferred.
3. Confluence "background" → a candle **marker** (framework has no Pine `bgcolor`); candle tint via
   marker on the confluence bar.

## Rendering model (from framework study)

- MA/VWAP/RSI-overlay lines → `type: 'line'` plots, `pane: 'overlay'`.
- FVG boxes → `type: 'band'` plots: per-bar `{upper,lower}|null`, filled across the bars a gap
  spans (formation bar → mitigation or `+extend`), null elsewhere (same mechanism as `sdZones`).
- Confluence + Buy/Sell/early-alert → `IndicatorMarker[]` (`arrowUp/arrowDown/circle`,
  `belowBar/aboveBar/inBar`) and, for Buy/Sell, `signals: SignalSide[]` so scanners/alerts can
  consume them later.
- **Closed-bar discipline:** confluence and confirmed Buy/Sell only on confirmed bars (the Pine's
  `barstate.isconfirmed`); the composite treats the last candle as forming and never signals on it.

## Fidelity map (Pine → port)

### MA Ribbon (`group: "Moving Average Ribbon"`)
- 4 MAs, each: show, type ∈ {SMA, EMA, SMMA(RMA), WMA, VWMA}, source, length, color.
  Defaults 20/50/100/200, colors `#f6c309 #fb9800 #fb6500 #f60c0c`.
- `ma()` switch → `pm.sma/emaPine/rma/wma/vwma` (exactly the mapping already in `rsi.ts applyMa`).
  Note the Pine quirk kept verbatim: MA3 is `na` when hidden; the others always compute.

### VWAP + bands (`group: "VWAP Settings" / "VWAP Bands"`)
- Anchored VWAP with σ bands — **reuse the exact math already in `vwapBands.ts`**, extracted into a
  shared pure helper `anchoredVwap(candles, src, anchor) → { vwap, sd }[]`. Bands = `vwap ± mult·basis`,
  `basis = StdDev ? sd : vwap·0.01` (Percentage mode). 3 bands, show/mult/color each; default show
  band1 only, mults 1/2/3. Source default `hlc3`, anchor default `session`.
- **VWAP-1**: same helper, independent anchor (default `week`), 1 band (mult 1).

### Confluence (`group: "MA + VWAP Confluence"`)
- `touch(ma) = low ≤ ma ≤ high`; confluence = show ∧ showVWAP ∧ touch(MA1) ∧ touch(MA2) ∧
  touch(VWAP) ∧ confirmed. MA3/MA4/VWAP-1 excluded (verbatim). → marker (circle, inBar,
  `confluenceColor`) on each confluence bar.

### FVG (`group: "Fair Value Gap" / "FVG Style" / "FVG Lines"`) — LuxAlgo
- `threshold = auto ? cumMean((high−low)/low) : thresholdPer/100`.
- 3-bar detection (verbatim):
  - bull: `low > high[2] ∧ close[1] > high[2] ∧ (low−high[2])/high[2] > threshold` → gap `[high[2], low]`.
  - bear: `high < low[2] ∧ close[1] < low[2] ∧ (low[2]−high)/high > threshold` → gap `[high, low[2]]`.
- Box spans `[formationBar−2 .. formationBar+extend]` (extend default 20).
- **Mitigation:** bull removed when `close < gap.min`; bear removed when `close > gap.max`
  (box ends at the mitigation bar). Optional mitigation lines (deferred to style flags; counts kept).
- **Unmitigated levels:** last-N (`showLast`, default 0 = off) surviving gaps → horizontal level lines.
- Counts `bull/bear count` + `bull/bear mitigated` exposed for future alerts.

### RSI overlay (`group: "RSI Settings" / "RSI Overlay Scaling" / "RSI Overlay Style"`)
- `rawRsi(src, 9)` (new helper, TV formula from `rsi.ts`), `wma(rsi,21)` strength, `ema(rsi,3)` signal.
- Scale to price: `priceRange = Range ? highest(high,LB)−lowest(low,LB) : atr(len)·mult`;
  `baseline = SMA(src,50) | close`; `scale(v) = baseline + (v−50)/100·priceRange`.
- Plots: baseline (50-line), scaledRSI, scaledWMA (strength), scaledEMA (signal).

### Signals (`group: "RSI Strength / VWAP / MA-200 Signals"`)
- Confirmed: `aboveBoth = strengthWMA > vwap ∧ strengthWMA > MA4`; `buySignal = aboveBoth ∧ ¬aboveBoth[1]`
  (mirror for sell). → `arrowUp belowBar` / `arrowDown aboveBar` markers + `signals[i]='buy'|'sell'`.
  Quirk kept: MA4 used even if hidden.
- Early (VWAP-only): `crossover/crossunder(strengthWMA, vwap)` → small triangle-ish markers
  (framework has no triangle → `circle` tint, `belowBar/aboveBar`).

## Files

- `lib/indicators/maFvg/anchoredVwap.ts` — shared VWAP+σ helper (+ `vwapBands.ts` refactor to reuse it).
- `lib/indicators/maFvg/fvg.ts` — pure FVG engine (`detectFvgs`, mitigation, unmitigated).
- `lib/indicators/maFvg/rsiOverlay.ts` — `rawRsi`, scaling, signal crossings.
- `lib/indicators/maFvg/index.ts` — `computeMaFvg` composite.
- Registry entry + input/style defs in `lib/customIndicatorsLibrary.ts`.
- Colocated `*.test.ts` (hand-computed golden fixtures) beside each module.

## Tasks (each releasable — TDD, tsc clean, suite green, atomic commit)

1. This spec.
2. `anchoredVwap` helper + `vwapBands.ts` refactored onto it (parity test proves byte-identical output).
3. FVG engine.
4. RSI overlay + signal crossings.
5. `computeMaFvg` composite + registry entry + settings defs.
6. Live chart verification (Playwright) + docs/memory.

## Non-goals (v1)

MTF FVG, mitigation-line styling beyond counts, alertcondition wiring (signals are emitted; alert
UI is separate), commercial-license resolution.
