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
