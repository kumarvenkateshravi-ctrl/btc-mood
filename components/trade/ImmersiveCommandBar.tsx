'use client';

import { Bitcoin, Layout, X, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import type { ChartType } from '@/components/Chart';
import { COMPARE_SYMBOLS, type CompareSymbol } from '@/lib/compare';

type Density = 'comfortable' | 'compact' | 'immersive';

interface ImmersiveCommandBarProps {
  symbol: CompareSymbol;
  onSymbolChange: (s: CompareSymbol) => void;
  price: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  chartType: ChartType;
  onSelectType: (t: ChartType) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  onOpenOrder: () => void;
  hasPosition: boolean;
  positionUnits: number;
  uPnL: number;
}

/**
 * Floating command strip for Immersive density. Two pills: the left
 * one shows the live market context (symbol, price, change, TF,
 * chart type), the right one gives the trader a way to escape and
 * place orders without leaving the chart.
 */
export default function ImmersiveCommandBar(p: ImmersiveCommandBarProps) {
  const up = (p.change ?? 0) >= 0;
  const TrendIcon = up ? TrendingUp : TrendingDown;
  const trendColor = up ? 'text-bull' : 'text-bear';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex items-start justify-between gap-3 px-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-1/85 px-2.5 py-1.5 shadow-2xl backdrop-blur-md">
        <SymbolPill symbol={p.symbol} onChange={p.onSymbolChange} />
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="flex items-baseline gap-1.5">
          <span className={['font-mono text-lg font-semibold tabular-nums', trendColor].join(' ')}>
            {p.price != null ? p.price.toFixed(1) : '—'}
          </span>
          {p.change != null && (
            <span className={['inline-flex items-center gap-1 text-[11px] font-medium', trendColor].join(' ')}>
              <TrendIcon className="h-3 w-3" />
              {(p.change >= 0 ? '+' : '') + p.change.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="flex items-center rounded-md border border-line bg-surface-2/40 p-0.5">
          {TIMEFRAMES.map((tf) => {
            const active = p.selected === tf;
            return (
              <button
                key={tf}
                onClick={() => p.onSelectTf(tf)}
                aria-pressed={active}
                className={[
                  'focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium transition',
                  active
                    ? 'bg-accent/20 text-ink ring-1 ring-accent/40'
                    : 'text-ink-muted hover:bg-surface-3/60 hover:text-ink',
                ].join(' ')}
              >
                {tf}
              </button>
            );
          })}
        </div>
        <div className="flex items-center rounded-md border border-line bg-surface-2/40 p-0.5">
          {(['candlestick', 'heikinAshi', 'renko'] as ChartType[]).map((t) => {
            const active = p.chartType === t;
            const label = t === 'candlestick' ? 'Candle' : t === 'heikinAshi' ? 'Heikin' : 'Renko';
            return (
              <button
                key={t}
                onClick={() => p.onSelectType(t)}
                aria-pressed={active}
                className={[
                  'focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium transition',
                  active
                    ? 'bg-accent/20 text-ink ring-1 ring-accent/40'
                    : 'text-ink-muted hover:bg-surface-3/60 hover:text-ink',
                ].join(' ')}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mx-1 h-5 w-px bg-line" />
        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
            p.status === 'live'
              ? 'bg-bull/12 text-bull-bright'
              : p.status === 'demo'
              ? 'bg-regime-hot/15 text-regime-hot'
              : 'bg-ink-faint/12 text-ink-faint',
          ].join(' ')}
        >
          <span
            aria-hidden
            className={[
              'h-1.5 w-1.5 rounded-full',
              p.status === 'live' ? 'bg-bull' : p.status === 'demo' ? 'bg-regime-hot' : 'bg-ink-faint',
            ].join(' ')}
            style={p.status === 'live' ? { animation: 'live-pulse 2.2s ease-in-out infinite' } : undefined}
          />
          {p.status}
        </span>
      </div>

      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-line bg-surface-1/85 p-1.5 shadow-2xl backdrop-blur-md">
        {p.hasPosition && (
          <span
            className={[
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
              p.uPnL >= 0
                ? 'bg-bull/12 text-bull-bright ring-1 ring-bull/30'
                : 'bg-bear/12 text-bear-bright ring-1 ring-bear/30',
            ].join(' ')}
            aria-label="Unrealized P&L"
          >
            <Zap className="h-3 w-3" />
            <span className="font-mono">
              {p.uPnL >= 0 ? '+' : ''}
              {p.uPnL.toFixed(2)}
            </span>
            <span className="text-ink-faint">uPNL</span>
            <span className="font-mono text-ink-muted">{p.positionUnits.toFixed(2)}</span>
          </span>
        )}
        <button
          onClick={() => p.onDensityChange('comfortable')}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:text-ink"
          title="Exit Immersive mode"
        >
          <X className="h-3.5 w-3.5" />
          Exit immersive
        </button>
        <button
          onClick={p.onOpenOrder}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-accent/20 px-2.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-accent/40 transition hover:bg-accent/30"
          title="Place an order (B)"
        >
          <Layout className="h-3.5 w-3.5" />
          New order
        </button>
      </div>
    </div>
  );
}

function SymbolPill({
  symbol,
  onChange,
}: {
  symbol: CompareSymbol;
  onChange: (s: CompareSymbol) => void;
}) {
  return (
    <div className="relative">
      <select
        value={symbol}
        onChange={(e) => onChange(e.target.value as CompareSymbol)}
        className="focus-ring appearance-none rounded-md border border-line bg-surface-2/40 py-1 pl-7 pr-2.5 text-xs font-semibold text-ink"
      >
        {COMPARE_SYMBOLS.map((c) => (
          <option key={c.symbol} value={c.symbol}>
            {c.label}
          </option>
        ))}
      </select>
      <Bitcoin className="pointer-events-none absolute left-1.5 top-1/2 h-4 w-4 -translate-y-1/2 text-regime-hot" />
    </div>
  );
}
