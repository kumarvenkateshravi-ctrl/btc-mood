# Immediate-Place Trade Overlay — Design

**Status:** Approved by user (direct spec) — ready for plan
**Date:** 2026-07-04
**Branch:** `feat/tv-order-flow`
**Reference:** `C:\Users\ravic\Downloads\chartoverlay.md` (workflow) + TradingView overlay screenshot

## Goal

Replace the current *staged* order flow with an **immediate-place** workflow: the
Order Card is the only place a trade is confirmed; clicking Buy/Sell creates the
trade at once and the chart shows the Entry/TP/SL overlay, which becomes the
single surface for managing the active trade.

## Core principles

1. **Order Card = the only confirmation.** Buy/Sell in the card places the trade
   immediately (market → fills into a position; limit/stop → working order) and
   closes the card. No chart-side Confirm/Discard.
2. **Chart overlay = the only management surface** for an active trade. Two modes:
   - **Normal:** `BUY|SELL · {symbol} · Qty {n} · [TP] [SL] [Edit] [Reverse] [Close]`
   - **Edit:** `[Save TP/SL] [Cancel]`
3. **TP/SL draggable only in Edit mode.** Save commits the dragged levels to the
   store; Cancel restores the levels captured on entering Edit mode.
4. **Reverse and Close each require a confirmation dialog.**
5. **Default TP/SL auto-generated via ATR** immediately after the trade is created.
6. **Trade Store (`lib/paperStore.ts`) is the single source of truth.** The overlay
   is a visual controller only — it owns *transient UI* state (which mode, and the
   in-progress TP/SL draft while editing), never trade state.

## Removals (staged flow + duplicates)

- `lib/paperStore.ts`: delete `activeOrder` state and the staged actions
  `setActiveOrder`, `updateActiveOverlay`, `toggleActiveOverlay`,
  `confirmActiveOrder`, `clearActiveOrder`, plus their exposure in the
  `usePaperStore()` return and the `ActiveOrder` interface.
- `components/chart/OrderControlsRow.tsx`: delete (replaced by `TradeOverlay`).
- `components/ChartPanel.tsx`: remove all `activeOrder`/staged branches from the
  overlays memo, `handleOverlayDrag`, `handleOverlayChipClick`, the market-pin
  effect, `stageConfirm/stageReverse/stageToggleTp/stageToggleSl`, and the
  `overlayBadges`/`positionControls` staged wiring. The overlay is driven purely
  by the open **position** (`pos`).
- `components/trade/OrderTicket.tsx`: submit calls `placeOrder`/`executeOrder`
  immediately and closes the card. Remove the `setActiveOrder` staging path, the
  `activeOrder`-mirroring render logic, and the `stageFromInputs` machinery.
- `components/trade/TradingPanel.tsx` (Trade tab): remove the duplicate position
  management (Close-position button, TP/SL `LevelRow`s) — keep the position-size
  calculator and the "manage on the chart" note.
- `components/Chart.tsx` / `components/chart/types.ts`: remove staged-order props
  (`stagedOrder`, `onStage*`, `overlayBadges` staged bits) once unused.

`PositionsPanel` (multi-position portfolio list) is **kept** — it is a list view,
not the single-trade management overlay; its close/clear actions remain valid for
the portfolio context.

## New component: `TradeOverlay`

`components/chart/TradeOverlay.tsx` — a DOM control row docked to the Entry line's
y-coordinate (same `priceToCoordinate` + visible-range-subscription pattern as the
old `OrderControlsRow`), driven by the open position.

**Props (from `ChartPanel`, all derived from the store position):**
```ts
interface TradeOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  side: 'buy' | 'sell';
  symbol: string;
  qty: number;
  entryPrice: number;
  mode: 'normal' | 'edit';
  onEdit: () => void;
  onSave: () => void;       // commit draft TP/SL
  onCancel: () => void;     // restore pre-edit TP/SL
  onReverse: () => void;    // opens Reverse confirm
  onClose: () => void;      // opens Close confirm
  rr: { risk: number; reward: number; ratio: number | null } | null; // live, edit mode
}
```

**Normal mode row:** side badge (blue BUY / red SELL) · `{symbol}` · `Qty {n}` ·
`Edit` · `Reverse` · `Close`. (TP/SL are shown as chart lines with their own
`qty | P&L | ×` badges via the existing `OrderOverlayPrimitive`; the row's `TP`/`SL`
affordances live in Edit mode.)

**Edit mode row:** `Save TP/SL` (accent) · `Cancel` · a live
`R {risk} · Rw {reward} · R:R {ratio}` readout that updates as lines drag.

## Edit-mode state & drag gating

- `ChartPanel` holds `overlayMode: 'normal' | 'edit'` and a `draftTpSl:
  { tp: number|null; sl: number|null } | null` (the pre-edit snapshot + working
  values). This is **UI state**, not store state.
- **Entering Edit** (`onEdit`): snapshot the position's current `tp`/`sl` into
  `draftTpSl`, set mode `edit`.
- **In Edit:** the overlays memo marks TP/SL `draggable: true`; dragging updates
  `draftTpSl` locally (not the store) and recomputes live R:R. Entry stays fixed.
- **Save:** write `draftTpSl.tp`/`.sl` to the store via `setPositionOverlay`, clear
  draft, mode `normal`.
- **Cancel:** discard `draftTpSl` (store never changed), mode `normal`.
- **Normal mode:** overlays memo marks TP/SL `draggable: false` → the existing
  `OrderOverlayPrimitive.customHitTest` already returns no drag for non-draggable
  lines, so dragging is inert outside Edit mode.

TP/SL line prices shown = `draftTpSl` values in Edit mode, else the position's
committed `tp`/`sl`.

## Default ATR TP/SL on creation

When a market order fills into a new position (and the user didn't specify TP/SL in
the card), auto-set defaults from ATR of the recent candles:
- `atr = last value of computeAtr(candles, 14)` (fallback to `entry * 0.005` if
  ATR is null/0).
- long: `tp = entry + atr * tpMult`, `sl = entry - atr * slMult`
  (short mirrored). Defaults `tpMult = 3`, `slMult = 1.5` (≈ 2:1 R:R).
- Applied in `ChartPanel` right after placement (it has the candles + position),
  by calling `setPositionOverlay('tp'|'sl', ...)` once, only when the new position
  has no tp/sl yet. Keeps the ATR logic near the chart data; the store stays the
  source of truth.

## Reverse & Close confirmations

- **Reverse** (`ReverseConfirmDialog`): "Reverse Trade? BUY → SELL". On confirm,
  reverse via the engine (place an opposite market order of `2 × units` reduce-then-
  open, or the store's reversal path in `applyFill`), then re-seed ATR TP/SL for the
  new side (TP below / SL above for a short). Uses the existing `<Modal>` primitive.
- **Close** (`CloseConfirmDialog`): "Close Trade? Current Profit {±$X}" using
  `unrealizedPnl(pos, mark)`. On confirm, `closePosition(mark, symbol)`; overlay
  disappears; the trade lands in Trade History (existing behavior).

## Live Risk / Reward

While editing (or always, when a position has tp+sl), compute from
`lib/trading.ts`:
- `risk = |entry − sl| × qty`, `reward = |tp − entry| × qty`,
  `ratio = riskReward(side==='buy'?'long':'short', entry, tp, sl)` /
  `formatRR(ratio)` for display.

## Files

- Delete: `components/chart/OrderControlsRow.tsx`
- Create: `components/chart/TradeOverlay.tsx`,
  `components/trade/ReverseConfirmDialog.tsx`, `components/trade/CloseConfirmDialog.tsx`
- Modify: `lib/paperStore.ts`, `components/trade/OrderTicket.tsx`,
  `components/trade/OrderModal.tsx`, `components/ChartPanel.tsx`,
  `components/Chart.tsx`, `components/chart/types.ts`,
  `components/trade/TradingPanel.tsx`, `lib/paperStore.staged.test.ts` (delete/replace)

## Testing

- Update/replace `lib/paperStore.staged.test.ts` (staged lifecycle no longer exists)
  with tests for the immediate-place path: market order → position with ATR TP/SL;
  edit draft → save commits / cancel reverts (pure store-level where possible).
- `projectedPnl`/`riskReward` unit coverage stays.
- Manual: full 10-step workflow in the browser (place → overlay → edit-drag-save →
  reverse → close), no console errors.

## Out of scope (v1)

- Multiple simultaneous *pending* order lines with individual controls (the
  screenshot's stacked limit orders) beyond what already renders — the active-trade
  overlay is the focus.
