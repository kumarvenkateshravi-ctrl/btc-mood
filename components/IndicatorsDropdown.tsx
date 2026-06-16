'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  INDICATORS_BY_CATEGORY,
  CATEGORY_LABELS,
  type IndicatorDef,
  type IndicatorCategory,
} from '@/lib/indicatorLibrary';
import type { ActiveIndicator } from '@/components/trade/IndicatorPicker';

interface IndicatorsDropdownProps {
  /** Active custom indicators (55-type catalog). */
  activeIndicators: ActiveIndicator[];
  onAdd: (def: IndicatorDef) => void;
  onToggle: (id: string) => void;
}

export default function IndicatorsDropdown(props: IndicatorsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const activeIds = useMemo(() => new Set(props.activeIndicators.map((a) => a.id)), [props.activeIndicators]);

  const filtered = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return (Object.values(INDICATORS_BY_CATEGORY).flat()).filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [search]);

  const activeCount = props.activeIndicators.filter((a) => a.visible).length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Toggle chart indicators"
        className={[
          'focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition',
          open
            ? 'border-line-strong bg-surface-3 text-ink'
            : 'border-line bg-surface-1 text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        <span>Indicators</span>
        <ChevronDown
          className="h-3 w-3 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Chart indicators"
          className="absolute right-0 top-9 z-20 min-w-[280px] max-w-[320px] overflow-hidden rounded-lg border border-line bg-surface-2 text-[12px] shadow-xl"
          style={{ animation: 'mode-fade 180ms var(--ease-quart)' }}
        >
          {/* Search bar */}
          <div className="relative border-b border-line px-2 py-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search indicators..."
              className="w-full rounded-md border border-line bg-surface-1/60 py-1.5 pl-7 pr-2 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
            />
          </div>

          {/* Category grid or search results */}
          <div className="max-h-[340px] overflow-y-auto p-2">
            {!search ? (
              /* 4-column category grid */
              <div className="grid grid-cols-1 gap-2">
                {(Object.entries(INDICATORS_BY_CATEGORY) as [IndicatorCategory, IndicatorDef[]][]).map(([cat, defs]) => (
                  <div key={cat}>
                    <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint/80">
                      {CATEGORY_LABELS[cat]}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {defs.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => props.onAdd(d)}
                            className="rounded-md px-2 py-0.5 text-[11px] transition bg-surface-1/40 text-ink-muted hover:bg-accent/10 hover:text-ink"
                          >
                            {d.label}
                          </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Search results */
              <div className="space-y-0.5">
                {filtered.length === 0 ? (
                  <p className="px-1 py-2 text-[11px] text-ink-faint">No indicators found.</p>
                ) : (
                  filtered.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => props.onAdd(d)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] transition text-ink-muted hover:bg-accent/5 hover:text-ink"
                      >
                        <div>
                          <div className="font-medium">{d.label}</div>
                          <div className="text-[10px] text-ink-faint">{d.description}</div>
                        </div>
                        <span className="ml-2 shrink-0 text-[10px] text-ink-faint">
                          + Add
                        </span>
                      </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-line bg-base/30 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-faint">
            {activeCount > 0 ? `${activeCount} active` : 'Select an indicator'}
          </div>
        </div>
      )}
    </div>
  );
}
