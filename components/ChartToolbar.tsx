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
} from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { RenkoConfig, RenkoMethod } from '@/lib/renko';


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
  priceScaleMode: ToolbarPriceScaleMode;
  onPriceScaleModeChange: (m: ToolbarPriceScaleMode) => void;
  activeIndicatorIds: string[];
  onToggleIndicator: (id: string) => void;
  onClearIndicators: () => void;
  replayActive: boolean;
  onReplayToggle: () => void;
  historyActive: boolean;
  onJumpToDate?: (ms: number) => void;
  onReturnToLive?: () => void;
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
    priceScaleMode,
    onPriceScaleModeChange,
    activeIndicatorIds,
    onToggleIndicator,
    onClearIndicators,
    replayActive,
    onReplayToggle,
    historyActive,
    onJumpToDate,
    onReturnToLive,
  } = props;

  return (
    <div className="border-b border-line bg-surface-2/60">
      {/* Row 1 — info header: symbol / price / change (left), utility actions (right) */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-ink">
            {symbol}
          </span>
          {price != null && (
            <span className="font-mono text-base tabular-nums text-ink">
              {price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          )}
          {change != null && (
            <span
              className={[
                'font-mono text-xs tabular-nums',
                change >= 0 ? 'text-bull-bright' : 'text-bear-bright',
              ].join(' ')}
            >
              {change >= 0 ? '+' : ''}
              {change.toFixed(2)}%
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-3 hover:text-ink"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <MoreMenu onFitContent={onFitContent} />
        </div>
      </div>

      {/* Row 2 — dedicated controls toolbar: TradingView-style chips with dividers */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-base/40 px-3 py-2">
        {/* Timeframe dropdown */}
        <TimeframeChip selected={selected} onSelect={onSelectTf} />

        <ToolbarDivider />

        {/* Chart type + price scale */}
        <ChartTypeChip value={chartType} onChange={onSelectType} />
        <PriceScaleChip value={priceScaleMode} onChange={onPriceScaleModeChange} />

        {/* Renko config (conditional) */}
        {chartType === 'renko' && (
          <>
            <ToolbarDivider />
            <RenkoChip renko={renko} onChange={onRenkoChange} lastPrice={price} />
          </>
        )}

        <ToolbarDivider />

        {/* Indicators dropdown */}
        <IndicatorChip
          activeIds={activeIndicatorIds}
          onToggle={onToggleIndicator}
          onClear={onClearIndicators}
        />

        <ToolbarDivider />

        {/* Replay + jump-to-date */}
        <ChipButton
          icon={<History className="h-3.5 w-3.5" />}
          label="Replay"
          active={replayActive}
          onClick={onReplayToggle}
          title="Bar Replay"
        />
        <DateChip historyActive={historyActive} onJump={onJumpToDate} onReturn={onReturnToLive} />
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="h-5 w-px shrink-0 bg-line" aria-hidden />;
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
        'focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition',
        active || open
          ? 'border-line-strong bg-surface-3 text-ink'
          : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink',
      ].join(' ')}
    >
      {icon && <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>}
      <span className="leading-none">{label}</span>
      <ChevronDown className="h-3 w-3 opacity-70" />
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
        'focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition',
        active
          ? 'border-line-strong bg-surface-3 text-ink'
          : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink',
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
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium transition',
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
  selected,
  onSelect,
}: {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Chip
        icon={<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2 1.5" /></svg>}
        label={selected}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Timeframe"
        ariaLabel="Timeframe"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={120}>
        {TIMEFRAMES.map((tf) => (
          <MenuItem key={tf} active={tf === selected} onClick={() => { onSelect(tf); setOpen(false); }}>
            <span className="font-mono">{tf}</span>
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

function PriceScaleChip({
  value,
  onChange,
}: {
  value: ToolbarPriceScaleMode;
  onChange: (v: ToolbarPriceScaleMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const LABELS: Record<ToolbarPriceScaleMode, string> = {
    normal: 'Lin',
    log: 'Log',
    percent: '%',
  };
  return (
    <div className="relative">
      <Chip
        icon={
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 13.5L4 11l3 2 3.5-3.5 4 3" />
            <path d="M14.5 2.5v8M11.5 5.5h6" />
          </svg>
        }
        label={LABELS[value]}
        open={open}
        onClick={() => setOpen((v) => !v)}
        title="Price scale"
        ariaLabel="Price scale"
      />
      <ChipMenu open={open} onClose={() => setOpen(false)} width={150}>
        <MenuItem active={value === 'normal'} onClick={() => { onChange('normal'); setOpen(false); }}>
          Lin (Linear)
        </MenuItem>
        <MenuItem active={value === 'log'} onClick={() => { onChange('log'); setOpen(false); }}>
          Log
        </MenuItem>
        <MenuItem active={value === 'percent'} onClick={() => { onChange('percent'); setOpen(false); }}>
          %
        </MenuItem>
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
        className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-3 hover:text-ink"
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
