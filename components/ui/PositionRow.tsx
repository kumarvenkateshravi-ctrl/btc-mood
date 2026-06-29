// MDS Pass-3 — PositionRow. The reusable trading row, shared across Positions,
// Portfolio, Watchlist, Alerts and Journal tables. Pure composition over the
// Financial Cells (which are pure composition over Num.*):
//   PositionRow -> Financial Cells -> Num.*
// Optional columns let each table show the subset it needs (header must match).

import Num from './Num';
import { Cell, PriceCell, PnlCell, PercentCell, ScoreCell, StatusCell } from './cells';
import { cx } from './util';

export interface PositionRowData {
  asset: string;
  /** Full symbol; defaults to `${asset}USDT`. */
  symbol?: string;
  direction: string;
  entry: number;
  current: number;
  pnl: number;
  pnlPct: number;
  rr?: number;
  leverage?: number;
  holdingMin?: number;
  health?: number;
  action?: string;
}

const holding = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

export function PositionRow({ asset, symbol, direction, entry, current, pnl, pnlPct, rr, leverage, holdingMin, health, action, onClick, className }: PositionRowData & { onClick?: () => void; className?: string }) {
  return (
    <tr className={cx('border-t border-line/50 hover:bg-surface-2/30', onClick && 'cursor-pointer', className)} onClick={onClick}>
      <td className="py-2">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[8px] font-bold text-ink-muted">{asset.slice(0, 1)}</span>
          {symbol ?? `${asset}USDT`}
        </span>
      </td>
      <StatusCell value={direction} />
      <PriceCell value={entry} muted />
      <PriceCell value={current} />
      <PnlCell value={pnl} />
      <PercentCell value={pnlPct} />
      {rr != null && <Cell align="right"><Num value={rr} precision={2} />R</Cell>}
      {leverage != null && <Cell align="right" className="text-ink-muted"><Num value={leverage} />x</Cell>}
      {holdingMin != null && <Cell align="right" className="text-ink-faint">{holding(holdingMin)}</Cell>}
      {health != null && <ScoreCell value={health} />}
      {action != null && <StatusCell value={action} />}
    </tr>
  );
}
