# TradingView-Style Order Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate TradingView's order flow exactly as shown in the reference screenshots: chart Buy/Sell buttons open an order ticket (Market/Limit/Stop, Units→USD, TP/SL exits, Order info); submitting stages the order on the chart as draggable entry/TP/SL lines with a `[⇅][Discard][Confirm][TP][SL][qty | P&L | ×]` control row; Confirm places it; the open position shows live-P&L pills where × closes (books profit/loss) and TP/SL lines each show `qty | projected P&L | ×`.

**Architecture:** The paper engine is already complete (`lib/paper.ts` fills/TP/SL/OCO/liquidation; `lib/paperStore.ts` has the full staged-order lifecycle: `ActiveOrder`, `setActiveOrder`, `updateActiveOverlay`, `toggleActiveOverlay`, `confirmActiveOrder`, `clearActiveOrder`, `setPositionOverlay`, `closePosition`). `ChartFloatingControls` already renders Buy/Sell bid/ask pills; `OrderOverlayPrimitive` already draws draggable dashed entry/TP/SL lines. The work is: (1) route the Buy/Sell pills into the order ticket, (2) bring `OrderTicket` to visual/functional parity with TV, (3) render the **staged** `activeOrder` on the chart (today only the open *position* renders), (4) add the DOM control row + right-side `qty | P&L | ×` pills, (5) wire every × / Confirm / Discard action.

**Tech Stack:** Next.js (custom — check `node_modules/next/dist/docs/` before Next-specific code, per AGENTS.md), lightweight-charts v5 primitives, `useSyncExternalStore` paper store (NOT zustand — call exported actions directly), vitest.

## Global Constraints

- Paper trading only (the "Paper Trading" badge in TV screenshot = our whole product; no real exchange orders).
- Staged-order flow applies to the LIVE account only in v1; during bar-replay (`replayMode === 'active'`) the Buy/Sell pills keep their current behavior (replay has its own isolated session).
- Money labels: `±X,XXX.XX USD` with sign, matching the screenshots (`+181.19 USD`, `−2,208.71 USD`).
- Colors: TP line/pill `#22d39a` (bull), SL `#fb5168` (bear), entry/staged `#5aa2e6` (accent) — these are the existing `OrderOverlayPrimitive` defaults; do not invent new ones.
- Leverage source of truth stays `ChartPanel`'s `LEVERAGE = 10` constant → thread it, don't re-declare.
- After each task: `npx tsc --noEmit` → 0, `npx eslint <touched>` → 0 errors, `npx vitest run` → pass, commit.
- Final task runs `graphify update .` (project CLAUDE.md rule).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Projected-P&L helper + staged-lifecycle tests

**Files:**
- Modify: `lib/paper.ts` (one new pure function)
- Test: `lib/paper.projectedPnl.test.ts` (new)
- Test: `lib/paperStore.staged.test.ts` (new — locks the existing staged lifecycle we're about to build UI on)

**Interfaces:**
- Produces (used by Tasks 4-6): `projectedPnl(side: 'buy' | 'sell', units: number, entry: number, exit: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/paper.projectedPnl.test.ts
import { describe, it, expect } from 'vitest';
import { projectedPnl } from './paper';

describe('projectedPnl', () => {
  it('long: profit above entry, loss below', () => {
    expect(projectedPnl('buy', 10, 61_956, 62_069.33)).toBeCloseTo(1133.3, 1);
    expect(projectedPnl('buy', 10, 61_956, 61_716.72)).toBeCloseTo(-2392.8, 1);
  });
  it('short: mirrored', () => {
    expect(projectedPnl('sell', 10, 61_956, 61_716.72)).toBeCloseTo(2392.8, 1);
  });
  it('zero units → 0', () => {
    expect(projectedPnl('buy', 0, 61_956, 70_000)).toBe(0);
  });
});
```

```ts
// lib/paperStore.staged.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetForTest, __getStateForTest,
  setActiveOrder, updateActiveOverlay, toggleActiveOverlay,
  confirmActiveOrder, clearActiveOrder, newOrderId,
} from './paperStore';

// 0.1 units ≈ $620 margin at 10x — fits the $10,000 paper balance
// (10 units would need ~$62k margin and be correctly rejected).
const stage = (over: Partial<import('./paperStore').ActiveOrder> = {}) =>
  setActiveOrder({
    id: newOrderId(), symbol: 'BTCUSDT', side: 'buy', type: 'limit',
    units: 0.1, entry: 61_937.85, tp: null, sl: null,
    reduceOnly: false, postOnly: false, ocoGroup: null,
    ...over,
  });

describe('staged order lifecycle', () => {
  beforeEach(() => __resetForTest());

  it('stage → drag entry/tp/sl → state reflects each drag', () => {
    stage();
    updateActiveOverlay('entry', 61_900);
    toggleActiveOverlay('tp', true, 62_069.33);
    toggleActiveOverlay('sl', true, 61_716.72);
    updateActiveOverlay('tp', 62_100);
    const a = __getStateForTest().activeOrder!;
    expect(a.entry).toBe(61_900);
    expect(a.tp).toBe(62_100);
    expect(a.sl).toBe(61_716.72);
  });

  it('confirm places the order and clears the stage', () => {
    stage();
    const res = confirmActiveOrder({ leverage: 10, midPrice: 61_956 });
    expect(res.ok).toBe(true);
    const s = __getStateForTest();
    expect(s.activeOrder).toBeNull();
    expect(s.pending.length).toBe(1); // limit order is working
  });

  it('confirm of a market stage fills immediately into a position', () => {
    stage({ type: 'market' });
    const res = confirmActiveOrder({ leverage: 10, midPrice: 61_956 });
    expect(res.ok).toBe(true);
    expect(__getStateForTest().positions['BTCUSDT']?.side).toBe('long');
  });

  it('discard clears without placing', () => {
    stage();
    clearActiveOrder();
    const s = __getStateForTest();
    expect(s.activeOrder).toBeNull();
    expect(s.pending.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/paper.projectedPnl.test.ts lib/paperStore.staged.test.ts`
Expected: projectedPnl suite FAILS (`projectedPnl` not exported); staged suite may already pass — that is fine, it is a regression lock.

- [ ] **Step 3: Implement `projectedPnl`**

Append to `lib/paper.ts` (after `unrealizedPnl`):

```ts
/**
 * P&L a position of `units` opened at `entry` would realize at `exit`.
 * Used for the projected-P&L pills on TP/SL lines (fees excluded — the
 * pills match TradingView, which shows gross projections).
 */
export function projectedPnl(
  side: Side,
  units: number,
  entry: number,
  exit: number,
): number {
  const dir = side === 'buy' ? 1 : -1;
  return (exit - entry) * units * dir;
}
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run lib/paper.projectedPnl.test.ts lib/paperStore.staged.test.ts` → PASS.
If a staged test fails, STOP and report — it means the store lifecycle differs from this plan's assumption and Tasks 4-5 must be re-checked against reality.

- [ ] **Step 5: Commit**

```bash
git add lib/paper.ts lib/paper.projectedPnl.test.ts lib/paperStore.staged.test.ts
git commit -m "feat: projectedPnl helper + staged-order lifecycle tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Buy/Sell chart buttons open the Order Ticket

**Files:**
- Modify: `app/app/page.tsx:228` (route `onQuickTrade` to the modal)
- Modify: `components/ChartPanel.tsx` (own the modal open-state + render `OrderModal`)
- Modify: `components/trade/OrderModal.tsx` + `components/trade/OrderTicket.tsx` (accept `initialSide`)

**Interfaces:**
- Consumes: existing `ChartFloatingControls` `onQuickTrade?: (side: 'buy' | 'sell') => void` (already renders SELL bid / BUY ask pills — no visual change needed there).
- Produces: `OrderModalProps` + `OrderTicketProps` gain `initialSide?: 'buy' | 'sell'`.

- [ ] **Step 1: ChartPanel owns the ticket**

In `components/ChartPanel.tsx`, add state near the other UI state (`const [ctxMenu, ...]` at :233):

```ts
  const [ticketSide, setTicketSide] = useState<'buy' | 'sell' | null>(null);
```

Where `onQuickTrade` is threaded to `<Chart …>` (:541), replace the pass-through with a local handler that opens the ticket for live trading and falls back to the old behavior during replay:

```ts
  const handleQuickTrade = useCallback(
    (side: 'buy' | 'sell') => {
      if (replayTrading) { onQuickTrade?.(side); return; }
      setTicketSide(side);
    },
    [replayTrading, onQuickTrade],
  );
```

pass `onQuickTrade={handleQuickTrade}` to `<Chart>`, and render beside the existing modals at the bottom of the JSX:

```tsx
      <OrderModal
        open={ticketSide !== null}
        onClose={() => setTicketSide(null)}
        symbol={symbol}
        midPrice={mid}
        leverage={LEVERAGE}
        onLeverageChange={() => {}}
        reduceAvailable={hasPosition && pos ? pos.units : 0}
        initialSide={ticketSide ?? 'buy'}
      />
```

with `import OrderModal from '@/components/trade/OrderModal';`.

- [ ] **Step 2: Thread `initialSide`**

`OrderModal.tsx`: add `initialSide?: 'buy' | 'sell';` to `OrderModalProps`, pass to `<OrderTicket … initialSide={p.initialSide} />`.
`OrderTicket.tsx`: add the prop and use it to seed the side toggle state (find the existing side `useState` and seed: `useState<'buy' | 'sell'>(p.initialSide ?? 'buy')`; also re-sync when the modal reopens with a different side via `useEffect(() => { if (p.initialSide) setSide(p.initialSide); }, [p.initialSide])`).

- [ ] **Step 3: Verify**

`npx tsc --noEmit` → 0. Manual: click the red SELL pill top-left of the chart → ticket opens with Sell tab preselected; blue BUY pill → Buy preselected; during replay the pills keep routing to the right dock.

- [ ] **Step 4: Commit**

```bash
git add app/app/page.tsx components/ChartPanel.tsx components/trade/OrderModal.tsx components/trade/OrderTicket.tsx
git commit -m "feat: chart Buy/Sell pills open the order ticket

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Order Ticket parity with the TV screenshot

**Files:**
- Modify: `components/trade/OrderTicket.tsx` (875 lines — audit + close gaps, don't rewrite)

The ticket already exists with tabs and calls `setActiveOrder` (:162) / `placeOrder` (:228). Bring it to parity with Image 3, item by item:

- [ ] **Step 1: Audit checklist against the screenshot** (open the file, verify each; fix only what's missing)
  - Header: `Sell 61,965.99 | 0.01 | Buy 61,966.00` split price selector (side toggle shows both prices).
  - Tabs: `Market · Limit · Stop` with underline on active tab.
  - `Units` input with live USD conversion on the right (`units × midPrice` formatted, e.g. `1237.87 USD`).
  - **Exits** section: `Take profit, price` row with an on/off toggle + price input + tick-offset dropdown (`75 ticks`); same for `Stop loss, price` (`25 ticks`). Tick size is `BTC_TICK_SIZE` (0.1) from `lib/paper.ts`; offset options: 25 / 50 / 75 / 100 / 150 ticks. Toggling ON seeds price = `mid ± ticks × BTC_TICK_SIZE` (+ for TP on buy, − for SL on buy; mirrored for sell).
  - **Order info** block: `Margin` (`marginFor(units, mid, leverage)` vs available balance, `X / Y` format + progress bar), `Leverage` (`10:1`), `Tick value` (`0.10 USD` = `BTC_TICK_VALUE_USD`), `Trade value` (`notionalFor(units, mid)` USD).
  - CTA: full-width button labeled `<Side> — <units> <symbol> <TYPE>` (e.g. `Buy 10 BTCUSDT MARKET`), blue for buy / red for sell.

- [ ] **Step 2: Submit stages instead of placing**

The TV flow in the screenshots: ticket submit puts the order **on the chart for drag-adjustment with Confirm/Discard** (Images 1-2). Change the submit handler so ALL types stage:

```ts
  const submit = () => {
    setActiveOrder({
      id: newOrderId(),
      symbol: p.symbol,
      side,
      type: orderType,                       // 'market' | 'limit' | 'stop'
      units,
      entry: orderType === 'market' ? p.midPrice : limitOrStopPrice,
      tp: tpEnabled ? tpPrice : null,
      sl: slEnabled ? slPrice : null,
      reduceOnly,
      postOnly,
      ocoGroup: null,
    });
    onClose();                                // close the modal; chart takes over
  };
```

(`onClose` reaches OrderTicket via a new optional prop threaded from OrderModal — add `onSubmitted?: () => void` if a direct close prop doesn't already exist.) Keep the existing direct `placeOrder` path (:228) only if it belongs to a different flow (e.g. the right-dock QuickTrade panel) — verify before deleting.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` → 0; `npx vitest run` → pass. Manual: ticket submit closes the modal and (after Task 4) the staged lines appear; every Order-info number updates as units/leverage change.

- [ ] **Step 4: Commit**

```bash
git add components/trade/OrderTicket.tsx components/trade/OrderModal.tsx
git commit -m "feat: order ticket TV parity + staged submit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Staged order renders on the chart (draggable entry/TP/SL)

**Files:**
- Modify: `components/ChartPanel.tsx:237-267` (overlays memo + drag/chip routing)

Today `overlays` renders only the open position. Extend it to prefer the staged order:

- [ ] **Step 1: Overlays memo**

```ts
  const activeOrder = paper.activeOrder; // already in usePaperStore() state
  const overlays = useMemo<ChartOverlay[]>(() => {
    // A staged order takes over the overlay layer (TV behavior: you adjust
    // the pending ticket on the chart before Confirm).
    if (activeOrder && !replayTrading) {
      const o: ChartOverlay[] = [{
        kind: 'entry',
        price: activeOrder.entry,
        draggable: activeOrder.type !== 'market', // market entry pins to mid
      }];
      if (activeOrder.tp != null) o.push({ kind: 'tp', price: activeOrder.tp, draggable: true });
      if (activeOrder.sl != null) o.push({ kind: 'sl', price: activeOrder.sl, draggable: true });
      return o;
    }
    if (!hasPosition || !pos) return [];
    const o: ChartOverlay[] = [{ kind: 'entry', price: pos.entryPrice, draggable: false }];
    if (pos.tp != null) o.push({ kind: 'tp', price: pos.tp, draggable: true });
    if (pos.sl != null) o.push({ kind: 'sl', price: pos.sl, draggable: true });
    return o;
  }, [activeOrder, replayTrading, hasPosition, pos]);
```

(Verify `usePaperStore()` exposes `activeOrder`; it snapshots the whole store `State`, which includes it. If the hook narrows fields, extend it.)

- [ ] **Step 2: Drag routing**

```ts
  const handleOverlayDrag = useCallback(
    (kind: OverlayKind, p: number) => {
      if (activeOrder && !replayTrading) {
        if (kind === 'entry' || kind === 'tp' || kind === 'sl') updateActiveOverlay(kind, p);
        return;
      }
      if (kind !== 'tp' && kind !== 'sl') return;
      if (replayTrading) replaySetOverlay(kind, p);
      else setPositionOverlay(kind, p, symbol);
    },
    [activeOrder, replayTrading, symbol],
  );
```

Import `updateActiveOverlay` from `@/lib/paperStore`. Also keep the market-stage entry pinned: add an effect that, while `activeOrder?.type === 'market'`, mirrors `mid` into the stage — `useEffect(() => { if (activeOrder?.type === 'market') updateActiveOverlay('entry', mid); }, [activeOrder?.type, mid])`.

- [ ] **Step 3: Overlay chrome props**

`<Chart>` already receives `overlaySide/overlayUnitsLabel/overlayTypeLabel/…` — extend the values to reflect the staged order when present (side = `activeOrder.side`, unitsLabel = `String(activeOrder.units)`, typeLabel = `activeOrder.type.toUpperCase()`, `overlayHasTp/Sl` from `activeOrder.tp/sl != null`, `overlayEntryPrice = activeOrder.entry`).

- [ ] **Step 4: Verify + commit**

Manual: submit a limit ticket → blue dashed entry line appears at the limit price and drags smoothly; TP/SL lines (if toggled in ticket) drag independently; the position overlays still work when no stage is active.

```bash
git add components/ChartPanel.tsx
git commit -m "feat: staged order renders as draggable chart overlays

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: On-chart control row — Discard/Confirm/TP/SL + `qty | P&L | ×` pills

**Files:**
- Create: `components/chart/OrderControlsRow.tsx`
- Modify: `components/Chart.tsx` (render it; pass positioning + action props)
- Modify: `components/ChartPanel.tsx` (action handlers)
- Modify: `lib/orderOverlayPrimitive.ts` (right-side `qty | ±USD` label per line)

This is the heart of the TV look (Images 1-2). Two parts: **canvas** right-aligned `qty | ±USD USD | ×`-style labels on each line (primitive), and a **DOM** row of real buttons at the entry line (`⇅ | Discard | Confirm | TP | SL`).

- [ ] **Step 1: Primitive — right-side pills**

Extend `OrderOverlayOptions` in `lib/orderOverlayPrimitive.ts`:

```ts
export interface OverlayLineBadge {
  kind: OverlayKind;
  qty: string;          // '10'
  pnl: number | null;   // projected (tp/sl) or live (entry); null = hide
}
// on OrderOverlayOptions:
//   badges?: OverlayLineBadge[];
```

In `OrderRenderer.draw`, after the existing left label block, draw the badge right-aligned (anchor: `w - 90 * hpr` from the right edge so it sits left of the price-axis, like TV):

```ts
        const badge = (opts.badges ?? []).find((b) => b.kind === o.kind);
        if (badge) {
          const pnlTxt = badge.pnl == null ? '' :
            ` | ${badge.pnl >= 0 ? '+' : '−'}${Math.abs(badge.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
          const btxt = `${badge.qty}${pnlTxt} | ✕`;
          const bW = ctx.measureText(btxt).width + padX * 2;
          const bX = w - bW - 8 * hpr;
          ctx.fillStyle = 'rgba(10, 14, 22, 0.9)';
          ctx.fillRect(bX, boxY, bW, boxH);
          ctx.strokeStyle = lineColor;
          ctx.strokeRect(bX, boxY, bW, boxH);
          ctx.fillStyle = lineColor;
          ctx.fillText(btxt, bX + padX, cy);
        }
```

Add a hit-test for the ✕ so clicks route: extend `customHitTest` to also return `{ kind, action: 'cancel' }` when `(x, y)` lands in the last ~18px of a badge box (store each badge's rect on the instance during draw: `this._prim.badgeRects.set(o.kind, { x: bX, y: boxY, w: bW, h: boxH })`, cleared at draw start). Route it through the existing `onOverlayChipClick` plumbing in `useChartEvents` (grep `customHitTest` there and mirror the drag hit-test's click branch).

- [ ] **Step 2: DOM control row**

```tsx
// components/chart/OrderControlsRow.tsx
'use client';

import { useEffect, useReducer } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface OrderControlsRowProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  entryPrice: number;
  hasTp: boolean;
  hasSl: boolean;
  onReverse: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onToggleTp: () => void;
  onToggleSl: () => void;
}

/** TV-style staged-order controls, docked to the entry line's y. */
export function OrderControlsRow(p: OrderControlsRowProps) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!p.chart) return;
    const ts = p.chart.timeScale();
    const onRange = () => bump();
    ts.subscribeVisibleLogicalRangeChange(onRange);
    return () => ts.unsubscribeVisibleLogicalRangeChange(onRange);
  }, [p.chart]);

  const y = p.series?.priceToCoordinate(p.entryPrice) ?? null;
  if (y == null) return null;

  const chip = 'h-6 rounded border border-line bg-surface-1/95 px-2 text-[11px] leading-none text-ink hover:bg-surface-2';
  return (
    <div
      className="pointer-events-auto absolute right-[150px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      <button type="button" className={chip} title="Reverse side" onClick={p.onReverse}>⇅</button>
      <button type="button" className={chip} onClick={p.onDiscard}>Discard</button>
      <button
        type="button"
        className="h-6 rounded bg-accent px-2.5 text-[11px] font-semibold leading-none text-white hover:opacity-90"
        onClick={p.onConfirm}
      >
        Confirm
      </button>
      <button type="button" className={`${chip} ${p.hasTp ? 'text-bull-bright' : 'border-dashed text-ink-faint'}`} onClick={p.onToggleTp}>TP</button>
      <button type="button" className={`${chip} ${p.hasSl ? 'text-bear-bright' : 'border-dashed text-ink-faint'}`} onClick={p.onToggleSl}>SL</button>
    </div>
  );
}
```

(Same render-time-read + range-subscription pattern as `ConfluenceRibbon` — no polling, no setState-in-effect.)

- [ ] **Step 3: Render from Chart + wire actions from ChartPanel**

`components/Chart.tsx`: new optional props — `stagedOrder?: { entry: number; hasTp: boolean; hasSl: boolean } | null;` plus `onStageReverse/onStageDiscard/onStageConfirm/onStageToggleTp/onStageToggleSl` callbacks (add to `ChartProps` in `components/chart/types.ts`). Render inside the chart container div:

```tsx
      {stagedOrder && (
        <OrderControlsRow
          chart={chartRef.current}
          series={candleSeriesRef.current}
          entryPrice={stagedOrder.entry}
          hasTp={stagedOrder.hasTp}
          hasSl={stagedOrder.hasSl}
          onReverse={onStageReverse!}
          onDiscard={onStageDiscard!}
          onConfirm={onStageConfirm!}
          onToggleTp={onStageToggleTp!}
          onToggleSl={onStageToggleSl!}
        />
      )}
```

`components/ChartPanel.tsx` handlers (import the store actions):

```ts
  const stageConfirm = useCallback(() => {
    const res = confirmActiveOrder({ leverage: LEVERAGE, midPrice: mid });
    if (!res.ok && res.error) console.warn(res.error); // store also sets lastError → toast
  }, [mid]);
  const stageReverse = useCallback(() => {
    if (!activeOrder) return;
    setActiveOrder({ ...activeOrder, side: activeOrder.side === 'buy' ? 'sell' : 'buy' });
  }, [activeOrder]);
  const stageToggleTp = useCallback(() => {
    if (!activeOrder) return;
    const on = activeOrder.tp == null;
    toggleActiveOverlay('tp', on, activeOrder.entry + (activeOrder.side === 'buy' ? 1 : -1) * 75 * BTC_TICK_SIZE * 10);
  }, [activeOrder]);
  const stageToggleSl = useCallback(() => {
    if (!activeOrder) return;
    const on = activeOrder.sl == null;
    toggleActiveOverlay('sl', on, activeOrder.entry - (activeOrder.side === 'buy' ? 1 : -1) * 25 * BTC_TICK_SIZE * 10);
  }, [activeOrder]);
```

Pass `stagedOrder={activeOrder && !replayTrading ? { entry: activeOrder.entry, hasTp: activeOrder.tp != null, hasSl: activeOrder.sl != null } : null}` plus the five callbacks (`onStageDiscard={clearActiveOrder}`).

- [ ] **Step 4: Badges (P&L pills) from ChartPanel**

Build and pass badges via the existing overlay-chrome path (Chart → `overlayPrimitiveRef.options`):

```ts
  const overlayBadges = useMemo<OverlayLineBadge[]>(() => {
    if (activeOrder && !replayTrading) {
      const b: OverlayLineBadge[] = [{ kind: 'entry', qty: String(activeOrder.units), pnl: projectedPnl(activeOrder.side, activeOrder.units, mid, activeOrder.entry) }];
      if (activeOrder.tp != null) b.push({ kind: 'tp', qty: String(activeOrder.units), pnl: projectedPnl(activeOrder.side, activeOrder.units, activeOrder.entry, activeOrder.tp) });
      if (activeOrder.sl != null) b.push({ kind: 'sl', qty: String(activeOrder.units), pnl: projectedPnl(activeOrder.side, activeOrder.units, activeOrder.entry, activeOrder.sl) });
      return b;
    }
    if (!hasPosition || !pos) return [];
    const side = pos.side === 'long' ? 'buy' as const : 'sell' as const;
    const b: OverlayLineBadge[] = [{ kind: 'entry', qty: String(pos.units), pnl: unrealizedPnl(pos, mid) }];
    if (pos.tp != null) b.push({ kind: 'tp', qty: String(pos.units), pnl: projectedPnl(side, pos.units, pos.entryPrice, pos.tp) });
    if (pos.sl != null) b.push({ kind: 'sl', qty: String(pos.units), pnl: projectedPnl(side, pos.units, pos.entryPrice, pos.sl) });
    return b;
  }, [activeOrder, replayTrading, hasPosition, pos, mid]);
```

Thread as a new `overlayBadges` prop on `<Chart>` → into `overlayPrimitiveRef.current.options.badges` where the other `overlay*` props are applied (grep `overlayUnitsLabel` in Chart.tsx / useOrderOverlays.ts and mirror).

- [ ] **Step 5: Verify + commit**

Manual vs Image 1: staged limit shows `[⇅][Discard][Confirm][TP][SL]` row + `10 | +181.19 USD | ✕`-style pills on each line; Confirm places (line switches to position styling); Discard clears everything.

```bash
git add components/chart/OrderControlsRow.tsx components/Chart.tsx components/chart/types.ts components/ChartPanel.tsx lib/orderOverlayPrimitive.ts
git commit -m "feat: TV-style staged-order controls + P&L pills on chart

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Monitor + close — every ✕ does the right thing

**Files:**
- Modify: `components/ChartPanel.tsx` (chip-click routing)
- Modify: `components/chart/useChartEvents.ts` (badge ✕ hit-test → `onOverlayChipClick`)

- [ ] **Step 1: Route the ✕ clicks** — extend `handleOverlayChipClick` (ChartPanel :255-267):

```ts
  const handleOverlayChipClick = useCallback(
    (key: 'tp' | 'sl' | 'close') => {
      // Staged order: ✕ on a line edits the stage, never the live account.
      if (activeOrder && !replayTrading) {
        if (key === 'close') clearActiveOrder();          // entry ✕ = discard
        else toggleActiveOverlay(key, false, 0);          // tp/sl ✕ = remove exit
        return;
      }
      if (key === 'close') {
        if (replayTrading) replayClose(replayLast?.close ?? mid, replayLast?.time ?? Math.floor(Date.now() / 1000));
        else paper.closePosition(mid, symbol);            // books profit/loss at market
      } else if (replayTrading) {
        replaySetOverlay(key, null);
      } else {
        setPositionOverlay(key, null, symbol);
      }
    },
    [activeOrder, replayTrading, replayLast, paper, mid, symbol],
  );
```

- [ ] **Step 2: Badge hit-test → click** — in `components/chart/useChartEvents.ts`, find where `overlayPrimitiveRef.current.customHitTest` is called on pointer-down (the drag branch). Add: on pointer-up without drag, if the hit-test (Task 5 Step 1's badge rects) reports a ✕ hit for kind `entry|tp|sl`, call `onOverlayChipClickRef.current?.(kind === 'entry' ? 'close' : kind)`.

- [ ] **Step 3: Position TP/SL add-chips** — when a position is open WITHOUT tp/sl, TV shows dotted `TP SL` chips (Image 2). Reuse `OrderControlsRow` in a reduced mode: render it for open positions too with only the TP/SL toggle chips (`onToggleTp` → `setPositionOverlay('tp', suggested, symbol)`); pass a `mode: 'staged' | 'position'` prop that hides ⇅/Discard/Confirm in position mode.

- [ ] **Step 4: Verify + commit**

Manual end-to-end (the acceptance script):
1. Click BUY pill → ticket (Market, 10 units) → submit → staged line at mid with control row.
2. Click TP chip → green line appears → drag to 62,069 → pill shows `10 | +1,3xx.xx USD | ✕`.
3. Click SL chip → orange line → drag to 61,716 → pill shows `10 | −2,xxx.xx USD | ✕`.
4. Confirm → position opens; entry pill now shows live P&L ticking with price.
5. Drag position TP/SL → store updates (check right dock).
6. ✕ on TP line → TP removed; ✕ on entry pill → position closes, P&L booked to balance, trade appears in history.
7. Repeat with Limit: entry line drags before Confirm; Discard cancels cleanly.

```bash
git add components/ChartPanel.tsx components/chart/useChartEvents.ts components/chart/OrderControlsRow.tsx
git commit -m "feat: close/cancel actions on chart order pills

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification + graph update

- [ ] `npx tsc --noEmit` → exit 0.
- [ ] `npx eslint .` → no new errors vs master.
- [ ] `npx vitest run` → full suite green (paper/paperStore/alerts suites especially).
- [ ] Run the Task 6 acceptance script once more in the browser, plus: replay mode still trades via the isolated session (staged flow doesn't activate); multi-chart grid unaffected.
- [ ] `graphify update .`
- [ ] Fixup commit if needed.

---

## Design decisions locked in this plan

1. **Everything stages, including market orders** — matches the screenshots' Confirm/Discard flow and gives one code path; a market stage pins its entry to mid until Confirm.
2. **Canvas pills + DOM buttons split** — the `qty | ±USD | ✕` labels live in the primitive (crisp, zoom-synced, one draw pass), while Confirm/Discard/TP/SL are real DOM buttons (focus, hover, a11y) positioned by `priceToCoordinate` with the same event-driven pattern as ConfluenceRibbon.
3. **Staged flow is live-account only** — replay keeps its isolated session and current UX; guards check `replayTrading` at every routing point.
4. **Projected P&L is gross (no fees)** — matches TV's pills; fee-inclusive numbers stay in the right-dock panels.
5. **No engine changes** — `paper.ts`/`paperStore.ts` already model the whole lifecycle; Task 1's tests freeze that contract before UI work starts.
