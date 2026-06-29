// MDS Pass-3 — Column Presets. Reusable column factories so pages stop repeating
// column definitions and inherit consistent defaults (alignment, sortability,
// sortValue, the right Financial Cell). A table becomes a declarative list:
//   columns = [assetColumn(...), priceColumn(...), pnlColumn(...), scoreColumn(...)]
// Layering preserved: presets -> Financial Cells -> Num.*. See DESIGN.md §H.

import type { ReactNode } from 'react';
import type { Column } from './DataTable';
import { Cell, PriceCell, PnlCell, PercentCell, QtyCell, ScoreCell, StatusCell, TimestampCell } from './cells';
import Num from './Num';

type Align = 'left' | 'right' | 'center';
interface Opt<T> { key: string; header?: ReactNode; value: (r: T) => number; sortable?: boolean; }

/** Plain text column. */
export function textColumn<T>(o: { key: string; header?: ReactNode; value: (r: T) => string; align?: Align; className?: string; sortable?: boolean }): Column<T> {
  const align = o.align ?? 'left';
  return { key: o.key, header: o.header ?? o.key, align, sortable: o.sortable, sortValue: o.sortable ? (r) => o.value(r) : undefined, cell: (r) => <Cell align={align} className={o.className}>{o.value(r)}</Cell> };
}

/** Generic number column (with optional precision + suffix like "R" or "x"). */
export function numColumn<T>(o: Opt<T> & { precision?: number; suffix?: string; align?: Align; className?: string }): Column<T> {
  const align = o.align ?? 'right';
  return { key: o.key, header: o.header ?? o.key, align, sortable: o.sortable ?? true, sortValue: (r) => o.value(r), cell: (r) => <Cell align={align} className={o.className}><Num value={o.value(r)} precision={o.precision} />{o.suffix}</Cell> };
}

/** Asset price (no currency symbol). */
export function priceColumn<T>(o: Opt<T> & { precision?: number; muted?: boolean }): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'right', sortable: o.sortable ?? true, sortValue: (r) => o.value(r), cell: (r) => <PriceCell value={o.value(r)} precision={o.precision} muted={o.muted} /> };
}

/** Profit / loss (signed + colored). */
export function pnlColumn<T>(o: Opt<T>): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'right', sortable: o.sortable ?? true, sortValue: (r) => o.value(r), cell: (r) => <PnlCell value={o.value(r)} /> };
}

/** Percentage. `plain` for magnitudes (win rate), otherwise signed + colored. */
export function percentColumn<T>(o: Opt<T> & { plain?: boolean; precision?: number }): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'right', sortable: o.sortable ?? true, sortValue: (r) => o.value(r), cell: (r) => <PercentCell value={o.value(r)} plain={o.plain} precision={o.precision} /> };
}

/** Quantity + unit. */
export function qtyColumn<T>(o: Opt<T> & { unit?: string; precision?: number }): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'right', sortable: o.sortable ?? true, sortValue: (r) => o.value(r), cell: (r) => <QtyCell value={o.value(r)} unit={o.unit} precision={o.precision} /> };
}

/** 0-100 score (circular badge by default). */
export function scoreColumn<T>(o: Opt<T> & { variant?: 'badge' | 'plain' }): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'center', sortable: o.sortable ?? true, sortValue: (r) => o.value(r), cell: (r) => <ScoreCell value={o.value(r)} variant={o.variant} /> };
}

/** Status / category -> semantic Badge. */
export function statusColumn<T>(o: { key: string; header?: ReactNode; value: (r: T) => string; sortable?: boolean }): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'center', sortable: o.sortable, sortValue: o.sortable ? (r) => o.value(r) : undefined, cell: (r) => <StatusCell value={o.value(r)} /> };
}

/** Timestamp (ms / Date). */
export function timestampColumn<T>(o: { key: string; header?: ReactNode; value: (r: T) => number | Date; format?: 'time' | 'date' | 'datetime' | 'relative'; sortable?: boolean }): Column<T> {
  return { key: o.key, header: o.header ?? o.key, align: 'left', sortable: o.sortable ?? true, sortValue: (r) => { const v = o.value(r); return v instanceof Date ? v.getTime() : v; }, cell: (r) => <TimestampCell value={o.value(r)} format={o.format ?? 'date'} /> };
}

/** Asset identity cell (icon + symbol). */
export function assetColumn<T>(o: { key?: string; header?: ReactNode; asset: (r: T) => string; symbol?: (r: T) => string }): Column<T> {
  return {
    key: o.key ?? 'asset', header: o.header ?? 'Symbol', align: 'left',
    cell: (r) => <Cell align="left"><span className="inline-flex items-center gap-1.5 font-medium"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[8px] font-bold text-ink-muted">{o.asset(r).slice(0, 1)}</span>{o.symbol ? o.symbol(r) : `${o.asset(r)}USDT`}</span></Cell>,
  };
}
