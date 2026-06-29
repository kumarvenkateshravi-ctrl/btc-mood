'use client';

// MDS Pass-3 — DataTable. The "Panel of financial information": the foundational
// table primitive every dense feature composes. Config-driven; each column's
// `cell` renderer returns a Financial Cell, preserving the layering:
//   DataTable (layout + sort + sticky) -> Financial Cells (domain) -> Num.* (format)
//
// v1 scope: sticky header, 3-state sort, alignment, row hover + click, empty state.
// v2 TODO (DESIGN.md §H): density modes, sticky first column, multi-select, keyboard
// nav, column resize, virtualization (>100 rows). All current targets are <100 rows.
//
// FROZEN v1.0 (2026-06-27, DESIGN.md §H-FREEZE): validated across all four table
// archetypes with no API change. The Column<T> API is stable — extend additively
// for v2 features; never fork or hand-roll a financial <table> in a page.

import { Fragment, useMemo, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cx } from './util';

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: keyof typeof ALIGN;
  sortable?: boolean;
  /** Comparable value used when this column is the active sort. */
  sortValue?: (row: T) => number | string;
  /** Returns this column's cell — normally a Financial Cell (a <td>). */
  cell: (row: T) => ReactNode;
  headerClassName?: string;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function DataTable<T>({ columns, rows, rowKey, onRowClick, initialSort = null, empty = 'No data', minWidth, className }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  initialSort?: SortState;
  empty?: ReactNode;
  minWidth?: number;
  className?: string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sv(a), bv = sv(b);
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null));

  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-left text-[11px]" style={minWidth ? { minWidth } : undefined}>
        <thead className="sticky top-0 z-[1] bg-surface-1 text-[9px] uppercase tracking-wider text-ink-faint">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              // aria-sort lets a screen reader announce the active sort direction.
              const ariaSort = !c.sortable ? undefined : active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
              const inner = cx('inline-flex items-center gap-0.5', c.align === 'right' && 'flex-row-reverse', c.align === 'center' && 'justify-center');
              return (
                <th key={c.key} scope="col" aria-sort={ariaSort}
                  className={cx('select-none py-1 font-medium', ALIGN[c.align ?? 'left'], c.headerClassName)}>
                  {c.sortable ? (
                    // A real <button> so the sort is keyboard-reachable (Enter/Space).
                    <button type="button" onClick={() => toggleSort(c.key)} className={cx(inner, 'focus-ring cursor-pointer uppercase tracking-wider transition-colors hover:text-ink')}>
                      {c.header}
                      {active
                        ? (sort!.dir === 'desc' ? <ChevronDown aria-hidden className="h-3 w-3 text-accent" /> : <ChevronUp aria-hidden className="h-3 w-3 text-accent" />)
                        : <ChevronsUpDown aria-hidden className="h-3 w-3 opacity-40" />}
                    </button>
                  ) : (
                    <span className={inner}>{c.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length} className="py-6 text-center text-ink-faint">{empty}</td></tr>
          ) : sorted.map((row, i) => (
            <tr key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              // Keyboard activation for clickable rows (full arrow-key nav is §H v2).
              {...(onRowClick ? { tabIndex: 0, onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); } } } : {})}
              className={cx('border-t border-line/50 hover:bg-surface-2/30', onRowClick && 'focus-ring cursor-pointer')}>
              {columns.map((c) => <Fragment key={c.key}>{c.cell(row)}</Fragment>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
