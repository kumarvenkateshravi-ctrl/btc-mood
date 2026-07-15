'use client';

import { useEffect, useRef, useState } from 'react';
import { Info, LayoutGrid, Lock } from 'lucide-react';
import type { Layout, LayoutCount, LayoutMode } from '@/lib/gridLayout';

export interface LayoutSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: Layout;
  onChange: (next: Layout) => void;
  /** Disables multi-pane thumbnails (e.g. when chartType is 'renko'). */
  multiPaneDisabled?: boolean;
  /** Title for the multi-pane-disabled tooltip. */
  multiPaneDisabledTitle?: string;
  /** Anchor element — we return focus here on close. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const POPOVER_WIDTH = 320;

interface ThumbnailDef {
  mode: LayoutMode;
  count: LayoutCount;
  label: string;
  /** Filled pattern (true = filled rect). */
  filled: boolean[];
  rows: number;
  cols: number;
  disabled?: boolean;
  disabledTitle?: string;
}

const COMING_SOON: ThumbnailDef[] = [
  { mode: 'multi-pane', count: 4, label: '8 panes (coming soon)', filled: [true, true, true, true, true, true, true, true], rows: 4, cols: 2, disabled: true, disabledTitle: 'Coming soon' },
  { mode: 'multi-pane', count: 4, label: '16 panes (coming soon)', filled: Array.from({ length: 16 }, () => true), rows: 4, cols: 4, disabled: true, disabledTitle: 'Coming soon' },
];

export function LayoutSwitcher({
  open,
  onOpenChange,
  layout,
  onChange,
  multiPaneDisabled = false,
  multiPaneDisabledTitle = 'Multi-pane is unavailable for Renko (time-less series).',
  anchorRef,
}: LayoutSwitcherProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const [hoverMode, setHoverMode] = useState<LayoutMode | null>(null);

  // Outside click + Escape close. Mousedown on the anchor button is ignored
  // — its own click handler toggles the popover, and closing here first
  // would make that toggle reopen it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef?.current?.contains(t)) return;
      if (containerRef.current && !containerRef.current.contains(t)) {
        onOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange, anchorRef]);

  // First-item focus on open; focus return on close. `wasOpen` guards the
  // return branch so mounting with open=false doesn't steal focus.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const id = requestAnimationFrame(() => firstItemRef.current?.focus());
      return () => cancelAnimationFrame(id);
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      anchorRef?.current?.focus();
    }
  }, [open, anchorRef]);

  if (!open) return null;

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const active: ThumbnailDef[] = [
    { mode: 'single', count: 1, label: 'Single chart', filled: [true], rows: 1, cols: 1 },
    { mode: 'multi-chart', count: 2, label: '2 charts side-by-side', filled: [true, true], rows: 1, cols: 2 },
    { mode: 'multi-chart', count: 4, label: '4 charts (2×2)', filled: [true, true, true, true], rows: 2, cols: 2 },
    { mode: 'multi-pane', count: 2, label: '2 panes stacked', filled: [true, true], rows: 2, cols: 1, disabled: multiPaneDisabled, disabledTitle: multiPaneDisabledTitle },
    { mode: 'multi-pane', count: 4, label: '4 panes stacked', filled: [true, true, true, true], rows: 4, cols: 1, disabled: multiPaneDisabled, disabledTitle: multiPaneDisabledTitle },
  ];

  return (
    <div
      ref={containerRef}
      id="layout-switcher-popover"
      role="dialog"
      aria-label="Layout switcher"
      className={[
        'absolute right-0 top-full z-40 mt-1 rounded-md border border-line-strong bg-surface-1 shadow-2xl',
        reduceMotion ? '' : 'settingsPopoverIn',
      ].join(' ')}
      style={{ width: POPOVER_WIDTH, animation: reduceMotion ? undefined : 'settingsPopoverIn 160ms ease-out' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <LayoutGrid className="h-3.5 w-3.5 text-ink-faint" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Layout
        </span>
      </div>

      {/* Active thumbnails */}
      <div className="px-3 pt-3 pb-1">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Choose a layout
        </p>
        <div
          role="radiogroup"
          aria-label="Layout"
          className="grid grid-cols-5 gap-2"
        >
          {active.map((t, i) => {
            const selected = layout.mode === t.mode && layout.count === t.count;
            return (
              <button
                key={`${t.mode}-${t.count}`}
                ref={i === 0 ? firstItemRef : undefined}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={t.disabled}
                title={t.disabled ? t.disabledTitle : t.label}
                onMouseEnter={() => setHoverMode(t.mode)}
                onMouseLeave={() => setHoverMode(null)}
                onClick={() => {
                  if (t.disabled) return;
                  onChange({ ...layout, mode: t.mode, count: t.count });
                  onOpenChange(false);
                }}
                className={[
                  'flex flex-col items-center gap-1 rounded p-1.5 transition',
                  t.disabled
                    ? 'cursor-not-allowed opacity-50'
                    : selected
                      ? 'bg-accent/15 ring-1 ring-accent'
                      : 'hover:bg-surface-2',
                ].join(' ')}
              >
                <ThumbnailSVG rows={t.rows} cols={t.cols} filled={t.filled} selected={selected} />
                <span className="text-[10px] font-medium leading-none text-ink-faint">{t.count === 1 ? '1' : t.count}{t.mode === 'multi-pane' ? 'p' : 'c'}</span>
              </button>
            );
          })}
        </div>
        {/* Indicator hint for multi-pane */}
        {hoverMode === 'multi-pane' && (
          <div className="mt-2 flex items-start gap-1.5 rounded bg-surface-2/50 px-2 py-1.5 text-[11px] text-ink-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Indicators live in the top pane. Lower panes are pure price action. Crosshair and time scale sync across panes automatically.
            </span>
          </div>
        )}
        {hoverMode === 'multi-chart' && (
          <div className="mt-2 flex items-start gap-1.5 rounded bg-surface-2/50 px-2 py-1.5 text-[11px] text-ink-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Each cell is an independent chart. Indicators compute per cell. Enable &quot;Sync in layout&quot; below to share crosshair and zoom.
            </span>
          </div>
        )}
        {/* Permanent indicator-in-pane-0 hint when a multi-pane layout is active */}
        {layout.mode === 'multi-pane' && (
          <div className="mt-1 flex items-start gap-1.5 rounded bg-surface-2/50 px-2 py-1.5 text-[10px] text-ink-faint">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Indicators live in the top pane.</span>
          </div>
        )}
      </div>

      {/* Sync in layout */}
      <div className="border-t border-line px-3 pt-2 pb-1">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Sync in layout
        </p>
        <ul className="space-y-0.5">
          <SyncRow
            label="Symbol"
            info="Always on in v1 (single-symbol app)."
            checked={layout.sync.symbol}
            disabled
            onChange={() => {}}
          />
          <SyncRow
            label="Interval"
            info="All cells / panes use the active timeframe."
            checked={layout.sync.interval}
            disabled
            onChange={() => {}}
          />
          <SyncRow
            label="Crosshair"
            info="Move the crosshair across all cells / panes."
            checked={layout.sync.crosshair}
            disabled={layout.mode === 'single' || layout.mode === 'multi-pane'}
            onChange={(v) => onChange({ ...layout, sync: { ...layout.sync, crosshair: v } })}
          />
          <SyncRow
            label="Time"
            info="Sync pan / zoom across all cells."
            checked={layout.sync.time}
            disabled={layout.mode === 'single' || layout.mode === 'multi-pane'}
            onChange={(v) => onChange({ ...layout, sync: { ...layout.sync, time: v } })}
          />
          <SyncRow
            label="Date range"
            info="Sync the visible date range across cells."
            checked={layout.sync.dateRange}
            disabled={layout.mode === 'single' || layout.mode === 'multi-pane'}
            onChange={(v) => onChange({ ...layout, sync: { ...layout.sync, dateRange: v } })}
          />
        </ul>
      </div>

      {/* Coming soon */}
      <div className="border-t border-line px-3 pt-2 pb-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          More layouts
        </p>
        <div className="grid grid-cols-5 gap-2 opacity-60">
          {COMING_SOON.map((t) => (
            <button
              key={`soon-${t.label}`}
              type="button"
              disabled
              title={t.disabledTitle}
              className="flex flex-col items-center gap-1 rounded p-1.5 cursor-not-allowed"
            >
              <div className="relative">
                <ThumbnailSVG rows={t.rows} cols={t.cols} filled={t.filled} selected={false} />
                <Lock className="absolute inset-0 m-auto h-3 w-3 text-ink-faint" />
              </div>
              <span className="text-[10px] font-medium leading-none text-ink-faint">
                {t.rows * t.cols}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tiny inline SVG showing a 2D grid of filled rectangles. */
function ThumbnailSVG({
  rows,
  cols,
  filled,
  selected,
}: {
  rows: number;
  cols: number;
  filled: boolean[];
  selected: boolean;
}) {
  const W = 40;
  const H = 26;
  const gap = 2;
  const cellW = (W - gap * (cols - 1)) / cols;
  const cellH = (H - gap * (rows - 1)) / rows;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      {filled.map((on, i) => {
        if (!on) return null;
        const r = Math.floor(i / cols);
        const c = i % cols;
        return (
          <rect
            key={i}
            x={c * (cellW + gap)}
            y={r * (cellH + gap)}
            width={cellW}
            height={cellH}
            rx={1.5}
            fill={selected ? 'currentColor' : '#3a4252'}
            opacity={selected ? 1 : 0.85}
          />
        );
      })}
    </svg>
  );
}

function SyncRow({
  label,
  info,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  info: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li>
      <label
        className={[
          'flex items-center gap-2 rounded px-1.5 py-1 text-[12px]',
          disabled ? 'cursor-not-allowed text-ink-faint' : 'cursor-pointer text-ink-muted hover:bg-surface-2',
        ].join(' ')}
        title={info}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3 w-3 accent-accent"
        />
        <span className="flex-1">{label}</span>
      </label>
    </li>
  );
}

/** Toolbar button that toggles the popover. */
export function LayoutSwitcherButton({
  layout,
  onClick,
  open,
  title,
  ref,
}: {
  layout: Layout;
  onClick: () => void;
  open: boolean;
  title?: string;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={title ?? 'Layout switcher'}
      aria-label={title ?? 'Layout switcher'}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="layout-switcher-popover"
      className={[
        'focus-ring inline-flex h-full px-2 items-center justify-center transition-colors',
        open || layout.mode !== 'single'
          ? 'text-accent'
          : 'text-ink-faint hover:text-ink',
      ].join(' ')}
    >
      <LayoutGrid className="h-3.5 w-3.5" />
    </button>
  );
}

// Re-export types so the toolbar file can import them here.
export type { Layout, LayoutCount, LayoutMode, LayoutSync } from '@/lib/gridLayout';
