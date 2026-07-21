'use client';

import { Fragment, useMemo, useState, useRef, useEffect, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, isValidElement, cloneElement } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Filter, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cx } from './util';
import { useDensity } from '@/lib/hooks/useDensity';

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: keyof typeof ALIGN;
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  filterValue?: (row: T) => string;
  value?: (row: T) => any;
  cell: (row: T) => ReactNode;
  headerClassName?: string;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

function TickCell({ value, children, className }: { value: any; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (value !== prev.current) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 300);
      return () => clearTimeout(t);
    }
  }, [value]);

  const cls = cx(className, flash && 'animate-[tick-flash_0.3s_ease-out]');
  
  const isTd = isValidElement(children) && (
    children.type === 'td' || 
    (typeof children.type === 'function' && (children.type as any).isTableCell)
  );

  if (isTd) {
    return cloneElement(children as React.ReactElement<{ className?: string }>, {
      className: cx((children.props as any).className, cls)
    });
  }

  return (
    <td className={cls}>
      {children}
    </td>
  );
}

export function DataTable<T>({ 
  columns, 
  rows, 
  rowKey, 
  onRowClick, 
  initialSort = null, 
  empty = 'No data', 
  minWidth, 
  className, 
  density: overrideDensity, 
  stickyFirstColumn = false, 
  virtualize = false,
  enableSelection = false,
  selectedKeys = new Set(),
  onSelectionChange,
  onColumnResize
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  initialSort?: SortState;
  empty?: ReactNode;
  minWidth?: number;
  className?: string;
  density?: 'comfortable' | 'standard' | 'compact';
  stickyFirstColumn?: boolean;
  virtualize?: boolean;
  enableSelection?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  onColumnResize?: (widths: Record<string, number>) => void;
}) {
  const { mode } = useDensity();
  const density = overrideDensity ?? mode;

  const [sort, setSort] = useState<SortState>(initialSort);
  const [activeRowIdx, setActiveRowIdx] = useState<number>(-1);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectedIdx = useRef<number>(-1);

  // Filter & Sort
  const sorted = useMemo(() => {
    let result = rows;
    
    // 1. Filter
    const activeFilterKeys = Object.keys(filters).filter(k => filters[k].trim() !== '');
    if (activeFilterKeys.length > 0) {
      result = result.filter(r => {
        return activeFilterKeys.every(fk => {
          const col = columns.find(c => c.key === fk);
          if (!col || !col.filterValue) return true;
          const val = col.filterValue(r).toLowerCase();
          const query = filters[fk].trim().toLowerCase();
          return val.includes(query);
        });
      });
    }

    // 2. Sort
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        const sv = col.sortValue;
        const dir = sort.dir === 'asc' ? 1 : -1;
        result = [...result].sort((a, b) => {
          const av = sv(a), bv = sv(b);
          return av < bv ? -dir : av > bv ? dir : 0;
        });
      }
    }
    return result;
  }, [rows, sort, columns, filters]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null));

  const rowHeight = density === 'comfortable' ? 40 : density === 'compact' ? 28 : 32;

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    enabled: virtualize,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]?.start || 0 : 0;
  const paddingBottom = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end || 0)
    : 0;

  // Keyboard
  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (sorted.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveRowIdx((prev) => Math.min(prev + 1, sorted.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveRowIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveRowIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveRowIdx(sorted.length - 1);
    } else if (e.key === ' ' && enableSelection && activeRowIdx >= 0) {
      e.preventDefault();
      toggleRowSelection(activeRowIdx, false, false);
    } else if (e.key === 'Enter' && activeRowIdx >= 0 && onRowClick) {
      e.preventDefault();
      onRowClick(sorted[activeRowIdx]);
    }
  };

  useEffect(() => {
    if (virtualize && activeRowIdx >= 0) {
      rowVirtualizer.scrollToIndex(activeRowIdx, { align: 'auto' });
    }
  }, [activeRowIdx, virtualize, rowVirtualizer]);

  // Selection
  const toggleRowSelection = (idx: number, shift: boolean, ctrl: boolean) => {
    if (!onSelectionChange) return;
    const key = rowKey(sorted[idx], idx);
    const newSet = new Set(selectedKeys);
    
    if (shift && lastSelectedIdx.current >= 0) {
      const start = Math.min(lastSelectedIdx.current, idx);
      const end = Math.max(lastSelectedIdx.current, idx);
      for (let i = start; i <= end; i++) {
        newSet.add(rowKey(sorted[i], i));
      }
    } else {
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      lastSelectedIdx.current = idx;
    }
    onSelectionChange(newSet);
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (selectedKeys.size === sorted.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(sorted.map((r, i) => rowKey(r, i))));
    }
  };

  // Resize logic
  const handleResizeStart = (e: React.PointerEvent, colKey: string) => {
    e.preventDefault();
    const startX = e.pageX;
    const startWidth = colWidths[colKey] || (e.target as HTMLElement).parentElement?.offsetWidth || 100;
    
    const onMove = (me: PointerEvent) => {
      const newWidth = Math.max(64, startWidth + (me.pageX - startX));
      setColWidths(prev => ({ ...prev, [colKey]: newWidth }));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (onColumnResize) {
        setColWidths(prev => {
          onColumnResize(prev);
          return prev;
        });
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Filter Chips above table */}
      {Object.keys(filters).some(k => filters[k]) && (
        <div className="flex flex-wrap gap-2 p-2 border-b border-line bg-surface-1">
          {Object.entries(filters).map(([k, v]) => {
            if (!v) return null;
            const col = columns.find(c => c.key === k);
            return (
              <span key={k} className="inline-flex items-center gap-1 text-[10px] font-medium bg-surface-2 border border-line rounded px-1.5 py-0.5 text-ink-muted">
                {col?.header}: <span className="text-ink">{v}</span>
                <button onClick={() => setFilters(f => ({ ...f, [k]: '' }))} className="focus-ring hover:text-bear transition-colors ml-1">
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Action Bar (Sticky Top) */}
      {enableSelection && selectedKeys.size > 0 && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 bg-surface-2 border-b border-accent px-4 py-2 text-xs shadow-md">
          <span className="font-semibold text-accent">{selectedKeys.size} selected</span>
          <button onClick={() => onSelectionChange?.(new Set())} className="focus-ring text-ink-faint hover:text-ink transition-colors">Clear</button>
          <div className="ml-auto">
            {/* Consumer can render bulk actions via composition if needed, but keeping it generic for now */}
          </div>
        </div>
      )}

      <div 
        ref={containerRef} 
        className={cx('overflow-x-auto overflow-y-auto max-h-full outline-none flex-1', className)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (activeRowIdx === -1 && sorted.length > 0) setActiveRowIdx(0); }}
      >
        <table className="w-full text-left text-[11px] relative table-fixed" style={minWidth ? { minWidth } : undefined}>
          <thead className="sticky top-0 z-[1] bg-surface-1 text-[9px] uppercase tracking-wider text-ink-faint shadow-[0_1px_0_0_var(--line)]">
            <tr>
              {enableSelection && (
                <th scope="col" className="w-10 px-3 py-2 sticky left-0 bg-surface-1 z-10 shadow-[1px_0_0_0_var(--line)]">
                  <input type="checkbox" className="focus-ring cursor-pointer" 
                    checked={sorted.length > 0 && selectedKeys.size === sorted.length}
                    ref={el => { if (el) el.indeterminate = selectedKeys.size > 0 && selectedKeys.size < sorted.length; }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c, idx) => {
                const active = sort?.key === c.key;
                const ariaSort = !c.sortable ? undefined : active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                const isStickyFirst = stickyFirstColumn && (!enableSelection && idx === 0);
                
                return (
                  <th key={c.key} scope="col" aria-sort={ariaSort}
                    className={cx(
                      'select-none py-2 font-medium relative group', 
                      ALIGN[c.align ?? 'left'], 
                      c.headerClassName,
                      isStickyFirst && 'sticky left-0 bg-surface-1 z-10 shadow-[1px_0_0_0_var(--line)]'
                    )}
                    style={{ width: colWidths[c.key] }}
                  >
                    <div className={cx('inline-flex items-center gap-1', c.align === 'right' && 'flex-row-reverse', c.align === 'center' && 'justify-center')}>
                      {activeFilterCol === c.key ? (
                        <div className="flex items-center bg-surface-2 rounded px-1 outline outline-1 outline-accent">
                          <input 
                            autoFocus
                            value={filters[c.key] || ''}
                            onChange={(e) => setFilters(f => ({ ...f, [c.key]: e.target.value }))}
                            onBlur={() => setActiveFilterCol(null)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setActiveFilterCol(null); }}
                            className="bg-transparent w-20 text-[10px] text-ink outline-none"
                            placeholder="Filter..."
                          />
                        </div>
                      ) : c.sortable ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className="focus-ring cursor-pointer uppercase tracking-wider transition-colors hover:text-ink inline-flex items-center gap-0.5">
                          {c.header}
                          {active
                            ? (sort!.dir === 'desc' ? <ChevronDown aria-hidden className="h-3 w-3 text-accent" /> : <ChevronUp aria-hidden className="h-3 w-3 text-accent" />)
                            : <ChevronsUpDown aria-hidden className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        <span>{c.header}</span>
                      )}
                      
                      {c.filterValue && activeFilterCol !== c.key && (
                        <button onClick={() => setActiveFilterCol(c.key)} className="focus-ring opacity-0 group-hover:opacity-100 transition-opacity hover:text-accent ml-1">
                          <Filter className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Resizer Handle */}
                    <div 
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/30 active:bg-accent z-20"
                      onPointerDown={(e) => handleResizeStart(e, c.key)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length + (enableSelection ? 1 : 0)} className="py-6 text-center text-ink-faint">{empty}</td></tr>
            ) : (
              <>
                {paddingTop > 0 && <tr><td colSpan={columns.length + (enableSelection ? 1 : 0)} style={{ height: `${paddingTop}px` }} /></tr>}
                {(virtualize ? virtualItems.map(v => ({ row: sorted[v.index], idx: v.index })) : sorted.map((row, idx) => ({ row, idx }))).map(({ row, idx }) => {
                  const isActive = activeRowIdx === idx;
                  const isSelected = selectedKeys.has(rowKey(row, idx));
                  
                  return (
                    <tr key={rowKey(row, idx)}
                      onClick={(e) => {
                        setActiveRowIdx(idx);
                        if (enableSelection && e.target instanceof HTMLInputElement && e.target.type === 'checkbox') {
                          // Handled by onChange
                        } else if (enableSelection && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                          toggleRowSelection(idx, e.shiftKey, e.metaKey || e.ctrlKey);
                        } else if (onRowClick) {
                          onRowClick(row);
                        }
                      }}
                      className={cx(
                        'border-t border-line/50 transition-colors',
                        density === 'comfortable' ? 'h-[40px]' : density === 'compact' ? 'h-[28px]' : 'h-[32px]',
                        (onRowClick || enableSelection) && 'cursor-pointer',
                        isSelected ? 'bg-surface-2/70' : 'hover:bg-surface-2/30',
                        isActive && 'outline outline-1 outline-accent/50 z-10 relative'
                      )}>
                      
                      {enableSelection && (
                        <td className="w-10 px-3 sticky left-0 bg-base z-10 shadow-[1px_0_0_0_var(--line)] group-hover:bg-surface-2/30">
                          <input type="checkbox" className="focus-ring cursor-pointer" 
                            checked={isSelected}
                            onChange={(e) => {
                              // Native onChange event object doesn't have shiftKey reliably in React for click emulation,
                              // but we handle Shift-click in the tr onClick above.
                              const nativeEvent = e.nativeEvent as any;
                              toggleRowSelection(idx, nativeEvent.shiftKey, nativeEvent.metaKey || nativeEvent.ctrlKey);
                            }}
                          />
                        </td>
                      )}

                      {columns.map((c, cIdx) => {
                        const isStickyFirst = stickyFirstColumn && (!enableSelection && cIdx === 0);
                        const cellProps = {
                          key: c.key,
                          className: cx(
                            ALIGN[c.align ?? 'left'],
                            isStickyFirst && 'sticky left-0 bg-base z-10 shadow-[1px_0_0_0_var(--line)] group-hover:bg-surface-2/30'
                          )
                        };

                        if (c.value) {
                          return (
                            <TickCell key={c.key} value={c.value(row)} className={cellProps.className}>
                              {/* We still have the problem that c.cell(row) might be a <td> */}
                              {c.cell(row)}
                            </TickCell>
                          );
                        }

                        const cellContent = c.cell(row);
                        const isTd = isValidElement(cellContent) && (
                          cellContent.type === 'td' || 
                          (typeof cellContent.type === 'function' && (cellContent.type as any).isTableCell)
                        );

                        if (isTd) {
                          return cloneElement(cellContent as React.ReactElement<{ className?: string }>, {
                            key: c.key,
                            className: cx((cellContent.props as any).className, cellProps.className),
                          });
                        }

                        return (
                          <td key={c.key} className={cellProps.className}>
                            {cellContent}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {paddingBottom > 0 && <tr><td colSpan={columns.length + (enableSelection ? 1 : 0)} style={{ height: `${paddingBottom}px` }} /></tr>}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
