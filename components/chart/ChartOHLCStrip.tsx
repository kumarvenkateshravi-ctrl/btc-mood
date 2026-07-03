import { useHover } from '@/lib/chartHoverStore';
import type { ChartType } from './types';

export function ChartOHLCStrip({ mode }: { mode: ChartType }) {
  const { hover, last } = useHover();
  const active = hover ?? last;
  const isLive = hover !== null;
  const isRenko = mode === 'renko';

  const fmt = (n: number | null | undefined, digits = 2): string => {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };
  const fmtVol = (n: number | null | undefined): string => {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    return n.toFixed(2);
  };
  const fmtTime = (t: number): string => {
    const d = new Date(t * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  return (
    <div
      role="status"
      aria-label="Chart OHLCV"
      className={[
        'flex flex-wrap items-center gap-2 text-[13px] font-mono drop-shadow-md',
        isLive ? 'text-ink' : 'text-ink-muted',
      ].join(' ')}
    >
      <span
        className={[
          'shrink-0 tabular-nums',
          isLive ? 'text-ink' : 'text-ink-faint',
        ].join(' ')}
        title={isLive ? 'Live hover' : 'Last bar'}
      >
        {active ? (isRenko ? `Brick · ${fmtTime(active.base.time)}` : fmtTime(active.base.time)) : '—'}
      </span>

      <span className="h-3 w-px shrink-0 bg-line" aria-hidden />

      <OHLCCell label="O" value={active ? fmt(active.base.open) : '—'} />
      <OHLCCell label="H" value={active ? fmt(isRenko ? Math.max(active.base.open, active.base.close) : active.base.high) : '—'} tone="up" />
      <OHLCCell label="L" value={active ? fmt(isRenko ? Math.min(active.base.open, active.base.close) : active.base.low) : '—'} tone="down" />
      <OHLCCell
        label="C"
        value={active ? fmt(active.base.close) : '—'}
        tone={active && active.base.close >= active.base.open ? 'up' : 'down'}
      />

      {active?.prevBase && (
        <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
          <span
            className={
              active.base.close - active.prevBase.close >= 0 ? 'text-bull-bright' : 'text-bear-bright'
            }
          >
            {active.base.close - active.prevBase.close > 0 ? '+' : ''}
            {fmt(active.base.close - active.prevBase.close)}
            {' '}
            {active.base.close - active.prevBase.close > 0 ? '+' : ''}
            {fmt(
              ((active.base.close - active.prevBase.close) / active.prevBase.close) * 100,
              2,
            )}%
          </span>
        </span>
      )}

      {!isRenko && active && (
        <>
          <span className="h-3 w-px shrink-0 bg-line" aria-hidden />
          <OHLCCell label="Vol" value={fmtVol(active.src.volume)} muted />
        </>
      )}
    </div>
  );
}

export function OHLCCell({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  muted?: boolean;
}) {
  const toneClass =
    tone === 'up'
      ? 'text-bull-bright'
      : tone === 'down'
        ? 'text-bear-bright'
        : muted
          ? 'text-ink-muted'
          : 'text-ink';
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1">
      <span className="text-ink-faint">{label}</span>
      <span className={`tabular-nums ${toneClass}`}>{value}</span>
    </span>
  );
}
