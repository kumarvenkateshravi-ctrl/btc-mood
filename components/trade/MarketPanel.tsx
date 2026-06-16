'use client';

import { useMemo } from 'react';
import type { Candle } from '@/lib/types';

interface MarketPanelProps {
  candles: Candle[];
  symbol: string;
}

export default function MarketPanel({ candles, symbol }: MarketPanelProps) {
  const stats = useMemo(() => computeStats(candles), [candles]);
  if (!stats) {
    return (
      <PanelShell title="Market snapshot">
        <p className="text-xs text-ink-faint">Waiting for data…</p>
      </PanelShell>
    );
  }
  return (
    <PanelShell title={`${symbol} snapshot`}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Stat label="24h high" value={fmt(stats.high24h)} unit="USD" />
        <Stat label="24h low" value={fmt(stats.low24h)} unit="USD" />
        <Stat label="24h vol" value={fmt(stats.vol24h)} unit="BTC" />
        <Stat
          label="24h change"
          value={(stats.change24h >= 0 ? '+' : '') + stats.change24h.toFixed(2)}
          unit="%"
          tone={stats.change24h >= 0 ? 'bull' : 'bear'}
        />
        <Stat label="VWAP" value={fmt(stats.vwap)} unit="USD" />
        <Stat label="Volatility" value={stats.volPct.toFixed(2)} unit="%" />
      </dl>
    </PanelShell>
  );
}

function PanelShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel overflow-hidden rounded-2xl">
      <header className="border-b border-line bg-surface-2/40 px-3.5 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          {title}
        </h2>
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'neutral' | 'bull' | 'bear';
}) {
  const toneClass =
    tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={['font-mono tabular-nums', toneClass].join(' ')}>
        {value}
        {unit && <span className="ml-1 text-[10px] text-ink-faint">{unit}</span>}
      </dd>
    </div>
  );
}

function computeStats(candles: Candle[]) {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1];
  // "24h" approximation: at least 24 bars, capped to the dataset length.
  const slice = candles.slice(-Math.min(48, candles.length));
  let high = -Infinity;
  let low = Infinity;
  let vol = 0;
  let pxiVol = 0;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    vol += c.volume;
    pxiVol += c.volume * (c.high + c.low + c.close) / 3;
  }
  const vwap = vol > 0 ? pxiVol / vol : last.close;
  const first = slice[0];
  const change24h = first.open === 0 ? 0 : ((last.close - first.open) / first.open) * 100;
  // Crude ATR% over the same window.
  let atrSum = 0;
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i];
    const prev = slice[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    atrSum += tr;
  }
  const atr = slice.length > 1 ? atrSum / (slice.length - 1) : 0;
  const volPct = last.close > 0 ? (atr / last.close) * 100 : 0;
  return {
    high24h: high,
    low24h: low,
    vol24h: vol,
    change24h,
    vwap,
    volPct,
  };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
