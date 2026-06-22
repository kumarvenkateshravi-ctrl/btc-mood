'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, MoreHorizontal, ChevronDown, History, CalendarSearch, X } from 'lucide-react';
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

      {/* Row 2 — dedicated controls toolbar: grouped segments with dividers */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        {/* Timeframe */}
        <TimeframeSegmented selected={selected} onSelect={onSelectTf} />

        <ToolbarDivider />

        {/* Chart type + price scale */}
        <ChartTypeSelect value={chartType} onChange={onSelectType} />
        <PriceScaleModeSelect value={priceScaleMode} onChange={onPriceScaleModeChange} />

        {/* Renko config (conditional) */}
        {chartType === 'renko' && (
          <>
            <ToolbarDivider />
            <RenkoControl renko={renko} onChange={onRenkoChange} lastPrice={price} />
          </>
        )}

        <ToolbarDivider />

        {/* Indicators */}
        <IndicatorSelect
          activeIds={activeIndicatorIds}
          onToggle={onToggleIndicator}
          onClear={onClearIndicators}
        />

        <ToolbarDivider />

        {/* Time navigation: replay + jump-to-date */}
        <button
          type="button"
          onClick={onReplayToggle}
          aria-pressed={replayActive}
          title="Bar Replay"
          className={[
            'focus-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition',
            replayActive ? 'bg-accent/20 text-ink' : 'text-ink-faint hover:bg-surface-3 hover:text-ink',
          ].join(' ')}
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Replay</span>
        </button>

        <DateJump historyActive={historyActive} onJump={onJumpToDate} onReturn={onReturnToLive} />
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="h-5 w-px shrink-0 bg-line" aria-hidden />;
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

function DateJump({
  historyActive,
  onJump,
  onReturn,
}: {
  historyActive: boolean;
  onJump?: (ms: number) => void;
  onReturn?: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="hidden items-center gap-1 sm:inline-flex">
      <label
        title="Jump to date"
        className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-line bg-base px-2 text-[11px] text-ink-faint transition hover:text-ink"
      >
        <CalendarSearch className="h-3.5 w-3.5" />
        <input
          type="date"
          max={today}
          onChange={(e) => {
            const v = e.target.value;
            if (!v || !onJump) return;
            const ms = new Date(`${v}T00:00:00Z`).getTime();
            if (Number.isFinite(ms)) onJump(ms);
          }}
          className="bg-transparent text-[11px] text-ink outline-none [color-scheme:dark]"
          aria-label="Jump to date"
        />
      </label>
      {historyActive && (
        <button
          type="button"
          onClick={onReturn}
          title="Return to latest"
          className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-accent/20 px-2 text-[11px] font-medium text-ink transition hover:bg-accent/30"
        >
          <X className="h-3 w-3" />
          Latest
        </button>
      )}
    </div>
  );
}

function PriceScaleModeSelect({
  value,
  onChange,
}: {
  value: ToolbarPriceScaleMode;
  onChange: (v: ToolbarPriceScaleMode) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-line bg-base p-0.5 text-[11px] font-medium"
      role="group"
      aria-label="Price scale"
    >
      {(
        [
          { v: 'normal', l: 'Lin', title: 'Linear scale' },
          { v: 'log', l: 'Log', title: 'Logarithmic scale' },
          { v: 'percent', l: '%', title: 'Percentage scale' },
        ] as const
      ).map((opt) => {
        const active = opt.v === value;
        return (
          <button
            key={opt.v}
            onClick={() => onChange(opt.v)}
            aria-pressed={active}
            title={opt.title}
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

function roundNice(raw: number): number {
  if (raw >= 100) return Math.round(raw);
  if (raw >= 1) return Math.round(raw * 10) / 10;
  if (raw >= 0.01) return Math.round(raw * 100) / 100;
  return Math.round(raw * 10000) / 10000;
}

const RENKO_INPUT_CLASS =
  'focus-ring w-[64px] rounded bg-transparent px-1.5 py-1 text-right tabular-nums text-ink outline-none placeholder:text-ink-faint';

const RENKO_METHODS: { v: RenkoMethod; l: string; title: string }[] = [
  { v: 'traditional', l: 'Trad', title: 'Traditional — fixed box size in price units' },
  { v: 'atr', l: 'ATR', title: 'ATR — box size from ATR(length) of the source candles' },
  { v: 'percentage', l: '%', title: 'Percentage — box size as a percent of the last traded price' },
];

function RenkoControl({
  renko,
  onChange,
  lastPrice,
}: {
  renko: RenkoConfig;
  onChange: (c: RenkoConfig) => void;
  lastPrice: number | null;
}) {
  const set = (patch: Partial<RenkoConfig>) => onChange({ ...renko, ...patch });

  const pctPreview = useMemo(() => {
    if (renko.method !== 'percentage') return null;
    if (lastPrice == null || !Number.isFinite(lastPrice)) return null;
    return roundNice(lastPrice * (renko.percentage / 100));
  }, [renko.method, renko.percentage, lastPrice]);

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-line bg-base p-0.5 text-[11px] font-mono">
      <div className="inline-flex items-center" role="group" aria-label="Renko box size method">
        {RENKO_METHODS.map((m) => {
          const active = renko.method === m.v;
          return (
            <button
              key={m.v}
              type="button"
              onClick={() => set({ method: m.v })}
              aria-pressed={active}
              title={m.title}
              className={[
                'rounded px-2 py-1 transition focus-ring',
                active ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:bg-surface-1/60 hover:text-ink',
              ].join(' ')}
            >
              {m.l}
            </button>
          );
        })}
      </div>

      {renko.method === 'traditional' && (
        <input
          type="number"
          min={0}
          step="any"
          value={renko.boxSize ?? ''}
          placeholder="box"
          title="Fixed box size in price units"
          aria-label="Renko box size"
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') return set({ boxSize: null });
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) set({ boxSize: n });
          }}
          className={RENKO_INPUT_CLASS}
        />
      )}

      {renko.method === 'atr' && (
        <label className="flex items-center gap-1 pr-1 text-ink-faint" title="ATR length used for the box size">
          <span>Len</span>
          <input
            type="number"
            min={1}
            step={1}
            value={renko.atrLength}
            aria-label="ATR length"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) set({ atrLength: Math.round(n) });
            }}
            className={RENKO_INPUT_CLASS}
          />
        </label>
      )}

      {renko.method === 'percentage' && (
        <label className="flex items-center gap-1 pr-1 text-ink-faint" title="Percent of the last traded price">
          <input
            type="number"
            min={0}
            step="any"
            value={renko.percentage}
            aria-label="Percentage of last traded price"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) set({ percentage: n });
            }}
            className={RENKO_INPUT_CLASS}
          />
          <span>%{pctPreview != null ? ` ≈ ${pctPreview}` : ''}</span>
        </label>
      )}
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

export function IndicatorSelect({
  activeIds,
  onToggle,
  onClear,
}: {
  activeIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
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

  const count = activeIds.length;

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-2 rounded px-2 py-0.5 transition-colors hover:bg-surface-2 text-ink-muted hover:text-ink focus-ring"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-90">
          <polyline points="2 11 8 5 12 9 22 1" />
          <path d="M2 22 L2 14 M6 22 L6 14 M6 14 L2 14" strokeWidth="0" fill="currentColor" />
          <rect x="2" y="15" width="4" height="7" stroke="currentColor" fill="none" />
          <rect x="8" y="11" width="4" height="11" stroke="currentColor" fill="none" />
          <rect x="14" y="13" width="4" height="9" stroke="currentColor" fill="none" />
        </svg>
        <span className="text-[13px] font-medium tracking-wide">Indicators</span>
        {count > 0 && (
          <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold tabular-nums text-ink">
            {count}
          </span>
        )}
        <ChevronDown size={14} className="opacity-70" />
      </button>
      {open && (
        <ul className="absolute left-3 top-full z-30 mt-1 max-h-[60vh] min-w-[240px] overflow-auto rounded-lg border border-line bg-surface-1 shadow-2xl py-1">
          {CUSTOM_INDICATORS.map((ind) => {
            const on = activeIds.includes(ind.id);
            return (
              <li key={ind.id}>
                <button
                  onClick={() => onToggle(ind.id)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                    on ? 'text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] ${
                      on ? 'border-accent bg-accent/20 text-ink' : 'border-line text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  {ind.name}
                </button>
              </li>
            );
          })}
          {count > 0 && (
            <li className="border-t border-line mt-1 pt-1">
              <button
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-[13px] font-medium transition-colors text-bear-bright hover:bg-surface-2"
              >
                Clear all ({count})
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
