'use client';

import { ChevronDown, Plus, LayoutGrid, MoreHorizontal } from 'lucide-react';
import { formatNumber, formatPercent } from '@/lib/format';
import { useWatchlist, fmtCompact, type WatchlistRow } from '@/lib/hooks/useWatchlist';

const BADGE: Record<string, string> = {
  BTCUSDT: 'bg-[#f7a63c]', // BTC amber
  ETHUSDT: 'bg-[#6366f1]', // ETH indigo
};

export function WatchlistRowView({ row, active, onSelect }: { row: WatchlistRow; active: boolean; onSelect: (s: string) => void }) {
  const tone = row.chg >= 0 ? 'text-bull-bright' : 'text-bear-bright';
  return (
    <tr
      onClick={() => onSelect(row.symbol)}
      aria-pressed={active}
      className={['cursor-pointer transition-colors', active ? 'bg-accent/10' : 'hover:bg-surface-3'].join(' ')}
    >
      <td className="py-1.5 pl-3 pr-2">
        <span className="flex items-center gap-2 font-medium text-ink">
          <span className={['h-2.5 w-2.5 shrink-0 rounded-full', BADGE[row.symbol] ?? 'bg-ink-faint'].join(' ')} />
          {row.label}
        </span>
      </td>
      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink">{formatNumber(row.last, { precision: 2 })}</td>
      <td className={['py-1.5 px-2 text-right font-mono tabular-nums', tone].join(' ')}>{formatNumber(row.chg, { precision: 2 })}</td>
      <td className={['py-1.5 px-2 text-right font-mono tabular-nums', tone].join(' ')}>{formatPercent(row.chgPct, { signed: false })}</td>
      <td className="py-1.5 pl-2 pr-3 text-right font-mono tabular-nums text-ink-muted">{fmtCompact(row.vol)}</td>
    </tr>
  );
}

export default function WatchlistPanel({ activeSymbol, onSelect }: { activeSymbol: string; onSelect: (symbol: string) => void }) {
  const { rows, status } = useWatchlist();
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-ink">Watchlist</h2>
          <ChevronDown className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
        </div>
        <div className="flex items-center gap-2.5 text-ink-faint">
          {status !== 'live' && <span className="mr-1 text-[10px]">{status === 'loading' ? 'Loading…' : 'Offline'}</span>}
          <Plus className="h-3.5 w-3.5" aria-hidden />
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </div>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink-faint">
            <th className="py-1 pl-3 pr-2 text-left font-medium">Symbol</th>
            <th className="py-1 px-2 text-right font-medium">Last</th>
            <th className="py-1 px-2 text-right font-medium">Chg</th>
            <th className="py-1 px-2 text-right font-medium">Chg%</th>
            <th className="py-1 pl-2 pr-3 text-right font-medium">Vol</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-ink-faint">
                {status === 'error' ? 'Failed to load prices.' : 'Loading prices…'}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <WatchlistRowView key={r.symbol} row={r} active={r.symbol === activeSymbol} onSelect={onSelect} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
