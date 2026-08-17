# Watchlist Panel (BTC/ETH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-pane Watchlist to `/app` showing live BTC & ETH ticker rows (Symbol • Last • Chg • Chg% • Vol); clicking a row switches the main chart symbol via the page's existing `setSymbol`.

**Architecture:** A `useWatchlist` hook polls Binance's 24h-ticker REST endpoint (one request for both symbols) with pure, tested `fmtCompact` + `toWatchlistRow` helpers. A `WatchlistPanel` component (with a pure `WatchlistRowView`) renders the table. A new `watchlist` tab in the existing `RightDock` mounts it in the 450px aside, wired to the page's `symbol`/`setSymbol`.

**Tech Stack:** TypeScript, React, Vitest, existing `lib/format` helpers + `RightDock` right-pane system.

## Global Constraints

- Symbols: `BTCUSDT`, `ETHUSDT` only (both chartable / valid compare symbols). Gold deferred.
- Chg and Chg% show `-` on negatives but NO `+` on positives (matches the reference image): `formatNumber(chg, { precision: 2 })` and `formatPercent(chgPct, { signed: false })`.
- Volume compact with ALWAYS 2 decimals ("9.18K", "6.81M", "161.59K") — custom `fmtCompact`, not the built-in `compact`.
- Reuse the page's `symbol`/`setSymbol`/`isCompareSymbol`; no change to `useMarketData`, `/api/klines`, history, drawings, or alerts.
- `npx tsc --noEmit` clean (ignore only the pre-existing `lib/indicators/maFvg/signals.test.ts` parse error). Full `npx vitest run` green.

---

## File Structure

- Create: `lib/hooks/useWatchlist.ts` — types, symbol list, pure helpers, and the polling hook.
- Create: `lib/hooks/useWatchlist.test.ts` — `fmtCompact` + `toWatchlistRow` tests.
- Create: `components/WatchlistPanel.tsx` — `WatchlistRowView` (pure) + `WatchlistPanel` (uses the hook).
- Create: `components/WatchlistPanel.test.tsx` — `WatchlistRowView` render test.
- Modify: `components/RightDock.tsx` — add `'watchlist'` to `RightPanelId` + an `ITEMS` entry.
- Modify: `app/app/page.tsx` — import + render `WatchlistPanel` in the aside.

---

### Task 1: `useWatchlist` hook + pure helpers

**Files:**
- Create: `lib/hooks/useWatchlist.ts`
- Create: `lib/hooks/useWatchlist.test.ts`

**Interfaces:**
- Produces: `interface WatchlistRow { symbol: string; label: string; last: number; chg: number; chgPct: number; vol: number }`; `WATCHLIST_SYMBOLS: { symbol: string; label: string }[]`; `fmtCompact(n: number): string`; `toWatchlistRow(t, label: string): WatchlistRow`; `useWatchlist(): { rows: WatchlistRow[]; status: 'loading' | 'live' | 'error' }`.

- [ ] **Step 1: Write the failing tests**

Create `lib/hooks/useWatchlist.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { fmtCompact, toWatchlistRow } from './useWatchlist';

describe('fmtCompact', () => {
  it('formats K/M/B always to 2 decimals; small numbers whole; NaN → em dash', () => {
    expect(fmtCompact(942)).toBe('942');
    expect(fmtCompact(9180)).toBe('9.18K');
    expect(fmtCompact(161590)).toBe('161.59K');
    expect(fmtCompact(6_810_000)).toBe('6.81M');
    expect(fmtCompact(2_500_000_000)).toBe('2.50B');
    expect(fmtCompact(NaN)).toBe('—');
  });
});

describe('toWatchlistRow', () => {
  it('maps Binance 24hr ticker strings to numbers', () => {
    const t = { symbol: 'BTCUSDT', lastPrice: '64602.80', priceChange: '618.61', priceChangePercent: '0.97', volume: '9180' };
    expect(toWatchlistRow(t, 'BTCUSDT')).toEqual({
      symbol: 'BTCUSDT', label: 'BTCUSDT', last: 64602.8, chg: 618.61, chgPct: 0.97, vol: 9180,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/hooks/useWatchlist.test.ts`
Expected: FAIL — module `./useWatchlist` not found.

- [ ] **Step 3: Create `lib/hooks/useWatchlist.ts`**

```typescript
'use client';

import { useEffect, useState } from 'react';

export interface WatchlistRow {
  symbol: string;
  label: string;
  last: number;
  chg: number;
  chgPct: number;
  vol: number;
}

/** The watchlist roster. Both are valid compare symbols (chartable). */
export const WATCHLIST_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: 'BTCUSDT', label: 'BTCUSDT' },
  { symbol: 'ETHUSDT', label: 'ETHUSDT' },
];

/** Compact volume with ALWAYS 2 decimals: 9180 → "9.18K", 6_810_000 → "6.81M". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(Math.round(n));
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
}

/** Map one Binance 24hr ticker to a WatchlistRow (string fields → numbers). */
export function toWatchlistRow(t: BinanceTicker, label: string): WatchlistRow {
  return {
    symbol: t.symbol,
    label,
    last: +t.lastPrice,
    chg: +t.priceChange,
    chgPct: +t.priceChangePercent,
    vol: +t.volume,
  };
}

const POLL_MS = 5000;

/** Poll Binance's 24hr ticker for the watchlist roster (one request for all
 *  symbols), every 5s. Client-side fetch — same pattern as useMarketData's
 *  ticker. Rows keep WATCHLIST_SYMBOLS order regardless of API order. */
export function useWatchlist(): { rows: WatchlistRow[]; status: 'loading' | 'live' | 'error' } {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    const symbolsParam = encodeURIComponent(JSON.stringify(WATCHLIST_SYMBOLS.map((s) => s.symbol)));
    const labelOf = new Map(WATCHLIST_SYMBOLS.map((s) => [s.symbol, s.label]));

    const load = async () => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as BinanceTicker[];
        if (!alive) return;
        const bySymbol = new Map(data.map((t) => [t.symbol, t]));
        const next = WATCHLIST_SYMBOLS
          .map((s) => bySymbol.get(s.symbol))
          .filter((t): t is BinanceTicker => !!t)
          .map((t) => toWatchlistRow(t, labelOf.get(t.symbol) ?? t.symbol));
        setRows(next);
        setStatus('live');
      } catch {
        if (alive) setStatus((prev) => (prev === 'live' ? 'live' : 'error'));
      }
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return { rows, status };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/hooks/useWatchlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useWatchlist.ts lib/hooks/useWatchlist.test.ts
git commit -m "feat(app): useWatchlist hook + helpers (Binance 24h ticker for BTC/ETH)"
```

---

### Task 2: `WatchlistPanel` component

**Files:**
- Create: `components/WatchlistPanel.tsx`
- Create: `components/WatchlistPanel.test.tsx`

**Interfaces:**
- Consumes: `useWatchlist`, `fmtCompact`, `WatchlistRow` (Task 1); `formatNumber`, `formatPercent` (`@/lib/format`).
- Produces: default export `WatchlistPanel({ activeSymbol: string; onSelect: (symbol: string) => void })`; named export `WatchlistRowView({ row: WatchlistRow; active: boolean; onSelect: (s: string) => void })`.

- [ ] **Step 1: Write the failing render test**

Create `components/WatchlistPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WatchlistRowView } from './WatchlistPanel';
import type { WatchlistRow } from '@/lib/hooks/useWatchlist';

const row = (over: Partial<WatchlistRow> = {}): WatchlistRow => ({
  symbol: 'BTCUSDT', label: 'BTCUSDT', last: 64602.8, chg: 618.61, chgPct: 0.97, vol: 9180, ...over,
});

describe('WatchlistRowView', () => {
  it('renders symbol, last, chg (no + sign), chg% and compact volume', () => {
    const html = renderToStaticMarkup(<WatchlistRowView row={row()} active={false} onSelect={() => {}} />);
    expect(html).toContain('BTCUSDT');
    expect(html).toContain('64,602.80');
    expect(html).toContain('618.61');   // positive chg: no leading '+'
    expect(html).toContain('0.97%');    // positive pct: no leading '+'
    expect(html).toContain('9.18K');
    expect(html).toContain('text-bull-bright'); // up → green tone
  });

  it('a negative row uses the bear tone and a leading minus', () => {
    const html = renderToStaticMarkup(<WatchlistRowView row={row({ symbol: 'ETHUSDT', label: 'ETHUSDT', chg: -12.56, chgPct: -0.31 })} active={false} onSelect={() => {}} />);
    expect(html).toContain('-12.56');
    expect(html).toContain('-0.31%');
    expect(html).toContain('text-bear-bright');
  });

  it('the active row carries the selected style', () => {
    const html = renderToStaticMarkup(<WatchlistRowView row={row()} active={true} onSelect={() => {}} />);
    expect(html).toContain('bg-accent/10');
    expect(html).toContain('aria-pressed="true"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/WatchlistPanel.test.tsx`
Expected: FAIL — module `./WatchlistPanel` not found.

- [ ] **Step 3: Create `components/WatchlistPanel.tsx`**

```tsx
'use client';

import { formatNumber, formatPercent } from '@/lib/format';
import { useWatchlist, fmtCompact, type WatchlistRow } from '@/lib/hooks/useWatchlist';

const BADGE: Record<string, string> = {
  BTCUSDT: 'bg-[#f7a63c]', // BTC amber
  ETHUSDT: 'bg-[#6366f1]', // ETH indigo
};

const GRID = 'grid grid-cols-[1.4fr_1fr_0.9fr_0.8fr_0.9fr] items-center gap-1';

export function WatchlistRowView({ row, active, onSelect }: { row: WatchlistRow; active: boolean; onSelect: (s: string) => void }) {
  const tone = row.chg >= 0 ? 'text-bull-bright' : 'text-bear-bright';
  return (
    <button
      type="button"
      onClick={() => onSelect(row.symbol)}
      aria-pressed={active}
      className={[GRID, 'w-full px-3 py-1.5 text-left text-xs transition-colors', active ? 'bg-accent/10' : 'hover:bg-surface-3'].join(' ')}
    >
      <span className="flex items-center gap-2 font-medium text-ink">
        <span className={['h-2.5 w-2.5 shrink-0 rounded-full', BADGE[row.symbol] ?? 'bg-ink-faint'].join(' ')} />
        {row.label}
      </span>
      <span className="text-right font-mono tabular-nums text-ink">{formatNumber(row.last, { precision: 2 })}</span>
      <span className={['text-right font-mono tabular-nums', tone].join(' ')}>{formatNumber(row.chg, { precision: 2 })}</span>
      <span className={['text-right font-mono tabular-nums', tone].join(' ')}>{formatPercent(row.chgPct, { signed: false })}</span>
      <span className="text-right font-mono tabular-nums text-ink-muted">{fmtCompact(row.vol)}</span>
    </button>
  );
}

export default function WatchlistPanel({ activeSymbol, onSelect }: { activeSymbol: string; onSelect: (symbol: string) => void }) {
  const { rows, status } = useWatchlist();
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">Watchlist</h2>
        {status !== 'live' && <span className="text-[10px] text-ink-faint">{status === 'loading' ? 'Loading…' : 'Offline'}</span>}
      </div>
      <div className={[GRID, 'border-b border-line px-3 py-1 text-[10px] uppercase tracking-wider text-ink-faint'].join(' ')}>
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span className="text-right">Chg%</span>
        <span className="text-right">Vol</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-xs text-ink-faint">{status === 'error' ? 'Failed to load prices.' : 'Loading prices…'}</div>
      ) : (
        rows.map((r) => (
          <WatchlistRowView key={r.symbol} row={r} active={r.symbol === activeSymbol} onSelect={onSelect} />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/WatchlistPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/WatchlistPanel.tsx components/WatchlistPanel.test.tsx
git commit -m "feat(app): WatchlistPanel component (clickable BTC/ETH rows)"
```

---

### Task 3: Wire into the right dock + page

**Files:**
- Modify: `components/RightDock.tsx`
- Modify: `app/app/page.tsx`

**Interfaces:**
- Consumes: `WatchlistPanel` default export (Task 2); the page's existing `symbol`, `setSymbol`, `isCompareSymbol`, `rightPanel`.

- [ ] **Step 1: Add the `watchlist` dock entry**

In `components/RightDock.tsx`, add `Star` to the lucide import, extend the union, and add the ITEM:

```tsx
import { Gauge, Radar, Waves, ScanLine, Boxes, Star, type LucideIcon } from 'lucide-react';

export type RightPanelId = 'mood' | 'signals' | 'orderflow' | 'scanner' | 'widgets' | 'watchlist';

const ITEMS: { id: RightPanelId; label: string; Icon: LucideIcon }[] = [
  { id: 'watchlist', label: 'Watchlist', Icon: Star },
  { id: 'mood', label: 'Mood', Icon: Gauge },
  { id: 'signals', label: 'Signals', Icon: Radar },
  { id: 'orderflow', label: 'Order Flow', Icon: Waves },
  { id: 'scanner', label: 'Scanner', Icon: ScanLine },
  { id: 'widgets', label: 'Widgets', Icon: Boxes },
];
```

- [ ] **Step 2: Render the panel in the page aside**

In `app/app/page.tsx`, add the import near the other right-pane imports:

```tsx
import WatchlistPanel from '@/components/WatchlistPanel';
```

Then add this block inside the `<aside>` (alongside the other `{rightPanel === '…' && …}` blocks, e.g. right before `{rightPanel === 'mood' && (`):

```tsx
            {rightPanel === 'watchlist' && (
              <WatchlistPanel
                activeSymbol={symbol}
                onSelect={(s) => { if (isCompareSymbol(s)) setSymbol(s); }}
              />
            )}
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit 2>&1 | grep -v "signals.test.ts"`
Expected: no output.

Run: `npx vitest run`
Expected: all green except the pre-existing `signals.test.ts` parse error.

- [ ] **Step 4: Live verify**

Open `/app`; click the new **Watchlist** (star) icon in the far-right dock. Confirm: a panel with a "Watchlist" header and two rows (BTCUSDT, ETHUSDT) showing Last / Chg / Chg% / Vol updating live; the currently-charted symbol's row is highlighted; green for positive change, red for negative; volume shows compact K/M. Click the ETHUSDT row → the main chart, price header, and data switch to ETH, and the ETH row becomes highlighted. Click BTCUSDT → switches back. 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add components/RightDock.tsx app/app/page.tsx
git commit -m "feat(app): mount Watchlist in the right dock (click row → switch chart)"
```

---

## Self-Review

**Spec coverage:**
- `useWatchlist` polling Binance 24hr for BTC/ETH → Task 1. ✓
- `toWatchlistRow` mapper + `fmtCompact` (always-2dp) → Task 1 + tests. ✓
- `WatchlistPanel` table (Symbol/Last/Chg/Chg%/Vol, colors, active highlight, clickable) → Task 2. ✓
- Chg/Chg% no `+` on positives → Task 2 uses plain `formatNumber` + `formatPercent({signed:false})`, asserted in tests. ✓
- Wire into RightDock + page via existing `symbol`/`setSymbol`/`isCompareSymbol` → Task 3. ✓
- Gold / new data sources out of scope → not present. ✓

**Placeholder scan:** none — all code and test bodies complete.

**Type consistency:** `WatchlistRow` shape and `fmtCompact`/`toWatchlistRow`/`useWatchlist` signatures match between Task 1 (definition) and Task 2 (use). `WatchlistPanel` prop names (`activeSymbol`, `onSelect`) match Task 3's usage. `RightPanelId` gains `'watchlist'` (Task 3) consistent with the page's `rightPanel === 'watchlist'` check. `WatchlistRowView` named export matches the test import (Task 2).
