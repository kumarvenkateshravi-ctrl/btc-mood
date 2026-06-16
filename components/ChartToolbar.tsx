'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, MoreHorizontal } from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import IndicatorsDropdown from './IndicatorsDropdown';
import type { IndicatorDef } from '@/lib/indicatorLibrary';
import type { ActiveIndicator } from '@/components/trade/IndicatorPicker';

export type ToolbarChartType = 'candlestick' | 'heikinAshi' | 'renko';

export interface ChartToolbarProps {
  symbol: string;
  price: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  chartType: ToolbarChartType;
  onSelectType: (t: ToolbarChartType) => void;
  indicators: { ema9: boolean; ema21: boolean };
  onToggleIndicator: (key: 'ema9' | 'ema21') => void;
  /** Casual view hides the EMA pills and the indicators menu section. */
  hideIndicators?: boolean;
  showSignals: boolean;
  onToggleSignals: () => void;
  lastEma9: number | null;
  lastEma21: number | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onFitContent: () => void;
  // Renko controls — only shown when chartType === 'renko'.
  brickSize: number | null;
  autoBrick: boolean;
  onBrickSizeChange: (n: number | null) => void;
  onAutoBrickChange: (v: boolean) => void;
  /** Custom indicator system (55-type catalog). */
  activeIndicators: ActiveIndicator[];
  onAddIndicator: (def: IndicatorDef) => void;
  onToggleIndicatorFull: (id: string) => void;
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
    indicators,
    onToggleIndicator,
    hideIndicators = false,
    showSignals,
    onToggleSignals,
    lastEma9,
    lastEma21,
    isFullscreen,
    onToggleFullscreen,
    onFitContent,
    brickSize,
    autoBrick,
    onBrickSizeChange,
    onAutoBrickChange,
    activeIndicators,
    onAddIndicator,
    onToggleIndicatorFull,
  } = props;

  return (
    <div className="flex flex-col gap-2 border-b border-line bg-surface-2/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: symbol + price + change. The status pill lives in the
          page-level top bar so the toolbar's first row doesn't collide
          with it on narrow widths. */}
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

      {/* Right: TF segmented + chart-type + (renko brick) + indicators + fullscreen + more */}
      <div className="flex flex-wrap items-center gap-2">
        <TimeframeSegmented selected={selected} onSelect={onSelectTf} />

        <ChartTypeSelect value={chartType} onChange={onSelectType} />

        {chartType === 'renko' && (
          <BrickSizeControl
            brickSize={brickSize}
            autoBrick={autoBrick}
            onBrickSizeChange={onBrickSizeChange}
            onAutoBrickChange={onAutoBrickChange}
            lastPrice={price}
          />
        )}

        {/* Indicators dropdown — replaces the EMA + Signals pills. The
            OHLCLegend below the toolbar still surfaces EMA 9 / EMA 21
            values on hover, so the live readouts are not lost. Hidden
            on narrow viewports and in Casual mode (the calmest chart
            surface by design). */}
        {!hideIndicators && (
          <div className="hidden sm:block">
            <IndicatorsDropdown
              activeIndicators={activeIndicators}
              onAdd={onAddIndicator}
              onToggle={onToggleIndicatorFull}
            />
          </div>
        )}

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
  );
}

function TimeframeSegmented({
  selected,
  onSelect,
}: {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Timeframe"
      className="inline-flex items-center rounded-md border border-line bg-base p-0.5 text-[11px] font-mono"
    >
      {TIMEFRAMES.map((tf) => {
        const active = tf === selected;
        return (
          <button
            key={tf}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tf)}
            className={[
              'min-w-[34px] rounded px-2 py-1 transition focus-ring',
              active
                ? 'bg-surface-3 text-ink'
                : 'text-ink-faint hover:bg-surface-1/60 hover:text-ink',
            ].join(' ')}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}

function ChartTypeSelect({
  value,
  onChange,
}: {
  value: ToolbarChartType;
  onChange: (v: ToolbarChartType) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-base p-0.5 text-[11px] font-medium">
      {(
        [
          { v: 'candlestick', l: 'Candles' },
          { v: 'heikinAshi', l: 'Heikin Ashi' },
          { v: 'renko', l: 'Renko' },
        ] as const
      ).map((opt) => {
        const active = opt.v === value;
        return (
          <button
            key={opt.v}
            onClick={() => onChange(opt.v)}
            aria-pressed={active}
            className={[
              'rounded px-2 py-1 transition focus-ring',
              active
                ? 'bg-surface-3 text-ink'
                : 'text-ink-faint hover:bg-surface-1/60 hover:text-ink',
            ].join(' ')}
          >
            {opt.l}
          </button>
        );
      })}
    </div>
  );
}

function BrickSizeControl({
  brickSize,
  autoBrick,
  onBrickSizeChange,
  onAutoBrickChange,
  lastPrice,
}: {
  brickSize: number | null;
  autoBrick: boolean;
  onBrickSizeChange: (n: number | null) => void;
  onAutoBrickChange: (v: boolean) => void;
  lastPrice: number | null;
}) {
  // Quick-pick presets relative to the current price (≈ 0.05% / 0.1% /
  // 0.25% / 0.5% / 1%). Round to sensible precision per magnitude.
  const presets = useMemo(() => {
    if (lastPrice == null || !Number.isFinite(lastPrice)) return [];
    const pctOf = (pct: number) => {
      const raw = lastPrice * pct;
      if (raw >= 100) return Math.round(raw);
      if (raw >= 1) return Math.round(raw * 10) / 10;
      if (raw >= 0.01) return Math.round(raw * 100) / 100;
      return Math.round(raw * 10000) / 10000;
    };
    return [0.0005, 0.001, 0.0025, 0.005, 0.01].map((p) => ({
      pct: p,
      val: pctOf(p),
    }));
  }, [lastPrice]);

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-line bg-base p-0.5 text-[11px] font-mono">
      <button
        type="button"
        onClick={() => onAutoBrickChange(!autoBrick)}
        aria-pressed={autoBrick}
        title={
          autoBrick
            ? 'Using ATR(14) of the source candles'
            : 'Use ATR(14) of the source candles'
        }
        className={[
          'rounded px-2 py-1 transition focus-ring',
          autoBrick
            ? 'bg-surface-3 text-ink'
            : 'text-ink-faint hover:bg-surface-1/60 hover:text-ink',
        ].join(' ')}
      >
        ATR
      </button>
      <input
        type="number"
        min={0}
        step="any"
        value={brickSize ?? ''}
        placeholder="brick"
        disabled={autoBrick}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') {
            onBrickSizeChange(null);
            return;
          }
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) onBrickSizeChange(n);
        }}
        className="focus-ring w-[78px] rounded bg-transparent px-1.5 py-1 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
        aria-label="Renko brick size"
      />
      {presets.length > 0 && (
        <div className="flex items-center gap-0.5">
          {presets.map((p) => {
            const active = !autoBrick && brickSize === p.val;
            return (
              <button
                key={p.pct}
                type="button"
                onClick={() => {
                  onAutoBrickChange(false);
                  onBrickSizeChange(p.val);
                }}
                title={`${(p.pct * 100).toFixed(2)}% of price = ${p.val}`}
                className={[
                  'rounded px-1.5 py-0.5 text-[10px] tabular-nums transition focus-ring',
                  active
                    ? 'bg-surface-3 text-ink'
                    : 'text-ink-faint hover:bg-surface-1/60 hover:text-ink-muted',
                ].join(' ')}
              >
                {(p.pct * 100).toFixed(2)}%
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MoreMenu({ onFitContent }: { onFitContent: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-3 hover:text-ink"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 min-w-[200px] overflow-hidden rounded-md border border-line bg-surface-2 py-1 text-[12px] shadow-xl"
        >
          <MenuItem
            onClick={() => {
              onFitContent();
              setOpen(false);
            }}
          >
            Reset zoom
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  trailing,
}: {
  children: React.ReactNode;
  onClick: () => void;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-ink-muted transition hover:bg-surface-3 hover:text-ink"
    >
      <span>{children}</span>
      {trailing && (
        <span
          className={[
            'rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider',
            trailing === 'on'
              ? 'bg-bull/12 text-bull-bright ring-1 ring-bull/30'
              : 'bg-neutral/10 text-ink-faint ring-1 ring-neutral/25',
          ].join(' ')}
        >
          {trailing}
        </span>
      )}
    </button>
  );
}
