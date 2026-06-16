'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Plus, Search, X } from 'lucide-react';
import {
  INDICATORS,
  INDICATORS_BY_CATEGORY,
  CATEGORY_LABELS,
  type IndicatorDef,
  type IndicatorCategory,
} from '@/lib/indicatorLibrary';

export interface ActiveIndicator {
  instanceId: string;
  id: string;
  params: Record<string, number>;
  visible: boolean;
  color?: string;
}

interface IndicatorPickerProps {
  active: ActiveIndicator[];
  onAdd: (def: IndicatorDef) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onParam: (id: string, key: string, value: number) => void;
  showVolume?: boolean;
  onToggleVolume?: () => void;
}

export default function IndicatorPicker({
  active,
  onAdd,
  onRemove,
  onToggle,
  onParam,
  showVolume,
  onToggleVolume,
}: IndicatorPickerProps) {
  const [search, setSearch] = useState('');
  const [openCat, setOpenCat] = useState<IndicatorCategory | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const activeIds = new Set(active.map((a) => a.id));
  const lookup = useMemo(() => new Map(INDICATORS.map((d) => [d.id, d])), []);

  const filtered = useMemo(() => {
    if (!search) return INDICATORS.filter((d) => activeIds.has(d.id)).slice(0, 30);
    const q = search.toLowerCase();
    return INDICATORS.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q),
    ).slice(0, 30);
  }, [search, activeIds]);

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between border-b border-line bg-surface-2/40 px-3.5 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Indicators
        </h2>
        <button
          onClick={() => setShowPicker((v) => !v)}
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-line bg-surface-2/40 px-2 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </header>

      <div className="p-3">
        {/* Active indicators list */}
        {active.length === 0 ? (
          <p className="text-xs text-ink-faint">No indicators added. Click Add to browse.</p>
        ) : (
          <div className="space-y-1">
            {/* Volume row — always first */}
            {onToggleVolume && (
              <div className="flex items-center justify-between rounded-md border border-line bg-surface-1/40 px-2.5 py-1.5 text-xs">
                <button
                  onClick={onToggleVolume}
                  className="focus-ring flex items-center gap-2 text-left"
                >
                  {showVolume ? (
                    <Eye className="h-3 w-3 text-ink-muted" />
                  ) : (
                    <EyeOff className="h-3 w-3 text-ink-faint" />
                  )}
                  <span className="font-medium text-ink">Volume</span>
                  <span className="text-[10px] text-ink-faint">Below chart</span>
                </button>
              </div>
            )}
            {active.map((a) => {
              const def = lookup.get(a.id);
              if (!def) return null;
              return (
                <div
                  key={a.instanceId}
                  className="flex items-center justify-between rounded-md border border-line bg-surface-1/40 px-2.5 py-1.5 text-xs"
                >
                  <button
                    onClick={() => onToggle(a.instanceId)}
                    className="focus-ring flex items-center gap-2 text-left"
                  >
                    {a.visible ? (
                      <Eye className="h-3 w-3 text-ink-muted" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-ink-faint" />
                    )}
                    <span className="font-medium text-ink">{def.label}</span>
                    <span className="text-[10px] text-ink-faint">
                      {def.params.map((pk) => `${pk.label} ${a.params[pk.key] ?? pk.default}`).join(', ')}
                    </span>
                  </button>
                  <button
                    onClick={() => onRemove(a.instanceId)}
                    className="focus-ring rounded px-1 text-ink-faint hover:text-bear-bright"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add picker */}
        {showPicker && (
          <div
            className="mt-2 rounded-lg border border-line bg-surface-2/30 p-2"
            style={{ animation: 'mode-fade 160ms var(--ease-quart)' }}
          >
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search indicators..."
                className="w-full rounded-md border border-line bg-surface-1/60 py-1 pl-7 pr-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
              />
            </div>

            {!search ? (
              <div className="space-y-0.5">
                {(Object.entries(INDICATORS_BY_CATEGORY) as [IndicatorCategory, IndicatorDef[]][]).map(([cat, defs]) => (
                  <div key={cat}>
                    <button
                      onClick={() => setOpenCat(openCat === cat ? null : cat)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint hover:bg-surface-2/50"
                    >
                      {CATEGORY_LABELS[cat]}
                      <ChevronDown
                        className={['h-3 w-3 transition', openCat === cat ? 'rotate-180' : ''].join(' ')}
                      />
                    </button>
                    {openCat === cat && (
                      <div className="space-y-0.5">
                        {defs.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => onAdd(d)}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition text-ink-muted hover:bg-accent/5 hover:text-ink"
                          >
                            <span>{d.label}</span>
                            <span className="text-[10px] text-ink-faint">
                              Add
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                {filtered.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onAdd(d)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition text-ink-muted hover:bg-accent/5 hover:text-ink"
                  >
                    <div>
                      <div className="font-medium text-ink">{d.label}</div>
                      <div className="text-[10px] text-ink-faint">{d.description}</div>
                    </div>
                    <span className="text-[10px] text-ink-faint">
                      + Add
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
