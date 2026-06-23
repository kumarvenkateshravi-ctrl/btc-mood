# TradingView-grade Layout Redesign — Tracking Checklist

Goal: move from a **vertical-stack dashboard** to a **TV-style fixed instrument frame** —
chart fills the stage, everything else docks or floats, zero scroll to see the chart.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done & verified
Each item has a **Done when** line = the acceptance test to confirm it matches expectation.

---

## Workstream 1 — Bottom dock panel (highest leverage)

Move the always-rendered stacked sections into one collapsible, tabbed bottom panel.

- [ ] **1.1 Create `BottomDock` shell** — a bar pinned to the bottom of the chart shell with tabs.
  - Done when: a thin (~32px) tab strip is visible under the chart; clicking a tab expands the panel **over/below the chart within the fixed frame**, not by growing the page.
- [ ] **1.2 Drag-to-resize divider** between chart and dock.
  - Done when: dragging the divider resizes the dock (min ~120px, max ~⅔ height); the chart re-fits live; height persists to localStorage.
- [ ] **1.3 Collapse/expand toggle** (click active tab again, or a chevron).
  - Done when: collapsed = only the tab strip shows and the chart reclaims the space; expanded = last height restored.
- [ ] **1.4 Tab: Trades** → move `TradeHistory` here.
  - Done when: `TradeHistory` no longer renders in the page stack; it lives in the dock and still shows live vs replay-session trades + CSV export.
- [ ] **1.5 Tab: Stats** → move `BacktestStats`.
  - Done when: stats render inside the dock; equity sparkline still updates.
- [ ] **1.6 Tab: Backtest** → move `BacktestPanel`.
  - Done when: backtest runs from the dock against the selected TF/candles.
- [ ] **1.7 Tab: Alerts** → move `AlertsPanel`.
  - Done when: alert create/list/delete all work from the dock.
- [ ] **1.8 Tab: Indicators** → move `IndicatorPicker` (or keep in toolbar dropdown + here).
  - Done when: add/remove/param-edit all work from the dock; no duplicate stray section remains in the page.
- [ ] **1.9 Unread/active badges on tabs** (e.g. open-trade count on Trades).
  - Done when: tab labels show a small count badge when relevant.
- [ ] **1.10 Remove the now-empty page-stack sections.**
  - Done when: `page.tsx` no longer stacks Trade/Stats/Backtest/Alerts/Indicator sections below the chart.

---

## Workstream 2 — Visible timeframe quick-row in the toolbar

TV keeps the common TFs one click away, rest behind `+`.

- [ ] **2.1 Inline TF quick-row** (e.g. `15m 1h 4h 1D`) directly in `ChartToolbar`.
  - Done when: the 4–6 most-used TFs are visible as buttons; active one is highlighted; one click switches with no dropdown.
- [ ] **2.2 `+` overflow dropdown** for the remaining TFs.
  - Done when: every TF in `TIMEFRAMES` is reachable; selecting a non-quick TF can promote it into the visible row (optional).
- [ ] **2.3 Remove the redundant lower `TimeframeStrip`** (or repurpose to confluence-only).
  - Done when: there's a single canonical TF switcher; no two controls fighting over the same job.

---

## Workstream 3 — Fixed, non-relayouting frame

The chart must never jump.

- [ ] **3.1 Toolbar never wraps** — replace `flex-wrap` with horizontal overflow into a `»` menu.
  - Done when: at narrow widths the toolbar stays one row; overflow controls collapse into a `»` menu; chart height is unchanged.
- [ ] **3.2 Shell is a fixed-height frame**: `Header → [toolbar | chart | dock]` fills the viewport.
  - Done when: on first load, candles fill the screen with **no vertical page scroll**; the right rail + bottom dock are the only things that move.
- [ ] **3.3 Right rail stays a true docked rail** (keep `isSidebarOpen` behavior).
  - Done when: collapsing the rail gives the width to the chart instantly with a smooth transition; chart re-fits.
- [ ] **3.4 Resize stability** — toolbar/dock/rail changes re-fit the chart, never overflow.
  - Done when: toggling rail, resizing dock, entering replay, and entering fullscreen never cause a layout jump or clipped axis.

---

## Workstream 4 — Canvas polish (the premium feel)

Inside the chart rectangle — small details that read as "instrument."

- [ ] **4.1 Right margin** — leave ~8–12% empty space right of the last candle.
  - Done when: there's breathing room past the live candle; drawings can extend into the future.
- [ ] **4.2 Live price tag + countdown-to-close** on the right scale.
  - Done when: the last-price tag tracks the close in its up/down color and a bar-close countdown ticks under it.
- [ ] **4.3 "Scroll to realtime" affordance** when scrolled back.
  - Done when: a ⟳ button appears only when the view is scrolled away from the live edge and snaps back on click.
- [ ] **4.4 Axis fit/zoom polish** — double-click price scale = auto-fit; log/%/auto reachable at the scale.
  - Done when: double-click on the price scale auto-fits; existing Lin/Log/% control still works.
- [ ] **4.5 Floating legend hover toolbar** (eye / settings / delete per indicator).
  - Done when: hovering an indicator legend row shows inline hide/settings/remove without opening the toolbar dropdown.

---

## Cross-cutting acceptance (run before calling it "done")

- [ ] **Zero-scroll test**: fresh load on a 1080p screen shows the full chart with no page scrollbar.
- [ ] **Wow test**: open app → candles dominate → Trades/Stats/Backtest are a single click in the dock.
- [ ] **No-jump test**: switch TF, toggle rail, open replay, open a dock tab — chart never jumps or clips an axis.
- [ ] **State persistence**: dock height, open tab, rail open/closed, and selected TF survive reload.
- [ ] **Mobile/narrow**: below `xl`, layout degrades gracefully (dock becomes full-width sheet; toolbar overflow works).
- [ ] **Green build**: `npx tsc --noEmit` = 0 errors, `npx vitest run` passes, `npx next build` succeeds.

---

## Suggested build order

1. **W3.2 + W3.1** (fixed frame, non-wrapping toolbar) — establishes the stage.
2. **W1.1 → 1.3** (dock shell + resize + collapse) — the container.
3. **W1.4 → 1.10** (migrate panels in, delete stack) — the payoff.
4. **W2** (TF quick-row) — quick win, big daily-use improvement.
5. **W4** (canvas polish) — the final 10% that sells the "wow."
