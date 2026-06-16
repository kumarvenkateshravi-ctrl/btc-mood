'use client';

import { useHover } from '@/lib/chartHoverStore';
import type { ChartType } from './Chart';

interface OHLCLegendProps {
  /** Hide Vol + EMA 21 on narrow viewports. */
  compact?: boolean;
  /** Chart mode — controls which secondary cells render. */
  mode: ChartType;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(0);
}

function fmtTime(t: number): string {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm} UTC`;
}

export default function OHLCLegend({ compact = false, mode }: OHLCLegendProps) {
  const { hover, last } = useHover();
  // Show hover values when the cursor is over the chart; fall back to
  // the most recent bar's values when it leaves the chart area.
  const active = hover ?? last;
  const isLive = hover !== null;
  const isRenko = mode === 'renko';

  if (!active) {
    return (
      <div
        className="flex h-9 items-center gap-3 border-b border-line bg-surface-2 px-3 text-[11px] text-ink-faint"
        role="status"
        aria-label="Chart legend"
      >
        <span className="font-mono uppercase tracking-wider text-ink-muted">
          hover the chart
        </span>
      </div>
    );
  }

  const { base, src, emaFast, emaSlow } = active;
  // For Renko, `open === prior close` and `close === current close`,
  // so `isBull` is true for an up-brick. Source candle `src` is the
  // underlying time-based candle for the hovered brick index.
  const isBull = base.close >= base.open;

  return (
    <div
      className={[
        'flex h-9 items-center gap-3 border-b border-line bg-surface-2 px-3 text-[11px] font-mono',
        'overflow-x-auto tv-scroll-x',
        isLive ? 'text-ink' : 'text-ink-muted',
      ].join(' ')}
      role="status"
      aria-label="Chart legend"
    >
      <span
        className={[
          'shrink-0 uppercase tracking-wider',
          isLive ? 'text-ink' : 'text-ink-faint',
        ].join(' ')}
        title={isLive ? 'Live hover' : 'Last bar'}
      >
        {isRenko ? `Brick · ${fmtTime(base.time)}` : fmtTime(base.time)}
      </span>
      <Divider />
      <Cell label="O" value={fmt(base.open)} />
      <Cell
        label="H"
        value={fmt(isRenko ? Math.max(base.open, base.close) : base.high)}
        tone="up"
      />
      <Cell
        label="L"
        value={fmt(isRenko ? Math.min(base.open, base.close) : base.low)}
        tone="down"
      />
      <Cell
        label="C"
        value={fmt(base.close)}
        tone={isBull ? 'up' : 'down'}
        change={
          active.prevBase
            ? {
              value: base.close - active.prevBase.close,
              percent: ((base.close - active.prevBase.close) / active.prevBase.close) * 100,
            }
            : undefined
        }
      />
      {!isRenko && !compact && (
        <>
          <Divider />
          <Cell label="Vol" value={fmtVol(src.volume)} muted />
        </>
      )}
      {!isRenko && (
        <>
          <Divider />
          <Cell label="EMA 9" value={fmt(emaFast)} tone="sky" />
          {!compact && (
            <Cell label="EMA 21" value={fmt(emaSlow)} tone="amber" />
          )}
        </>
      )}
    </div>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-line shrink-0" aria-hidden />;
}

function Cell({
  label,
  value,
  tone,
  muted,
  change,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'sky' | 'amber';
  muted?: boolean;
  change?: { value: number; percent: number };
}) {
  const toneClass =
    tone === 'up'
      ? 'text-bull-bright'
      : tone === 'down'
        ? 'text-bear-bright'
        : tone === 'sky'
          ? 'text-accent'
          : tone === 'amber'
            ? 'text-regime-hot'
            : muted
              ? 'text-ink-muted'
              : 'text-ink';
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <span className={`tabular-nums ${toneClass}`}>{value}</span>
      {change !== undefined && (
        <span
          className={`ml-1 flex gap-1 tabular-nums ${change.value >= 0 ? 'text-bull-bright' : 'text-bear-bright'
            }`}
        >
          <span>{change.value >= 0 ? '+' : ''}{fmt(change.value, 1)}</span>
          <span>({change.percent >= 0 ? '+' : ''}{fmt(change.percent, 2)}%)</span>
        </span>
      )}
    </span>
  );
}
