# Chart Smoke Test

The chart-rendering components (`Chart.tsx`, `DrawingLayer.tsx`, panes, overlays) have **no
automated coverage** — tsc + vitest + `next build` pass, but rendering/interaction is only
verifiable in a browser. Run this after any chart change. ~10 minutes.

Start: `npm run dev` → open the dashboard (`/app`). Open the browser devtools console to
watch for errors and `[alert]` / `[price-alert]` logs.

Legend: ✅ expected · ⚠️ known-deferred (won't work yet, by design).

---

## 1. Indicators & multi-pane stack (Phase 1)

- [ ] Open the **Indicators** dropdown (toolbar). It's a multi-select checklist with a count badge.
- [ ] Add **MA Ribbon**, **Bollinger Bands**, **VWAP** → ✅ three overlays draw on the price pane.
- [ ] Add **RSI**, **MACD** → ✅ **each gets its own pane** below the candles (not one shared pane).
- [ ] Add **Volume** → ✅ a colored histogram pane.
- [ ] Each active indicator shows a **legend row** top-left (name · params · value · eye · gear · ✕).
  - [ ] Click an **eye** → that indicator (and its pane) hides; click again → returns.
  - [ ] Click a **gear** → settings modal for *that* indicator; change a length/color → ✅ updates live.
  - [ ] Click **✕** → that indicator is removed.
- [ ] **Reload** → the indicator stack persists (localStorage).
- [ ] Copy the URL (should contain `?ind=...`), open in a new tab → ✅ same stack loads.
- [ ] ⚠️ Adding the *same* indicator twice (two EMAs) is not supported yet.

## 2. Indicator correctness spot-check

- [ ] **RSI** stays within 0–100; **Stochastic** %K/%D within 0–100.
- [ ] **VWAP** sits among the candles (volume-weighted), not flat.
- [ ] **SuperTrend** flips draw a BUY/SELL marker at the flip bar.
- [ ] ⚠️ The 3 flagged indicators (Stochastic, Keltner, VWAP) are snapshot-baselined, not yet
      verified against TradingView — eyeball them against a TV chart if precision matters.

## 3. Chart types & Renko (Phase 3)

- [ ] Toggle **Candles / Heikin-Ashi / Renko** (toolbar or `C`/`H`/`R`).
- [ ] In **Renko**, the box-size control shows **Trad / ATR / %**:
  - [ ] **Trad** → enter a box size → bricks resize.
  - [ ] **ATR** → change the **Len** → brick size changes with ATR.
  - [ ] **%** → change the percent → preview `≈ <box>` updates and bricks resize.
- [ ] **Lin / Log / %** price-scale toggle changes the right axis spacing.
- [ ] The price/countdown pill on the right axis ticks down to the next bar close.

## 4. MTF confluence ribbon + divergence (Phase 4.1, 4.2)

- [ ] Below the chart: **Multi-timeframe posture** — one row per TF (1m…1d), each a
      time-aligned colored heatmap, with a glyph + Buy/Flat/Sell label (not color-only).
- [ ] Click a row → ✅ the chart switches to that timeframe; the row highlights.
- [ ] Stale timeframes are dimmed.
- [ ] When lower TFs (1m–15m) oppose higher TFs (1h–1d), a **Divergence** banner appears with a
      plain-language read (may need real market conditions to trigger).

## 5. Chart → trade loop (Phase 4.3)

- [ ] **Right-click** the chart → menu with **Buy/Sell market**, **Buy/Sell limit**,
      **Buy/Sell stop**, **Set alert here**.
- [ ] **Buy market** → ✅ a position opens (toast); an **entry line** draws on the chart.
- [ ] Open a position with an **SL** (via the order ticket in the right rail), then **drag the
      SL line** on the chart → ✅ the position's SL follows. Same for TP.
- [ ] The overlay chip closes the position / clears a level.

## 6. Price alerts (Phase 4.5)

- [ ] Right-click above the current price → **Set alert here** → ✅ a dashed **green** line
      appears (above = green, below = red), plus a **pill** under the chart.
- [ ] Wait for price to cross it (or set one just above the mid) → ✅ console logs
      `[price-alert]`, the alert disables, and (if notifications granted) a notification fires.
- [ ] Click the pill's **✕** → alert + line removed. Reload → alerts persist.
- [ ] ⚠️ Dragging an alert line to reposition is not supported yet.

## 7. Bar replay (Phase 4.4)

- [ ] Click **Bar Replay** (under the chart) → controls appear, chart shows partial history.
- [ ] **Play** → bars advance; indicators on the chart replay too. **Pause / step / scrub** work.
- [ ] Change **speed** (0.5/1/2/4×). **Exit** restores the live chart.
- [ ] Switching timeframe/symbol exits replay automatically.
- [ ] ⚠️ The side-panel mood/ribbon stay live during replay (by design).

## 8. VWAP bands (Phase 4.6)

- [ ] Add **VWAP Bands** → ✅ VWAP line + ±σ and ±2σ bands hug the price within the session.
- [ ] ⚠️ Full **Volume Profile** (price-axis histogram) is not built.

## 9. Layout & workspace (Phase 5)

- [ ] Press **`/`** → symbol search palette; type, arrow keys + Enter → ✅ symbol switches.
- [ ] Press **`G`** or the grid toggle → ✅ a 2×2 grid of 15m/1h/4h/1d for the current symbol,
      each with the active indicators. Click a cell's TF chip → focuses it (back to single).
- [ ] **Workspaces** menu → type a name → **Save**. Change chart type / indicators, then
      **apply** the saved workspace → ✅ it restores chart type, symbol, TF, indicator stack.
- [ ] Delete a workspace via its ✕.
- [ ] ⚠️ Workspaces don't yet capture per-indicator settings / scale mode / Renko config.

## 10. Drawing tools (Phase 2)

Use the **left rail** next to the chart.

- [ ] **Horizontal line** → click → ✅ a dashed line spans the chart at that price.
- [ ] **Trend line** → drag from A to B → ✅ a segment; **Ray** → extends past B to the edge.
- [ ] **Rectangle** → drag → ✅ a translucent box. **Fib** → drag → ✅ 7 labeled levels.
- [ ] **Measure** → drag → ✅ a box + a `Δprice (Δ%)` label, green up / red down.
- [ ] **Text** → click → prompts for text → ✅ label appears.
- [ ] **Cursor** tool: click a drawing → it selects (handles show); drag a **handle** to move
      an endpoint, drag the **body** to move the whole thing; **Delete** removes it.
- [ ] **Magnet** on → new/dragged points snap to the nearest OHLC.
- [ ] **Lock** → drawings can't be moved. **Hide-all** → drawings vanish (toggle back). **Clear** → all gone.
- [ ] **Pan/zoom** the chart → ✅ drawings stick to their bars/prices.
- [ ] **Reload** → drawings persist. **Switch symbol** → drawings are per-symbol (BTC's stay on BTC).
- [ ] In a drawing tool (not cursor), **right-click** still opens the trade menu (left-click draws).
- [ ] ⚠️ Inline text editing (re-edit after creation) and exporting drawings in the URL aren't built.

## 11. Trading panel (right rail → Trade tab)

- [ ] Enter a **quantity**; **Buy / Long** (green) opens a long, **Sell / Short** (red) a short.
- [ ] An **entry line** draws on the chart, **labeled** `SIDE qty @ price`.
- [ ] **Position-size calculator**: set balance / risk % / SL distance → a **recommended qty**
      appears; **Use** copies it into quantity.
- [ ] With a position open: **Add TP** / **Add SL** → labeled lines on the chart; **drag** them
      → the line's price label updates live and the panel's **Reward : Risk** recomputes.
- [ ] **Live P&L** block shows Entry · Current · uPnL ($) · uPnL (%), updating with price.
- [ ] **Close position** flattens it.

## 12. Performance tracking (below the chart)

- [ ] After a trade closes (manually or via TP/SL), a row appears in **Trade history**
      (Dir · Qty · Entry · Exit · Opened · Closed · P&L · WIN/LOSS).
- [ ] **Backtest statistics** card updates: Total / Win rate / Avg win / Avg loss / Profit
      factor / Expectancy / Largest win·loss / Max drawdown / Net P&L.
- [ ] The **equity curve** sparkline redraws on each close.

## 13. Isolated replay session

- [ ] Note your **live balance**. Enter **Replay**, cut, **Buy** with a TP & SL.
- [ ] Trading panel shows a **"Replay session $balance"** badge; Trade history / stats headers
      read **"Replay session"**.
- [ ] **Play** forward → the trade auto-closes when a bar hits TP/SL, logged at the bar's time.
- [ ] **Exit** replay → panels revert to **Live** and the **live balance is unchanged**.

## 14. Deep history — lazy-load + jump-to-date

- [ ] **Scroll / drag left** repeatedly → older candles keep appearing and the view **stays put**
      (no jump). Works on any timeframe; on 5m you can reach years back.
- [ ] Reach the start of listed history (≈2017) → it stops requesting.
- [ ] The 30s background refresh does **not** wipe the bars you scrolled back to.
- [ ] **Jump-to-date** (calendar icon in toolbar): pick a date → chart shows a window around it,
      fit to view. Scroll left to extend it. **✕ Latest** returns to the live chart.
- [ ] ⚠️ Lazy-load is disabled during replay (prepending would shift replay indices) — expected.
- [ ] ⚠️ Jump shows a *focused window*, not a continuous chart from that date to now — by design.

---

## If something's broken

Note the **phase/component** and the exact repro. The chart rendering lives in
`components/Chart.tsx` (panes/series/overlays/price-lines), interaction overlays in
`components/DrawingLayer.tsx`, and the trade wiring + drawing rail in `components/ChartPanel.tsx`.
Each phase's files and deferred items are listed in `CHART_ROADMAP.md`.
