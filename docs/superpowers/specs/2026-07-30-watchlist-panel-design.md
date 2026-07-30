# Watchlist panel (BTC / ETH, clickable) — design

Adds a right-pane **Watchlist** to `/app` showing live BTC and ETH ticker rows
(Symbol • Last • Chg • Chg% • Vol). Clicking a row switches the main chart's
symbol via the existing `setSymbol` path. Gold is deferred (no Binance source).

## Data

- **`lib/hooks/useWatchlist.ts`** — client-side poll of Binance
  `https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT"]`
  (URL-encoded `symbols` array → one request for all rows), every 5s via
  `setInterval`, cleared on unmount. Same direct-fetch pattern the existing
  `useMarketData` ticker uses. Returns `{ rows: WatchlistRow[]; status:
  'loading' | 'live' | 'error' }`.
- **Pure mapper `toWatchlistRow(ticker, label)`** (exported, unit-tested):
  Binance 24hr ticker JSON → `WatchlistRow`:
  ```ts
  interface WatchlistRow {
    symbol: string;   // 'BTCUSDT'
    label: string;    // 'BTCUSDT' (display)
    last: number;     // +ticker.lastPrice
    chg: number;      // +ticker.priceChange
    chgPct: number;   // +ticker.priceChangePercent
    vol: number;      // +ticker.volume (base-asset 24h volume)
  }
  ```
- **Symbol list** (module const): `[{ symbol: 'BTCUSDT', label: 'BTCUSDT' },
  { symbol: 'ETHUSDT', label: 'ETHUSDT' }]`. Adding gold later = one entry (its
  row would be non-clickable until a chart source exists).

## Formatting helpers (pure, unit-tested)

- `fmtCompact(n)` → K/M volume: 9180 → "9.18K", 6_810_000 → "6.81M", 942 → "942".
- Price/chg use the existing `formatNumber` / `formatPercent` from `lib/format`.

## UI

- **`components/WatchlistPanel.tsx`** — matches the reference image:
  - Header "Watchlist"; column header row `Symbol · Last · Chg · Chg% · Vol`.
  - One row per symbol: a small colored badge (BTC amber, ETH indigo) + the
    symbol name; right-aligned Last, Chg, Chg%, Vol (mono/tabular).
  - Chg / Chg% colored green when ≥ 0, red when < 0 (existing bull/bear tokens).
  - The row whose symbol === `activeSymbol` gets a highlighted/selected style.
  - Whole row is a `button` → `onSelect(symbol)`; keyboard-focusable.
  - Props: `{ activeSymbol: string; onSelect: (symbol: string) => void }`.
    Panel calls `useWatchlist()` internally; loading/error states render a
    small muted message.

## Wiring

- **`components/RightDock.tsx`** — add `'watchlist'` to the `RightPanelId` union
  and an `ITEMS` entry (label "Watchlist", a lucide icon, e.g. `ListChecks` or
  `Star`).
- **`app/app/page.tsx`** — render in the existing aside:
  ```tsx
  {rightPanel === 'watchlist' && (
    <WatchlistPanel
      activeSymbol={symbol}
      onSelect={(s) => { if (isCompareSymbol(s)) setSymbol(s); }}
    />
  )}
  ```
  Reuses the page's existing `symbol`/`setSymbol` + `isCompareSymbol` — no change
  to symbol fetching, history, drawings, or alerts (all already react to `symbol`).

## Testing (self-consistency)

- `fmtCompact`: 942→"942", 9180→"9.18K", 6_810_000→"6.81M", 161_590→"161.59K".
- `toWatchlistRow`: a Binance ticker fixture → correct numeric fields (string→number).
- `WatchlistPanel` render (renderToStaticMarkup): both rows present; active row
  carries the selected class; negative chg row shows the bear color; clicking is
  a `button` with the symbol. (Poll/interval is not unit-tested — verified live.)

## Out of scope

- Gold / XAU (deferred — needs a non-Binance source).
- Any new chart data source or change to `useMarketData` / `/api/klines`.
- Add/remove/reorder watchlist symbols from the UI (the "+ / ⊞ / ⋯" toolbar in
  the image is decorative for v1; the symbol list is a code constant).
