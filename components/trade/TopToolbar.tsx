'use client';

import { useEffect, useRef, useState } from 'react';
import { Bitcoin, ChevronDown, Layout, Maximize2, Minimize2, TrendingDown, TrendingUp } from 'lucide-react';
import IntentSwitch, { type TradeIntent } from './IntentSwitch';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import type { ChartType } from '@/components/Chart';
import { COMPARE_SYMBOLS, type CompareSymbol } from '@/lib/compare';

type Density = 'comfortable' | 'compact' | 'immersive';

interface TopToolbarProps {
  symbol: CompareSymbol;
  onSymbolChange: (s: CompareSymbol) => void;
  price: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  chartType: ChartType;
  onSelectType: (t: ChartType) => void;
  intent: TradeIntent;
  onIntentChange: (i: TradeIntent) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const DENSITY_CYCLE: Density[] = ['comfortable', 'compact', 'immersive'];
const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Comfort',
  compact: 'Compact',
  immersive: 'Immersive',
};
const DENSITY_DESC: Record<Density, string> = {
  comfortable: 'Comfortable density — full chrome, generous padding.',
  compact: 'Compact density — tighter rows, smaller labels.',
  immersive: 'Immersive — chart fills the screen, chrome hides.',
};

export default function TopToolbar(p: TopToolbarProps) {
  const up = (p.change ?? 0) >= 0;
  const TrendIcon = up ? TrendingUp : TrendingDown;
  const trendColor = up ? 'text-bull' : 'text-bear';
  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);
  const lastPriceRef = useRef<number | null>(p.price);

  useEffect(() => {
    const last = lastPriceRef.current;
    if (p.price != null && last != null && p.price !== last) {
      setFlashDir(p.price > last ? 'up' : 'down');
      const t = setTimeout(() => setFlashDir(null), 320);
      lastPriceRef.current = p.price;
      return () => clearTimeout(t);
    }
    lastPriceRef.current = p.price;
  }, [p.price]);

  const flashClass =
    flashDir === 'up'
      ? 'price-flash-up'
      : flashDir === 'down'
      ? 'price-flash-down'
      : '';

  return (
    <div
      className={[
        'sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-base/80 px-4 py-2.5 backdrop-blur-md',
        p.density === 'compact' ? 'gap-2 py-1.5' : '',
      ].join(' ')}
    >
      <SymbolPill
        symbol={p.symbol}
        onChange={p.onSymbolChange}
        price={p.price}
        change={p.change}
        trendColor={trendColor}
        TrendIcon={TrendIcon}
        flashClass={flashClass}
        status={p.status}
        density={p.density}
      />

      <div className="ml-1 flex items-center rounded-lg border border-line bg-surface-2/60 p-0.5">
        {TIMEFRAMES.map((tf, i) => {
          const active = p.selected === tf;
          return (
            <button
              key={tf}
              onClick={() => p.onSelectTf(tf)}
              aria-pressed={active}
              title={`Timeframe ${tf} (key ${i + 1})`}
              className={[
                'focus-ring rounded-md px-2.5 py-1 text-xs font-medium transition',
                p.density === 'compact' ? 'px-1.5' : '',
                active
                  ? 'bg-accent/20 text-ink ring-1 ring-accent/40'
                  : 'text-ink-muted hover:bg-surface-3/60 hover:text-ink',
              ].join(' ')}
            >
              <span className="font-mono">{tf}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center rounded-lg border border-line bg-surface-2/60 p-0.5">
        {(['candlestick', 'heikinAshi', 'renko'] as ChartType[]).map((t) => {
          const active = p.chartType === t;
          const label = t === 'candlestick' ? 'Candle' : t === 'heikinAshi' ? 'Heikin' : 'Renko';
          return (
            <button
              key={t}
              onClick={() => p.onSelectType(t)}
              aria-pressed={active}
              title={label}
              className={[
                'focus-ring rounded-md px-2.5 py-1 text-xs font-medium transition',
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

      <div className="ml-auto flex items-center gap-2">
        <IntentSwitch value={p.intent} onChange={p.onIntentChange} />

        <button
          onClick={() => {
            const idx = DENSITY_CYCLE.indexOf(p.density);
            const next = DENSITY_CYCLE[(idx + 1) % DENSITY_CYCLE.length];
            p.onDensityChange(next);
          }}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:text-ink"
          title={DENSITY_DESC[p.density]}
          aria-label="Toggle layout density"
        >
          <Layout className="h-3.5 w-3.5" />
          {DENSITY_LABEL[p.density]}
        </button>

        <button
          onClick={p.onToggleFullscreen}
          className="focus-ring inline-flex items-center justify-center rounded-lg border border-line bg-surface-2/60 p-1.5 text-ink-muted transition hover:text-ink"
          title={p.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-label={p.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {p.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SymbolPill({
  symbol,
  onChange,
  price,
  change,
  trendColor,
  TrendIcon,
  flashClass,
  status,
  density,
}: {
  symbol: CompareSymbol;
  onChange: (s: CompareSymbol) => void;
  price: number | null;
  change: number | null;
  trendColor: string;
  TrendIcon: typeof TrendingUp;
  flashClass: string;
  status: 'live' | 'demo' | 'loading';
  density: 'comfortable' | 'compact' | 'immersive';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center gap-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-sm font-semibold text-ink transition hover:border-accent/40"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Bitcoin className="h-4 w-4 text-regime-hot" />
        {symbol.replace('USDT', '/USDT')}
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-line bg-surface-1 shadow-2xl"
        >
          {COMPARE_SYMBOLS.map((c) => (
            <li key={c.symbol}>
              <button
                role="option"
                aria-selected={c.symbol === symbol}
                onClick={() => {
                  onChange(c.symbol);
                  setOpen(false);
                }}
                className={[
                  'block w-full px-3 py-2 text-left text-sm transition',
                  c.symbol === symbol
                    ? 'bg-accent/15 text-ink'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                ].join(' ')}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={[
          'flex items-baseline gap-2 rounded-lg px-2 py-1 transition-colors',
          flashClass,
        ].join(' ')}
        aria-live="polite"
        aria-atomic
      >
        <span
          className={[
            'font-mono text-2xl font-semibold tabular-nums',
            density === 'compact' ? 'text-xl' : '',
            trendColor,
          ].join(' ')}
        >
          {price != null ? price.toFixed(1) : '—'}
        </span>
        {change != null && (
          <span className={['inline-flex items-center gap-1 text-xs font-medium', trendColor].join(' ')}>
            <TrendIcon className="h-3.5 w-3.5" />
            {(change >= 0 ? '+' : '') + change.toFixed(2)}%
          </span>
        )}
        <span
          className={[
            'ml-1 inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
            status === 'live'
              ? 'bg-bull/12 text-bull-bright'
              : status === 'demo'
              ? 'bg-regime-hot/15 text-regime-hot'
              : 'bg-ink-faint/12 text-ink-faint',
          ].join(' ')}
        >
          <span
            aria-hidden
            className={[
              'h-1.5 w-1.5 rounded-full',
              status === 'live' ? 'bg-bull' : status === 'demo' ? 'bg-regime-hot' : 'bg-ink-faint',
            ].join(' ')}
            style={status === 'live' ? { animation: 'live-pulse 2.2s ease-in-out infinite' } : undefined}
          />
          {status}
        </span>
      </div>
    </div>
  );
}
