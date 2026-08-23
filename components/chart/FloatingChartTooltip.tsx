import type { ChartType } from './types';
import { OHLCCell } from './ChartOHLCStrip';
import type { HoverPayload } from '@/lib/chartHoverStore';
import { formatChartInstrumentPrice } from '@/lib/chartInstrumentPresentation';
import { formatPercent } from '@/lib/format';

export function FloatingChartTooltip({
  pos,
  mode,
  symbol = 'BTCUSDT',
}: {
  pos: { x: number; y: number; time?: number; hover: HoverPayload };
  mode: ChartType;
  symbol?: string;
}) {
  const { hover } = pos;
  if (!hover) return null;
  const isRenko = mode === 'renko';
  const active = hover;

  const fmt = (n: number | null | undefined): string => {
    if (n == null || !Number.isFinite(n)) return '—';
    return formatChartInstrumentPrice(symbol, n);
  };
  const fmtVol = (n: number | null | undefined): string => {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    return n.toFixed(0);
  };
  const fmtTime = (t: number): string => {
    const d = new Date(t * 1000);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const currentPrice = active.base.close;
  const prevPrice = active.prevBase?.close ?? null;
  const delta = prevPrice !== null ? currentPrice - prevPrice : null;
  const deltaPct = prevPrice !== null && prevPrice !== 0 ? (delta! / prevPrice) * 100 : null;

  // Tooltip position: 20px offset from crosshair, stay within bounds
  const top = Math.max(10, pos.y + 20);
  const left = Math.max(10, pos.x + 20);

  return (
    <div
      className="pointer-events-none absolute z-50 flex flex-col gap-1.5 rounded-lg border border-line bg-surface-1/95 p-3 shadow-2xl backdrop-blur-md hidden md:flex min-w-[160px]"
      style={{ left, top }}
    >
      {/* 1. Primary Value */}
      <div className="font-mono text-lg font-bold text-ink leading-none">
        {fmt(currentPrice)}
      </div>

      {/* 2. OHLC */}
      <div className="flex gap-2 text-[12px] mt-1">
        <OHLCCell label="O" value={fmt(active.base.open)} />
        <OHLCCell label="H" value={fmt(isRenko ? Math.max(active.base.open, active.base.close) : active.base.high)} tone="up" />
        <OHLCCell label="L" value={fmt(isRenko ? Math.min(active.base.open, active.base.close) : active.base.low)} tone="down" />
      </div>

      {/* 3. Delta */}
      {delta !== null && deltaPct !== null && (
        <div className={`text-[12px] font-medium leading-tight ${delta >= 0 ? 'text-bull-bright' : 'text-bear-bright'}`}>
          {fmt(delta)} ({formatPercent(deltaPct)})
        </div>
      )}

      {/* 4. Volume */}
      {!isRenko && (
        <div className="text-[12px] text-ink-muted leading-tight">
          Vol: <span className="font-mono text-ink-faint">{fmtVol(active.src.volume)}</span>
        </div>
      )}

      {/* 5. Meta */}
      <div className="text-[11px] text-ink-faint mt-1 leading-none">
        {isRenko ? 'Brick · ' : ''}{pos.time ? fmtTime(pos.time) : fmtTime(active.base.time)}
      </div>
    </div>
  );
}
