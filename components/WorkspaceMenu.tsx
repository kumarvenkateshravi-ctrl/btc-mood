'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Layers, Save, X } from 'lucide-react';
import {
  useWorkspaces,
  saveWorkspace,
  deleteWorkspace,
  type WorkspaceConfig,
} from '@/lib/workspaces';

interface WorkspaceMenuProps {
  current: WorkspaceConfig;
  onApply: (config: WorkspaceConfig) => void;
}

export default function WorkspaceMenu({ current, onApply }: WorkspaceMenuProps) {
  const workspaces = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleSave = () => {
    saveWorkspace(name, current);
    setName('');
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <Layers className="h-3.5 w-3.5" />
        Workspaces
        {workspaces.length > 0 && (
          <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold tabular-nums text-ink">
            {workspaces.length}
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[260px] overflow-hidden rounded-lg border border-line bg-surface-1 shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/40 p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="Name this workspace…"
              className="focus-ring min-w-0 flex-1 rounded bg-base px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              onClick={handleSave}
              title="Save current layout"
              className="focus-ring inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-1 text-xs font-medium text-ink transition hover:bg-accent/25"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>

          {workspaces.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-ink-faint">
              No saved workspaces yet.
            </div>
          ) : (
            <ul className="max-h-[40vh] overflow-auto py-1">
              {workspaces.map((w) => (
                <li key={w.id} className="group flex items-center">
                  <button
                    onClick={() => {
                      onApply({
                        chartType: w.chartType,
                        symbol: w.symbol,
                        tf: w.tf,
                        indicatorIds: w.indicatorIds,
                      });
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="truncate text-[13px] font-medium text-ink">{w.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">
                      {w.symbol} · {w.tf} · {w.chartType} · {w.indicatorIds.length} ind
                    </div>
                  </button>
                  <button
                    onClick={() => deleteWorkspace(w.id)}
                    aria-label={`Delete ${w.name}`}
                    className="mr-1 shrink-0 rounded p-1 text-ink-faint opacity-0 transition hover:bg-surface-2 hover:text-bear-bright group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
