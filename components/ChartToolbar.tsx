'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  MoreHorizontal,
  ChevronDown,
  History,
  CalendarSearch,
  X,
  CandlestickChart,
  BarChart3,
  Grid3x3,
  Check,
  LayoutGrid,
  Layers,
  Save,
  Square,
  Bitcoin,
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { RenkoConfig, RenkoMethod } from '@/lib/renko';
import { GRID_COUNTS, type GridCount } from '@/lib/gridLayout';
import {
  useWorkspaces,
  saveWorkspace,
  deleteWorkspace,
  type WorkspaceConfig,
} from '@/lib/workspaces';


export type ToolbarChartType = 'candlestick' | 'heikinAshi' | 'renko';
export type ToolbarPriceScaleMode = 'normal' | 'log' | 'percent';

export interface ChartToolbarProps {
  symbol: string;
  price: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  chartType: ToolbarChartType;
  onSelectType: (t: ToolbarChartType) => void;

  showSignals: boolean;
  onToggleSignals: () => void;

  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onFitContent: () => void;
  // Renko controls — only shown when chartType === 'renko'.
  renko: RenkoConfig;
  onRenkoChange: (c: RenkoConfig) => void;
  activeIndicatorIds: string[];
  onToggleIndicator: (id: string) => void;
  onClearIndicators: () => void;
  replayActive: boolean;
  onReplayToggle: () => void;
  historyActive: boolean;
  onJumpToDate?: (ms: number) => void;
  onReturnToLive?: () => void;
  // Grid layout controls
  gridCount: GridCount;
  onGridChange: (n: GridCount) => void;
  // Workspace controls
  workspaceCurrent: WorkspaceConfig;
  onWorkspaceApply: (cfg: WorkspaceConfig) => void;
  // Layout toggles
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function ChartToolbar(props: ChartToolbarProps) {
  const {
    symbol,
    price,
    change,
    selected,
    onSelectTf,
    chartType,
    onSelectType,

    showSignals,
    onToggleSignals,

    isFullscreen,
    onToggleFullscreen,
    onFitContent,
    renko,
    onRenkoChange,
    activeIndicatorIds,
    onToggleIndicator,
    onClearIndicators,
    replayActive,
    onReplayToggle,
    historyActive,
    onJumpToDate,
    onReturnToLive,
    gridCount,
    onGridChange,
    workspaceCurrent,
    onWorkspaceApply,
    isSidebarOpen,
    onToggleSidebar,
  } = props;

  return (
    <div className="flex h-[40px] w-full shrink-0 flex-nowrap items-center gap-0.5 overflow-visible border-b border-line bg-base px-2">
      {/* App Logo */}
      <div className="flex shrink-0 items-center justify-center px-1 pr-3">
        <Bitcoin className="h-5 w-5 text-regime-hot" />
      </div>

      <ToolbarDivider />

      {/* Symbol / price / change */}
      <div className="flex shrink-0 items-center gap-2 px-2">
        <span className="text-[14px] font-semibold tracking-tight text-ink">
          {symbol}
        </span>
        {price != null && (
          <span className="font-mono text-[14px] tabular-nums text-ink">
            {price.toLocaleString('en-US', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </span>
        )}
        {change != null && (
          <span
            className={[
              'font-mono text-[12px] tabular-nums',
              change >= 0 ? 'text-bull-bright' : 'text-bear-bright',
            ].join(' ')}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)}%
          </span>
        )}
      </div>

      <ToolbarDivider />

      {/* Timeframes Quick-Row */}
      <div className="flex shrink-0 items-center h-full">
        <TimeframeChip value={selected} onChange={onSelectTf} />
      </div>

      <ToolbarDivider />

      {/* Chart type */}
      <div className="flex shrink-0 items-center h-full">
        <ChartTypeChip value={chartType} onChange={onSelectType} />
      </div>

      {/* Renko config (conditional) */}
      {chartType === 'renko' && (
        <>
          <ToolbarDivider />
          <div className="flex shrink-0 items-center h-full">
            <RenkoChip renko={renko} onChange={onRenkoChange} lastPrice={price} />
          </div>
        </>
      )}

      <ToolbarDivider />

      {/* Indicators dropdown */}
      <div className="flex shrink-0 items-center h-full">
        <IndicatorChip
          activeIds={activeIndicatorIds}
          onToggle={onToggleIndicator}
          onClear={onClearIndicators}
        />
      </div>

      <ToolbarDivider />

      {/* Replay + jump-to-date */}
      <div className="flex shrink-0 items-center h-full">
        <ChipButton
          icon={<History className="h-3.5 w-3.5" />}
          label="Replay"
          active={replayActive}
          onClick={onReplayToggle}
          title="Bar Replay"
        />
        <DateChip historyActive={historyActive} onJump={onJumpToDate} onReturn={onReturnToLive} />
      </div>

      <ToolbarDivider />

      {/* Grid layout chip */}
      <div className="flex shrink-0 items-center h-full">
        <GridChip value={gridCount} onChange={onGridChange} />
      </div>

      {/* Workspace chip */}
      <div className="flex shrink-0 items-center h-full">
        <WorkspaceChip current={workspaceCurrent} onApply={onWorkspaceApply} />
      </div>

      {/* Spacer pushes fullscreen + more to the right */}
      <div className="ml-auto flex shrink-0 items-center h-full px-1">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={isSidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
            className="focus-ring inline-flex h-full px-2 items-center justify-center text-ink-faint transition hover:text-ink hidden xl:inline-flex"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isSidebarOpen ? (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                  <path d="m10 15-3-3 3-3" />
                </>
              ) : (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                  <path d="m8 9 3 3-3 3" />
                </>
              )}
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
          className="focus-ring inline-flex h-full px-2 items-center justify-center text-ink-faint transition hover:text-ink"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
        <MoreMenu onFitContent={onFitContent} />
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-[20px] w-px shrink-0 bg-line" aria-hidden />;
}

/** TradingView-style toolbar control: icon + label + caret, on a raised chip. */
function Chip({
  icon,
  label,
  active = false,
  open = false,
  onClick,
  title,
  ariaLabel,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  open?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-haspopup={onClick ? 'menu' : undefined}
      aria-expanded={open}
      className={[
        'focus-ring inline-flex h-full items-center gap-1.5 px-2 text-[13px] font-medium transition-colors',
        active || open
          ? 'text-accent'
          : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
      <span className="leading-none">{label}</span>
      <ChevronDown className="ml-0.5 h-3 w-3 opacity-70" />
    </button>
  );
}

/** Simple chip with no caret — for non-dropdown actions. */
function ChipButton({
  icon,
  label,
  active = false,
  onClick,
  title,
  ariaLabel,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
      className={[
        'focus-ring inline-flex h-full items-center gap-1.5 px-2 text-[13px] font-medium transition-colors',
        active
          ? 'text-accent'
          : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
      <span className="leading-none">{label}</span>
    </button>
  );
}

/** Popover menu anchored to a chip. Closes on outside click / Escape. */
function ChipMenu({
  open,
  onClose,
  children,
  width = 220,
  align = 'left',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      style={{ width, [align]: 0 } as React.CSSProperties}
      className={[
        'absolute top-full z-40 mt-1.5 rounded-md border border-line-strong bg-surface-1 py-1 shadow-2xl',
        align === 'right' ? 'right-0' : 'left-0',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  active = false,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium transition',
        active
          ? 'bg-accent/15 text-ink'
          : disabled
            ? 'text-ink-faint/60'
            : danger
              ? 'text-bear-bright hover:bg-surface-2'
              : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      ].join(' ')}
    >
      <span className="flex-1">{children}</span>
      {active && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-line" aria-hidden />;
}

function TimeframeChip({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (t: Timeframe) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Timeframe"
        aria-label="Timeframe"
        aria-expanded={open}
        className={[
          'focus-ring inline-flex h-[24px] items-center justify-center px-1.5 text-[14px] font-medium transition-colors rounded hover:bg-surface-2',
          open ? 'text-accent bg-surface-2' : 'text-ink hover:text-ink',
        ].join(' ')}
      >
        <span className="leading-none">{value}</span>
      </button>
      <ChipMenu open={open} onClose={() => setOpen(false)} width={120}>
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Timeframe
        </div>
        {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
          <MenuItem
            key={tf}
            active={value === tf}
            onClick={() => {
              onChange(tf as Timeframe);
              setOpen(false);
            }}
          >
            {tf}
          </MenuItem>
        ))}
      </ChipMenu>
    </div>
  );
}


function ChartTypeChip({
  value,
  onChange,
}: {
  value: ToolbarChartType;
  onChange: (v: ToolbarChartType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ICONS: Record<ToolbarChartType, React.ReactNode> = {
    candlestick: <CandlestickChart className="h-3.5 w-3.5" />,
    heikinAshi: <BarChart3 className="h-3.5 w-3.5" />,
    renko: <Grid3x3 className="h-3.5 w-3.5" />,
  };
  const LABELS: Record<ToolbarChartType, string> = {
    candlestick: 'Candles',
    heikinAshi: 'Heikin Ashi',
    renko: 'Renko',
  };
  return (
    <div className="relative">
      <Chip
        icon={ICONS[value]}
        label={LABELS[value]}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Chart type"
        ariaLabel="Chart type"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={180}>
        <MenuItem active={value === 'candlestick'} onClick={() => { onChange('candlestick'); setOpen(false); }}>
          <span className="inline-flex items-center gap-2">
            <CandlestickChart className="h-3.5 w-3.5" /> Candles
          </span>
        </MenuItem>
        <MenuItem active={value === 'heikinAshi'} onClick={() => { onChange('heikinAshi'); setOpen(false); }}>
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5" /> Heikin Ashi
          </span>
        </MenuItem>
        <MenuItem active={value === 'renko'} onClick={() => { onChange('renko'); setOpen(false); }}>
          <span className="inline-flex items-center gap-2">
            <Grid3x3 className="h-3.5 w-3.5" /> Renko
          </span>
        </MenuItem>
      </ChipMenu>
    </div>
  );
}

function DateChip({
  historyActive,
  onJump,
  onReturn,
}: {
  historyActive: boolean;
  onJump?: (ms: number) => void;
  onReturn?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="relative">
      <Chip
        icon={<CalendarSearch className="h-3.5 w-3.5" />}
        label="Date"
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Jump to date"
        ariaLabel="Jump to date"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={210} align="right">
        <div className="px-3 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Jump to date
          </div>
          <input
            type="date"
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || !onJump) return;
              const ms = new Date(`${v}T00:00:00Z`).getTime();
              if (Number.isFinite(ms)) {
                onJump(ms);
                setOpen(false);
              }
            }}
            className="w-full rounded border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none [color-scheme:dark] focus:border-line-strong"
            aria-label="Jump to date"
          />
        </div>
        {historyActive && (
          <>
            <MenuDivider />
            <MenuItem
              onClick={() => {
                onReturn?.();
                setOpen(false);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <X className="h-3.5 w-3.5" /> Return to latest
              </span>
            </MenuItem>
          </>
        )}
      </ChipMenu>
    </div>
  );
}



function RenkoChip({
  renko,
  onChange,
  lastPrice,
}: {
  renko: RenkoConfig;
  onChange: (c: RenkoConfig) => void;
  lastPrice: number | null;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<RenkoConfig>) => onChange({ ...renko, ...patch });
  const METHOD_LABELS: Record<RenkoMethod, string> = {
    traditional: 'Trad',
    atr: 'ATR',
    percentage: '%',
  };
  return (
    <div className="relative">
      <Chip
        icon={<Grid3x3 className="h-3.5 w-3.5" />}
        label={`Renko · ${METHOD_LABELS[renko.method]}`}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Renko box size"
        ariaLabel="Renko box size"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={210} align="right">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Box size method
        </div>
        <MenuItem active={renko.method === 'traditional'} onClick={() => set({ method: 'traditional' })}>
          Traditional (fixed)
        </MenuItem>
        <MenuItem active={renko.method === 'atr'} onClick={() => set({ method: 'atr' })}>
          ATR
        </MenuItem>
        <MenuItem active={renko.method === 'percentage'} onClick={() => set({ method: 'percentage' })}>
          Percentage
        </MenuItem>
        <MenuDivider />
        {renko.method === 'traditional' && (
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              Box size
              <input
                type="number"
                min={0}
                step="any"
                value={renko.boxSize ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') return set({ boxSize: null });
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) set({ boxSize: n });
                }}
                className="ml-auto w-20 rounded border border-line bg-base px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-line-strong"
              />
            </label>
          </div>
        )}
        {renko.method === 'atr' && (
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              ATR length
              <input
                type="number"
                min={1}
                step={1}
                value={renko.atrLength}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 1) set({ atrLength: Math.round(n) });
                }}
                className="ml-auto w-20 rounded border border-line bg-base px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-line-strong"
              />
            </label>
          </div>
        )}
        {renko.method === 'percentage' && (
          <div className="px-3 py-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              Percent
              <input
                type="number"
                min={0}
                step="any"
                value={renko.percentage}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) set({ percentage: n });
                }}
                className="ml-auto w-20 rounded border border-line bg-base px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-line-strong"
              />
            </label>
          </div>
        )}
      </ChipMenu>
    </div>
  );
}

function MoreMenu({ onFitContent }: { onFitContent: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex h-full px-2 items-center justify-center text-ink-faint transition hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <ul className="absolute right-0 top-full z-30 mt-1 min-w-[120px] rounded-lg border border-line bg-surface-1 py-1 shadow-2xl">
          <li>
            <button
              onClick={() => {
                onFitContent();
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink"
            >
              Fit Content
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/** Grid layout chip — icon only, opens a dropdown with 1/2/4/6 selector. */
function GridChip({
  value,
  onChange,
}: {
  value: GridCount;
  onChange: (n: GridCount) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Grid layout"
        aria-label="Grid layout"
        aria-expanded={open}
        className={[
          'focus-ring inline-flex h-full px-2 items-center justify-center transition-colors',
          open || value > 1
            ? 'text-accent'
            : 'text-ink-faint hover:text-ink',
        ].join(' ')}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1.5 w-[200px] overflow-hidden rounded-lg border border-line-strong bg-surface-1 shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Layout</p>
          </div>
          <div className="p-3">
            {/* Single chart shortcut */}
            <button
              type="button"
              onClick={() => { onChange(1); setOpen(false); }}
              aria-pressed={value === 1}
              title="Single chart"
              className={[
                'focus-ring mb-2 inline-flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-medium transition',
                value === 1
                  ? 'border-line-strong bg-surface-3 text-ink'
                  : 'border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:bg-surface-3 hover:text-ink',
              ].join(' ')}
            >
              <Square className="h-3.5 w-3.5" />
              Single chart
            </button>
            {/* Grid count selector */}
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Multi-chart grid</p>
            <div
              role="radiogroup"
              aria-label="Number of charts"
              className="inline-flex w-full items-center rounded-md border border-line bg-surface-2 p-0.5 font-mono text-[12px]"
            >
              {GRID_COUNTS.filter((n) => n > 1).map((n) => {
                const active = n === value;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => { onChange(n); setOpen(false); }}
                    className={[
                      'focus-ring min-w-0 flex-1 rounded px-2 py-1.5 transition',
                      active
                        ? 'bg-surface-3 text-ink'
                        : 'text-ink-faint hover:bg-surface-2 hover:text-ink',
                    ].join(' ')}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Workspace chip — icon only, opens a dropdown to save/restore/delete workspaces. */
function WorkspaceChip({
  current,
  onApply,
}: {
  current: WorkspaceConfig;
  onApply: (cfg: WorkspaceConfig) => void;
}) {
  const workspaces = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSave = () => {
    if (!name.trim()) return;
    saveWorkspace(name.trim(), current);
    setName('');
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Workspaces"
        aria-label="Workspaces"
        aria-expanded={open}
        className={[
          'focus-ring relative inline-flex h-full px-2 items-center justify-center transition-colors',
          open
            ? 'text-accent'
            : 'text-ink-faint hover:text-ink',
        ].join(' ')}
      >
        <Layers className="h-3.5 w-3.5" />
        {workspaces.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-white">
            {workspaces.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[270px] overflow-hidden rounded-lg border border-line-strong bg-surface-1 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/40 px-3 py-2">
            <Layers className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            <span className="text-[11px] font-semibold text-ink">Workspaces</span>
          </div>
          {/* Save row */}
          <div className="flex items-center gap-1.5 border-b border-line p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="Name this workspace…"
              className="focus-ring min-w-0 flex-1 rounded bg-base px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              onClick={handleSave}
              title="Save current layout"
              disabled={!name.trim()}
              className="focus-ring inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-1 text-xs font-medium text-ink transition hover:bg-accent/25 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
          {/* List */}
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
                      onApply({ chartType: w.chartType, symbol: w.symbol, tf: w.tf, indicatorIds: w.indicatorIds });
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

export function IndicatorChip({
  activeIds,
  onToggle,
  onClear,
}: {
  activeIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = activeIds.length;
  const label = count > 0 ? `Indicators · ${count}` : 'Indicators';

  return (
    <div className="relative">
      <Chip
        icon={
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 12L5 8l3 3 6.5-7" />
            <path d="M1.5 14h13" />
          </svg>
        }
        label={label}
        active={count > 0}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Indicators"
        ariaLabel="Indicators"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={260}>
        <div className="max-h-[60vh] overflow-auto">
          {CUSTOM_INDICATORS.map((ind) => (
            <MenuItem
              key={ind.id}
              active={activeIds.includes(ind.id)}
              onClick={() => onToggle(ind.id)}
            >
              {ind.name}
            </MenuItem>
          ))}
        </div>
        {count > 0 && (
          <>
            <MenuDivider />
            <MenuItem danger onClick={() => { onClear(); setOpen(false); }}>
              Clear all ({count})
            </MenuItem>
          </>
        )}
      </ChipMenu>
    </div>
  );
}
